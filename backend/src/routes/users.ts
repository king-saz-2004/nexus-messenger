import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { sql, joinSql, emptySql, type SqlFragment } from '../config/sql.js';
import { isUniqueViolation, isCheckViolation, getPgConstraint } from '../utils/errors.js';
import { z } from 'zod';
import { cacheKeys } from '../cache/cacheKeys.js';
import { cached } from '../cache/index.js';
import { invalidateChatsForUsers, invalidateContactsForUser, invalidateUsersForUser } from '../cache/invalidation.js';
import { runAsUser, runForExactUserLookup, runForRootUserDelete, runForUserDirectory } from '../config/dbContext.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { avatarUpload } from '../middleware/avatarUpload.js';
import { mutationRateLimiter, uploadRateLimiter, userLookupRateLimiter } from '../middleware/rateLimits.js';
import { decodeCursor, encodeCursor, parseLimit } from '../utils/pagination.js';
import {
  buildAvatarUrl,
  deleteAvatarByStorageKey,
  deleteAvatarByUrl,
  validateAvatarFile,
  validateAvatarFileSignature
} from '../services/avatarStorage.js';
import {
  getActiveUserByIdWithClient,
  toAuthUserDto,
  toPublicUserDto,
  type AuthUserRow,
  type PublicUserRow
} from '../services/authUser.js';
import {
  duplicateIdentityMessage,
  normalizeOptionalEmail,
  normalizeOptionalPhone,
  resolveDuplicateIdentityCode
} from '../utils/identity.js';
import { assertBcryptHash } from '../utils/passwordHash.js';

const router = Router();

const BCRYPT_COST = 12;
const PHONE_E164_REGEX = /^\+[1-9]\d{1,14}$/;
const USER_STATUS_VALUES = ['online', 'offline', 'recently', 'away'] as const;

type DirectoryUserRow = PublicUserRow & {
  is_contact: boolean;
  is_blocked: boolean;
  is_favorite: boolean;
  contact_custom_name: string | null;
};

type UserSettingsRow = {
  user_id: string;
  theme: 'light' | 'dark' | 'system';
  chat_wallpaper: string | null;
  font_size: number;
  message_corner: number;
  show_stickers_tab: boolean;
  auto_download_photo: boolean;
  auto_download_video: boolean;
  auto_download_doc: boolean;
  auto_play_gif: boolean;
  notification_enabled: boolean;
  notification_sound: boolean;
  notification_preview: boolean;
  notification_count_badge: boolean;
  language: string;
  time_format: '12h' | '24h';
  updated_at: Date;
};

const stripControlChars = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').trim();

const parseOptionalText = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = stripControlChars(value);
  return trimmed.length > 0 ? trimmed : null;
};

const optionalNullableString = (max: number) =>
  z.preprocess(parseOptionalText, z.string().max(max).nullable().optional());

const optionalNullableEmail = z.preprocess(parseOptionalText, z.string().email().max(255).nullable().optional());
const optionalNullablePhone = z.preprocess(
  parseOptionalText,
  z.string().regex(PHONE_E164_REGEX).nullable().optional()
);

const patchMeSchema = z.object({
  name: z.string().trim().min(2).max(128).optional(),
  firstName: z.string().trim().min(1).max(64).optional(),
  lastName: optionalNullableString(64),
  bio: optionalNullableString(512),
  customStatus: optionalNullableString(70),
  status: z.enum(USER_STATUS_VALUES).optional(),
  email: optionalNullableEmail,
  phone: optionalNullablePhone,
  password: z.string().min(8).max(128).optional()
});

const putMeSchema = z.object({
  firstName: z.string().trim().min(1).max(64).optional(),
  lastName: optionalNullableString(64),
  bio: optionalNullableString(512),
  customStatus: optionalNullableString(70),
  status: z.enum(USER_STATUS_VALUES).optional(),
  email: optionalNullableEmail,
  phone: optionalNullablePhone,
  password: z.string().min(8).max(128).optional()
});

const searchUsersQuerySchema = z.object({
  q: z.preprocess(value => (typeof value === 'string' ? value.trim() : ''), z.string().max(80)).optional(),
  query: z.preprocess(value => (typeof value === 'string' ? value.trim() : ''), z.string().max(80)).optional(),
  limit: z.unknown().optional(),
  cursor: z.string().trim().min(1).max(200).optional()
});

const lookupUserQuerySchema = z.object({
  userid: z
    .string()
    .trim()
    .min(1)
    .max(33)
    .regex(/^@?[a-zA-Z][a-zA-Z0-9_]{3,31}$/)
});

const userIdParamSchema = z.object({
  id: z.string().uuid()
});

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  chatWallpaper: optionalNullableString(500),
  fontSize: z.union([z.literal(14), z.literal(16), z.literal(18), z.literal(20)]).optional(),
  messageCorner: z.number().int().min(0).max(64).optional(),
  showStickersTab: z.boolean().optional(),
  autoDownloadPhoto: z.boolean().optional(),
  autoDownloadVideo: z.boolean().optional(),
  autoDownloadDoc: z.boolean().optional(),
  autoPlayGif: z.boolean().optional(),
  notificationEnabled: z.boolean().optional(),
  notificationSound: z.boolean().optional(),
  notificationPreview: z.boolean().optional(),
  notificationCountBadge: z.boolean().optional(),
  language: z.string().trim().min(1).max(10).optional(),
  timeFormat: z.enum(['12h', '24h']).optional()
});

const splitDisplayName = (name: string) => {
  const chunks = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const firstName = chunks.shift() ?? '';
  const lastName = chunks.length > 0 ? chunks.join(' ') : null;
  return { firstName, lastName };
};

const runAvatarUpload = (req: Request, res: Response) => {
  return new Promise<void>((resolve, reject) => {
    avatarUpload.single('avatar')(req, res, error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};



const pickConstraintMessage = (error: unknown) => {
  if (isCheckViolation(error)) {
    const constraint = getPgConstraint(error)?.toLowerCase() ?? '';
    if (constraint.includes('bio_length')) return 'Bio is too long';
    if (constraint.includes('status_values')) return 'Invalid status value';
    if (constraint.includes('username_format')) return 'Invalid username format';
    if (constraint.includes('avatar_color_range')) return 'Invalid avatar color';
  }
  return null;
}

const userSelectSql = sql`
  u.id,
  u.username,
  u.email,
  u.phone,
  u.first_name,
  u.last_name,
  u.avatar_url,
  u.avatar_color,
  u.status,
  u.last_seen,
  u.is_root,
  u.is_active,
  u.is_deleted,
  u.created_at,
  u.updated_at
`;

const normalizeUseridInput = (value: string) => value.trim().replace(/^@/, '').toLowerCase();

const toIsoDate = (value: Date | string | null | undefined) => {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

const makeDeletedUsername = () => `deleted_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

type UserDeleteTargetRow = {
  id: string;
  is_root: boolean;
  avatar_url: string | null;
};

const mapDirectoryUser = (row: DirectoryUserRow) => ({
  ...toPublicUserDto(row),
  isContact: row.is_contact,
  isBlocked: row.is_blocked,
  isFavorite: row.is_favorite,
  contactCustomName: row.contact_custom_name ?? undefined
});

type DirectoryUsersQuery = {
  query: string;
  limit: number;
  cursor?: {
    createdAt: string;
    id: string;
  } | null;
};

const loadDirectoryUsers = async (viewerId: string, viewerIsRoot: boolean, params: DirectoryUsersQuery) => {
  const { limit } = params;
  const query = params.query;
  const normalized = query.trim().toLowerCase();
  const escaped = normalized.replace(/[%_\\]/g, char => `\\${char}`);
  const pattern = `%${escaped}%`;

  return runForUserDirectory(viewerId, viewerIsRoot, tx => {
    const filters: SqlFragment[] = [
      sql`u.is_active = true`,
      sql`u.is_deleted = false`,
      sql`u.registration_status = 'active'`,
      sql`u.id != ${viewerId}::uuid`
    ];

    if (normalized.length > 0) {
      filters.push(
        sql`(
          LOWER(u.username) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(u.first_name) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(u.last_name, '')) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(c.custom_name, '')) LIKE ${pattern} ESCAPE '\\'
        )`
      );
    }

    if (params.cursor?.createdAt && params.cursor?.id) {
      const cursorDate = new Date(params.cursor.createdAt);
      if (!Number.isNaN(cursorDate.getTime())) {
        filters.push(
          sql`(u.created_at, u.id) < (${cursorDate}, ${params.cursor.id}::uuid)`
        );
      }
    }

    return tx.$queryRaw<DirectoryUserRow[]>(
      sql`
        SELECT
          ${userSelectSql},
          (c.id IS NOT NULL) AS is_contact,
          COALESCE(c.is_blocked, false) AS is_blocked,
          COALESCE(c.is_favorite, false) AS is_favorite,
          c.custom_name AS contact_custom_name
        FROM users u
        LEFT JOIN contacts c
          ON c.user_id = ${viewerId}::uuid
         AND c.contact_user_id = u.id
        WHERE ${joinSql(filters, ' AND ')}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ${limit}
      `
    );
  });
};

const loadDirectoryUserByUserid = async (viewerId: string, viewerIsRoot: boolean, userid: string) => {
  const normalizedUserid = normalizeUseridInput(userid);

  const rows = await runForExactUserLookup(viewerId, normalizedUserid, viewerIsRoot, tx =>
    tx.$queryRaw<DirectoryUserRow[]>(
      sql`
        SELECT
          ${userSelectSql},
          (c.id IS NOT NULL) AS is_contact,
          COALESCE(c.is_blocked, false) AS is_blocked,
          COALESCE(c.is_favorite, false) AS is_favorite,
          c.custom_name AS contact_custom_name
        FROM users u
        LEFT JOIN contacts c
          ON c.user_id = ${viewerId}::uuid
         AND c.contact_user_id = u.id
        WHERE LOWER(u.username) = ${normalizedUserid}
          AND u.is_active = true
          AND u.is_deleted = false
          AND u.registration_status = 'active'
        LIMIT 1
      `
    )
  );

  return rows[0] ?? null;
};

const loadDirectoryUserById = async (viewerId: string, viewerIsRoot: boolean, targetId: string) => {
  const rows = await runForUserDirectory(viewerId, viewerIsRoot, tx =>
    tx.$queryRaw<DirectoryUserRow[]>(
      sql`
        SELECT
          ${userSelectSql},
          (c.id IS NOT NULL) AS is_contact,
          COALESCE(c.is_blocked, false) AS is_blocked,
          COALESCE(c.is_favorite, false) AS is_favorite,
          c.custom_name AS contact_custom_name
        FROM users u
        LEFT JOIN contacts c
          ON c.user_id = ${viewerId}::uuid
         AND c.contact_user_id = u.id
        WHERE u.id = ${targetId}::uuid
          AND u.is_active = true
          AND u.is_deleted = false
          AND u.registration_status = 'active'
        LIMIT 1
      `
    )
  );
  return rows[0] ?? null;
};

const loadPagedDirectoryUsers = async (params: {
  actorId: string;
  isRoot: boolean;
  query: string;
  limitRaw: unknown;
  cursorRaw?: string;
  res: Response;
}) => {
  const limit = parseLimit(params.limitRaw, { fallback: 250, min: 1, max: 1000 });
  const cursor = decodeCursor<{ createdAt: string; id: string }>(params.cursorRaw ?? null);

  const key = cacheKeys.usersList(params.actorId, params.query, null, 500);
  const rows = await cached({
    key,
    ttlSeconds: env.cacheUsersTtlSeconds,
    res: params.res,
    onMiss: async () =>
      loadDirectoryUsers(params.actorId, params.isRoot, {
        query: params.query,
        limit: 500
      })
  });

  let startIndex = 0;
  if (cursor?.id) {
    const index = rows.findIndex(row => row.id === cursor.id);
    startIndex = index >= 0 ? index + 1 : 0;
  }

  const window = rows.slice(startIndex, startIndex + limit + 1);
  const hasMore = window.length > limit;
  const sliced = hasMore ? window.slice(0, limit) : window;
  const users = sliced.map(mapDirectoryUser);
  const lastCreatedAt = sliced.length > 0 ? toIsoDate(sliced[sliced.length - 1]!.created_at) : undefined;
  const nextCursor =
    hasMore && sliced.length > 0 && lastCreatedAt
      ? encodeCursor({
          id: sliced[sliced.length - 1]!.id,
          createdAt: lastCreatedAt
        })
      : undefined;

  return {
    users,
    limit,
    nextCursor,
    hasMore
  };
};

const ensureSettingsRow = async (userId: string) => {
  return runAsUser(userId, async tx => {
    await tx.$executeRaw`
      INSERT INTO user_settings (user_id)
      VALUES (${userId}::uuid)
      ON CONFLICT (user_id) DO NOTHING
    `;

    const rows = await tx.$queryRaw<UserSettingsRow[]>`
      SELECT
        user_id,
        theme,
        chat_wallpaper,
        font_size,
        message_corner,
        show_stickers_tab,
        auto_download_photo,
        auto_download_video,
        auto_download_doc,
        auto_play_gif,
        notification_enabled,
        notification_sound,
        notification_preview,
        notification_count_badge,
        language,
        time_format,
        updated_at
      FROM user_settings
      WHERE user_id = ${userId}::uuid
      LIMIT 1
    `;

    return rows[0] ?? null;
  });
};

const mapSettingsDto = (row: UserSettingsRow) => ({
  userId: row.user_id,
  theme: row.theme,
  chatWallpaper: row.chat_wallpaper ?? undefined,
  fontSize: row.font_size,
  messageCorner: row.message_corner,
  showStickersTab: row.show_stickers_tab,
  autoDownloadPhoto: row.auto_download_photo,
  autoDownloadVideo: row.auto_download_video,
  autoDownloadDoc: row.auto_download_doc,
  autoPlayGif: row.auto_play_gif,
  notificationEnabled: row.notification_enabled,
  notificationSound: row.notification_sound,
  notificationPreview: row.notification_preview,
  notificationCountBadge: row.notification_count_badge,
  language: row.language,
  timeFormat: row.time_format,
  updatedAt: row.updated_at.toISOString()
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await runAsUser(req.user!.sub, tx => getActiveUserByIdWithClient(tx, req.user!.sub));
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ user: toAuthUserDto(user) });
  })
);

router.patch(
  '/me',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = patchMeSchema.parse(req.body);
    const updates: SqlFragment[] = [];

    const resolvedFirstName =
      body.name !== undefined && body.firstName === undefined ? splitDisplayName(body.name).firstName : body.firstName;
    const resolvedLastName =
      body.name !== undefined && body.lastName === undefined ? splitDisplayName(body.name).lastName : body.lastName;

    if (resolvedFirstName !== undefined) {
      updates.push(sql`first_name = ${stripControlChars(resolvedFirstName)}`);
    }
    if (resolvedLastName !== undefined) {
      updates.push(sql`last_name = ${resolvedLastName ? stripControlChars(resolvedLastName) : null}`);
    }
    if (body.bio !== undefined) {
      updates.push(sql`bio = ${body.bio}`);
    }
    if (body.customStatus !== undefined) {
      updates.push(sql`custom_status = ${body.customStatus}`);
    }
    if (body.status !== undefined) {
      updates.push(sql`status = ${body.status}`);
    }
    if (body.email !== undefined) {
      const normalizedEmail = normalizeOptionalEmail(body.email);
      updates.push(sql`email = ${normalizedEmail ?? null}`);
    }
    if (body.phone !== undefined) {
      const normalizedPhone = normalizeOptionalPhone(body.phone);
      updates.push(sql`phone = ${normalizedPhone ?? null}`);
    }
    if (body.password) {
      const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
      assertBcryptHash(passwordHash, 'users.patch.me.password_hash');
      updates.push(sql`password_hash = ${passwordHash}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No profile fields provided' });
    }

    try {
      const updatedRows = await runAsUser(req.user!.sub, tx =>
        tx.$queryRaw<AuthUserRow[]>(
          sql`
            UPDATE users
            SET ${joinSql(updates, ', ')}
            WHERE id = ${req.user!.sub}::uuid
            RETURNING
              id,
              username,
              email,
              phone,
              password_hash,
              first_name,
              last_name,
              avatar_url,
              avatar_color,
              status,
              last_seen,
              is_root,
              is_active,
              is_deleted,
              created_at,
              updated_at
          `
        )
      );

      const updated = updatedRows[0];
      if (!updated) {
        return res.status(404).json({ message: 'User not found' });
      }

      await invalidateUsersForUser(req.user!.sub);
      return res.json({ user: toAuthUserDto(updated) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const code = resolveDuplicateIdentityCode(error) ?? 'DUPLICATE_EMAIL';
        return res.status(409).json({
          message: duplicateIdentityMessage(code),
          code
        });
      }
      const constraintMessage = pickConstraintMessage(error);
      if (constraintMessage) {
        return res.status(400).json({ message: constraintMessage });
      }
      throw error;
    }
  })
);

router.put(
  '/me',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = putMeSchema.parse(req.body);
    const updates: SqlFragment[] = [];

    if (body.firstName !== undefined) {
      updates.push(sql`first_name = ${stripControlChars(body.firstName)}`);
    }
    if (body.lastName !== undefined) {
      updates.push(sql`last_name = ${body.lastName ? stripControlChars(body.lastName) : null}`);
    }
    if (body.bio !== undefined) {
      updates.push(sql`bio = ${body.bio}`);
    }
    if (body.customStatus !== undefined) {
      updates.push(sql`custom_status = ${body.customStatus}`);
    }
    if (body.status !== undefined) {
      updates.push(sql`status = ${body.status}`);
    }
    if (body.email !== undefined) {
      const normalizedEmail = normalizeOptionalEmail(body.email);
      updates.push(sql`email = ${normalizedEmail ?? null}`);
    }
    if (body.phone !== undefined) {
      const normalizedPhone = normalizeOptionalPhone(body.phone);
      updates.push(sql`phone = ${normalizedPhone ?? null}`);
    }
    if (body.password) {
      const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
      assertBcryptHash(passwordHash, 'users.put.me.password_hash');
      updates.push(sql`password_hash = ${passwordHash}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No profile fields provided' });
    }

    try {
      const updatedRows = await runAsUser(req.user!.sub, tx =>
        tx.$queryRaw<AuthUserRow[]>(
          sql`
            UPDATE users
            SET ${joinSql(updates, ', ')}
            WHERE id = ${req.user!.sub}::uuid
            RETURNING
              id,
              username,
              email,
              phone,
              password_hash,
              first_name,
              last_name,
              avatar_url,
              avatar_color,
              status,
              last_seen,
              is_root,
              is_active,
              is_deleted,
              created_at,
              updated_at
          `
        )
      );

      const updated = updatedRows[0];
      if (!updated) {
        return res.status(404).json({ message: 'User not found' });
      }

      await invalidateUsersForUser(req.user!.sub);
      return res.json({ user: toAuthUserDto(updated) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const code = resolveDuplicateIdentityCode(error) ?? 'DUPLICATE_EMAIL';
        return res.status(409).json({
          message: duplicateIdentityMessage(code),
          code
        });
      }
      const constraintMessage = pickConstraintMessage(error);
      if (constraintMessage) {
        return res.status(400).json({ message: constraintMessage });
      }
      throw error;
    }
  })
);

const handleAvatarUpload = async (req: Request, res: Response) => {
  await runAvatarUpload(req, res);
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Missing avatar file' });
  }

  try {
    validateAvatarFile(file);
    await validateAvatarFileSignature(file);
  } catch (error) {
    await deleteAvatarByStorageKey(file.filename).catch(() => undefined);
    throw error;
  }

  let previousAvatarUrl: string | null = null;
  try {
    const result = await runAsUser(req.user!.sub, async tx => {
      const existingRows = await tx.$queryRaw<{ avatar_url: string | null }[]>`
        SELECT avatar_url
        FROM users
        WHERE id = ${req.user!.sub}::uuid
        LIMIT 1
      `;

      if (existingRows.length === 0) {
        return null;
      }

      previousAvatarUrl = existingRows[0]?.avatar_url ?? null;

      const updatedRows = await tx.$queryRaw<AuthUserRow[]>`
        UPDATE users
        SET avatar_url = ${buildAvatarUrl(file.filename)}
        WHERE id = ${req.user!.sub}::uuid
        RETURNING
          id,
          username,
          email,
          phone,
          password_hash,
          first_name,
          last_name,
          avatar_url,
          avatar_color,
          status,
          last_seen,
          is_root,
          is_active,
          is_deleted,
          created_at,
          updated_at
      `;

      return updatedRows[0] ?? null;
    });

    if (!result) {
      return res.status(404).json({ message: 'User not found' });
    }

    await deleteAvatarByUrl(previousAvatarUrl).catch(() => undefined);
    await invalidateUsersForUser(req.user!.sub);
    return res.json({ user: toAuthUserDto(result) });
  } catch (error) {
    await deleteAvatarByStorageKey(file.filename).catch(() => undefined);
    throw error;
  }
};

router.post(
  '/me/avatar',
  requireAuth,
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    return handleAvatarUpload(req, res);
  })
);

router.put(
  '/me/avatar',
  requireAuth,
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    return handleAvatarUpload(req, res);
  })
);

router.delete(
  '/me/avatar',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const result = await runAsUser(req.user!.sub, async tx => {
      const existingRows = await tx.$queryRaw<{ avatar_url: string | null }[]>`
        SELECT avatar_url
        FROM users
        WHERE id = ${req.user!.sub}::uuid
        LIMIT 1
      `;

      if (existingRows.length === 0) {
        return null;
      }

      const previousAvatarUrl = existingRows[0]?.avatar_url ?? null;
      const updatedRows = await tx.$queryRaw<AuthUserRow[]>`
        UPDATE users
        SET avatar_url = NULL
        WHERE id = ${req.user!.sub}::uuid
        RETURNING
          id,
          username,
          email,
          phone,
          password_hash,
          first_name,
          last_name,
          avatar_url,
          avatar_color,
          status,
          last_seen,
          is_root,
          is_active,
          is_deleted,
          created_at,
          updated_at
      `;

      return {
        user: updatedRows[0] ?? null,
        previousAvatarUrl
      };
    });

    if (!result || !result.user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await deleteAvatarByUrl(result.previousAvatarUrl).catch(() => undefined);
    await invalidateUsersForUser(req.user!.sub);
    return res.json({ user: toAuthUserDto(result.user) });
  })
);

router.get(
  '/search',
  requireAuth,
  userLookupRateLimiter,
  asyncHandler(async (req, res) => {
    const query = searchUsersQuerySchema.parse(req.query);
    const page = await loadPagedDirectoryUsers({
      actorId: req.user!.sub,
      isRoot: req.user!.isRoot,
      query: query.q ?? query.query ?? '',
      limitRaw: query.limit,
      cursorRaw: query.cursor,
      res
    });
    return res.json(page);
  })
);

router.get(
  '/lookup',
  requireAuth,
  userLookupRateLimiter,
  asyncHandler(async (req, res) => {
    const query = lookupUserQuerySchema.parse(req.query);
    const cacheKey = cacheKeys.userLookup(req.user!.sub, query.userid);
    const user = await cached({
      key: cacheKey,
      ttlSeconds: env.cacheLookupTtlSeconds,
      res,
      onMiss: async () => loadDirectoryUserByUserid(req.user!.sub, req.user!.isRoot, query.userid)
    });
    if (!user) {
      res.setHeader('X-Cache', 'BYPASS');
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ user: mapDirectoryUser(user) });
  })
);

router.get(
  '/me/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await ensureSettingsRow(req.user!.sub);
    if (!settings) {
      return res.status(404).json({ message: 'Settings not found' });
    }
    return res.json({ settings: mapSettingsDto(settings) });
  })
);

router.put(
  '/me/settings',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const updates: SqlFragment[] = [];

    if (body.theme !== undefined) updates.push(sql`theme = ${body.theme}`);
    if (body.chatWallpaper !== undefined) updates.push(sql`chat_wallpaper = ${body.chatWallpaper}`);
    if (body.fontSize !== undefined) updates.push(sql`font_size = ${body.fontSize}`);
    if (body.messageCorner !== undefined) updates.push(sql`message_corner = ${body.messageCorner}`);
    if (body.showStickersTab !== undefined) updates.push(sql`show_stickers_tab = ${body.showStickersTab}`);
    if (body.autoDownloadPhoto !== undefined) updates.push(sql`auto_download_photo = ${body.autoDownloadPhoto}`);
    if (body.autoDownloadVideo !== undefined) updates.push(sql`auto_download_video = ${body.autoDownloadVideo}`);
    if (body.autoDownloadDoc !== undefined) updates.push(sql`auto_download_doc = ${body.autoDownloadDoc}`);
    if (body.autoPlayGif !== undefined) updates.push(sql`auto_play_gif = ${body.autoPlayGif}`);
    if (body.notificationEnabled !== undefined) updates.push(sql`notification_enabled = ${body.notificationEnabled}`);
    if (body.notificationSound !== undefined) updates.push(sql`notification_sound = ${body.notificationSound}`);
    if (body.notificationPreview !== undefined) updates.push(sql`notification_preview = ${body.notificationPreview}`);
    if (body.notificationCountBadge !== undefined) {
      updates.push(sql`notification_count_badge = ${body.notificationCountBadge}`);
    }
    if (body.language !== undefined) updates.push(sql`language = ${stripControlChars(body.language)}`);
    if (body.timeFormat !== undefined) updates.push(sql`time_format = ${body.timeFormat}`);

    const updated = await runAsUser(req.user!.sub, async tx => {
      await tx.$executeRaw`
        INSERT INTO user_settings (user_id)
        VALUES (${req.user!.sub}::uuid)
        ON CONFLICT (user_id) DO NOTHING
      `;

      if (updates.length > 0) {
        await tx.$executeRaw(
          sql`
            UPDATE user_settings
            SET ${joinSql(updates, ', ')}
            WHERE user_id = ${req.user!.sub}::uuid
          `
        );
      }

      const rows = await tx.$queryRaw<UserSettingsRow[]>`
        SELECT
          user_id,
          theme,
          chat_wallpaper,
          font_size,
          message_corner,
          show_stickers_tab,
          auto_download_photo,
          auto_download_video,
          auto_download_doc,
          auto_play_gif,
          notification_enabled,
          notification_sound,
          notification_preview,
          notification_count_badge,
          language,
          time_format,
          updated_at
        FROM user_settings
        WHERE user_id = ${req.user!.sub}::uuid
        LIMIT 1
      `;

      return rows[0] ?? null;
    });

    if (!updated) {
      return res.status(404).json({ message: 'Settings not found' });
    }

    return res.json({ settings: mapSettingsDto(updated) });
  })
);

router.get(
  '/',
  requireAuth,
  userLookupRateLimiter,
  asyncHandler(async (req, res) => {
    const query = searchUsersQuerySchema.parse(req.query);
    const page = await loadPagedDirectoryUsers({
      actorId: req.user!.sub,
      isRoot: req.user!.isRoot,
      query: query.q ?? query.query ?? '',
      limitRaw: query.limit,
      cursorRaw: query.cursor,
      res
    });
    return res.json(page);
  })
);

router.delete(
  '/:id',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    if (!req.user?.isRoot) {
      return res.status(404).json({ message: 'User not found' });
    }

    const params = userIdParamSchema.parse(req.params);

    const targetRows = await runForUserDirectory(req.user.sub, true, tx =>
      tx.$queryRaw<UserDeleteTargetRow[]>(
        sql`
          SELECT
            id,
            is_root,
            avatar_url
          FROM users
          WHERE id = ${params.id}::uuid
            AND is_deleted = false
          LIMIT 1
        `
      )
    );

    const target = targetRows[0];
    if (!target) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (params.id === req.user.sub) {
      return res.status(400).json({
        message: 'Root cannot delete itself',
        code: 'ROOT_SELF_DELETE_BLOCKED'
      });
    }

    if (target.is_root) {
      return res.status(400).json({
        message: 'Root user deletion is blocked',
        code: 'ROOT_DELETE_BLOCKED'
      });
    }

    let deletedUserId: string | null = null;
    for (let attempt = 0; attempt < 3 && !deletedUserId; attempt += 1) {
      const deletedUsername = makeDeletedUsername();
      const tombstoneSecret = `${randomUUID()}${randomUUID()}`;
      const tombstonePasswordHash = await bcrypt.hash(tombstoneSecret, BCRYPT_COST);
      assertBcryptHash(tombstonePasswordHash, 'users.delete.password_hash');

      try {
        const deletedRows = await runForRootUserDelete(req.user.sub, params.id, async tx => {
          await tx.$executeRaw(
            sql`
              UPDATE sessions
              SET
                is_active = false,
                last_activity = NOW(),
                expires_at = NOW()
              WHERE user_id = ${params.id}::uuid
            `
          );

          await tx.$executeRaw(
            sql`
              DELETE FROM contacts
              WHERE user_id = ${params.id}::uuid
                 OR contact_user_id = ${params.id}::uuid
            `
          );

          return tx.$queryRaw<{ id: string }[]>(
            sql`
              UPDATE users
              SET
                username = ${deletedUsername},
                email = NULL,
                phone = NULL,
                password_hash = ${tombstonePasswordHash},
                first_name = 'Deleted',
                last_name = 'User',
                bio = NULL,
                avatar_url = NULL,
                status = 'offline',
                custom_status = NULL,
                is_active = false,
                is_root = false,
                is_deleted = true,
                deleted_at = NOW()
              WHERE id = ${params.id}::uuid
                AND is_deleted = false
                AND is_root = false
              RETURNING id
            `
          );
        });

        const deleted = deletedRows[0];
        if (!deleted) {
          return res.status(404).json({ message: 'User not found' });
        }
        deletedUserId = deleted.id;
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    if (!deletedUserId) {
      throw new Error('Unable to generate unique tombstone identity for deleted user');
    }

    if (target.avatar_url) {
      deleteAvatarByUrl(target.avatar_url).catch(err => {
        console.error(`Failed to delete physical avatar file for user ${params.id}:`, err);
      });
    }

    await Promise.all([
      invalidateUsersForUser(req.user.sub),
      invalidateContactsForUser(req.user.sub),
      invalidateUsersForUser(params.id),
      invalidateContactsForUser(params.id),
      invalidateChatsForUsers([req.user.sub, params.id])
    ]);

    return res.json({ success: true, deletedUserId });
  })
);

router.get(
  '/:id',
  requireAuth,
  userLookupRateLimiter,
  asyncHandler(async (req, res) => {
    const params = userIdParamSchema.parse(req.params);
    const user = await loadDirectoryUserById(req.user!.sub, req.user!.isRoot, params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ user: mapDirectoryUser(user) });
  })
);

export default router;
