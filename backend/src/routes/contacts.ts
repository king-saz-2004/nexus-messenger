import { Router } from 'express';
import { sql } from '../config/sql.js';
import { z } from 'zod';
import { cacheKeys } from '../cache/cacheKeys.js';
import { cached } from '../cache/index.js';
import { invalidateContactsForUser, invalidateUsersForUser } from '../cache/invalidation.js';
import { runAsUser, runForUserDirectory } from '../config/dbContext.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { mutationRateLimiter } from '../middleware/rateLimits.js';
import { toPublicUserDto, type PublicUserRow } from '../services/authUser.js';
import { paginateArrayByCursor, parseLimit } from '../utils/pagination.js';
import { toIso } from '../utils/dates.js';
import { isForeignKeyViolation } from '../utils/errors.js';

const router = Router();

type ContactUserRow = PublicUserRow & {
  is_contact: boolean;
  is_blocked: boolean;
  is_favorite: boolean;
  contact_custom_name: string | null;
};

type ContactRow = {
  id: string;
  user_id: string;
  contact_user_id: string;
  custom_name: string | null;
  is_blocked: boolean;
  is_favorite: boolean;
  blocked_at: Date | null;
  created_at: Date;
};



const contactBodySchema = z.object({
  userId: z.string().uuid(),
  customName: z
    .preprocess(value => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }, z.string().max(64).nullable().optional())
    .optional(),
  isFavorite: z.boolean().optional()
});

const userIdParamSchema = z.object({
  userId: z.string().uuid()
});

const listContactsQuerySchema = z.object({
  limit: z.unknown().optional(),
  cursor: z.string().trim().min(1).max(200).optional()
});



const loadContactUser = async (viewerId: string, viewerIsRoot: boolean, userId: string) => {
  const rows = await runForUserDirectory(viewerId, viewerIsRoot, tx =>
    tx.$queryRaw<ContactUserRow[]>(
      sql`
        SELECT
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
          u.updated_at,
          (c.id IS NOT NULL) AS is_contact,
          COALESCE(c.is_blocked, false) AS is_blocked,
          COALESCE(c.is_favorite, false) AS is_favorite,
          c.custom_name AS contact_custom_name
        FROM users u
        LEFT JOIN contacts c
          ON c.user_id = ${viewerId}::uuid
         AND c.contact_user_id = u.id
        WHERE u.id = ${userId}::uuid
          AND u.is_active = true
          AND u.is_deleted = false
          AND u.registration_status = 'active'
        LIMIT 1
      `
    )
  );

  return rows[0] ?? null;
};

const mapContactUser = (row: ContactUserRow) => ({
  ...toPublicUserDto(row),
  isContact: row.is_contact,
  isBlocked: row.is_blocked,
  isFavorite: row.is_favorite,
  contactCustomName: row.contact_custom_name ?? undefined
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listContactsQuerySchema.parse(req.query);
    const limit = parseLimit(query.limit, { fallback: 50, min: 1, max: 200 });

    const cacheKey = cacheKeys.contacts(req.user!.sub, null, 500);
    const contacts = await cached({
      key: cacheKey,
      ttlSeconds: env.cacheContactsTtlSeconds,
      res,
      onMiss: async () =>
        runForUserDirectory(req.user!.sub, req.user!.isRoot, tx =>
          tx.$queryRaw<
            Array<
              ContactRow & {
                user: ContactUserRow;
              }
            >
          >(
            sql`
              SELECT
                c.id,
                c.user_id,
                c.contact_user_id,
                c.custom_name,
                c.is_blocked,
                c.is_favorite,
                c.blocked_at,
                c.created_at,
                row_to_json(u) AS user
              FROM contacts c
              JOIN LATERAL (
                SELECT
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
                  u.updated_at,
                  true AS is_contact,
                  c.is_blocked AS is_blocked,
                  c.is_favorite AS is_favorite,
                  c.custom_name AS contact_custom_name
                FROM users u
                WHERE u.id = c.contact_user_id
                  AND u.is_active = true
                  AND u.is_deleted = false
                  AND u.registration_status = 'active'
                LIMIT 1
              ) u ON true
              WHERE c.user_id = ${req.user!.sub}::uuid
              ORDER BY c.is_favorite DESC, LOWER(COALESCE(c.custom_name, u.first_name)), LOWER(u.username)
            `
          )
        )
    });

    const mapped = contacts.map(contact => ({
      id: contact.id,
      userId: contact.contact_user_id,
      customName: contact.custom_name ?? undefined,
      isBlocked: contact.is_blocked,
      isFavorite: contact.is_favorite,
      blockedAt: toIso(contact.blocked_at),
      createdAt: toIso(contact.created_at),
      user: mapContactUser(contact.user)
    }));

    const page = paginateArrayByCursor(mapped, {
      limit,
      cursor: query.cursor,
      extractCursor: row => row.id
    });

    return res.json({
      contacts: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    });
  })
);

router.post(
  '/',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = contactBodySchema.parse(req.body);
    if (body.userId === req.user!.sub) {
      return res.status(400).json({ message: 'Cannot add yourself as a contact' });
    }

    let contact: ContactRow | undefined;
    try {
      contact = await runAsUser(req.user!.sub, async tx => {
        await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'on', true)`;
        const targetUser = await tx.$queryRaw<any[]>`
          SELECT id FROM users
          WHERE id = ${body.userId}::uuid
            AND is_active = true
            AND is_deleted = false
            AND registration_status = 'active'
          LIMIT 1
        `;
        if (targetUser.length === 0) {
          throw new Error('User not found');
        }

        const existingRows = await tx.$queryRaw<ContactRow[]>`
          SELECT
            id,
            user_id,
            contact_user_id,
            custom_name,
            is_blocked,
            is_favorite,
            blocked_at,
            created_at
          FROM contacts
          WHERE user_id = ${req.user!.sub}::uuid
            AND contact_user_id = ${body.userId}::uuid
          LIMIT 1
        `;

        const existing = existingRows[0];
        const nextCustomName = body.customName !== undefined ? body.customName : existing?.custom_name ?? null;
        const nextFavorite = body.isFavorite !== undefined ? body.isFavorite : existing?.is_favorite ?? false;

        if (existing) {
          const updatedRows = await tx.$queryRaw<ContactRow[]>`
            UPDATE contacts
            SET
              custom_name = ${nextCustomName},
              is_favorite = ${nextFavorite}
            WHERE id = ${existing.id}::uuid
            RETURNING
              id,
              user_id,
              contact_user_id,
              custom_name,
              is_blocked,
              is_favorite,
              blocked_at,
              created_at
          `;
          return updatedRows[0];
        }

        const insertedRows = await tx.$queryRaw<ContactRow[]>`
          INSERT INTO contacts (
            user_id,
            contact_user_id,
            custom_name,
            is_favorite,
            is_blocked
          )
          VALUES (
            ${req.user!.sub}::uuid,
            ${body.userId}::uuid,
            ${nextCustomName},
            ${nextFavorite},
            false
          )
          RETURNING
            id,
            user_id,
            contact_user_id,
            custom_name,
            is_blocked,
            is_favorite,
            blocked_at,
            created_at
        `;
        return insertedRows[0];
      });
    } catch (error: any) {
      if (error.message === 'User not found' || isForeignKeyViolation(error)) {
        return res.status(404).json({ message: 'User not found' });
      }
      throw error;
    }

    const user = await loadContactUser(req.user!.sub, req.user!.isRoot, body.userId);
    if (!user || !contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    await invalidateContactsForUser(req.user!.sub);
    await invalidateUsersForUser(req.user!.sub);
    return res.status(201).json({
      contact: {
        id: contact.id,
        userId: contact.contact_user_id,
        customName: contact.custom_name ?? undefined,
        isBlocked: contact.is_blocked,
        isFavorite: contact.is_favorite,
        blockedAt: toIso(contact.blocked_at),
        createdAt: toIso(contact.created_at),
        user: mapContactUser(user)
      }
    });
  })
);

router.delete(
  '/:userId',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const params = userIdParamSchema.parse(req.params);
    const deletedRows = await runAsUser(req.user!.sub, tx =>
      tx.$queryRaw<{ id: string }[]>`
        DELETE FROM contacts
        WHERE user_id = ${req.user!.sub}::uuid
          AND contact_user_id = ${params.userId}::uuid
        RETURNING id
      `
    );

    if (deletedRows.length === 0) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    await invalidateContactsForUser(req.user!.sub);
    await invalidateUsersForUser(req.user!.sub);
    return res.json({ success: true });
  })
);

router.put(
  '/:userId/block',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const params = userIdParamSchema.parse(req.params);
    const user = await loadContactUser(req.user!.sub, req.user!.isRoot, params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updatedRows = await runAsUser(req.user!.sub, tx =>
      tx.$queryRaw<ContactRow[]>`
        INSERT INTO contacts (user_id, contact_user_id, is_blocked, blocked_at)
        VALUES (${req.user!.sub}::uuid, ${params.userId}::uuid, true, NOW())
        ON CONFLICT (user_id, contact_user_id)
        DO UPDATE SET is_blocked = true, blocked_at = NOW()
        RETURNING
          id,
          user_id,
          contact_user_id,
          custom_name,
          is_blocked,
          is_favorite,
          blocked_at,
          created_at
      `
    );

    const updated = updatedRows[0];
    if (!updated) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    await invalidateContactsForUser(req.user!.sub);
    await invalidateUsersForUser(req.user!.sub);
    return res.json({
      contact: {
        id: updated.id,
        userId: updated.contact_user_id,
        customName: updated.custom_name ?? undefined,
        isBlocked: updated.is_blocked,
        isFavorite: updated.is_favorite,
        blockedAt: toIso(updated.blocked_at),
        createdAt: toIso(updated.created_at),
        user: mapContactUser(user)
      }
    });
  })
);

router.put(
  '/:userId/unblock',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const params = userIdParamSchema.parse(req.params);
    const updatedRows = await runAsUser(req.user!.sub, tx =>
      tx.$queryRaw<ContactRow[]>`
        UPDATE contacts
        SET is_blocked = false, blocked_at = NULL
        WHERE user_id = ${req.user!.sub}::uuid
          AND contact_user_id = ${params.userId}::uuid
        RETURNING
          id,
          user_id,
          contact_user_id,
          custom_name,
          is_blocked,
          is_favorite,
          blocked_at,
          created_at
      `
    );

    const updated = updatedRows[0];
    if (!updated) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    const user = await loadContactUser(req.user!.sub, req.user!.isRoot, params.userId);
    if (!user) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    await invalidateContactsForUser(req.user!.sub);
    await invalidateUsersForUser(req.user!.sub);
    return res.json({
      contact: {
        id: updated.id,
        userId: updated.contact_user_id,
        customName: updated.custom_name ?? undefined,
        isBlocked: updated.is_blocked,
        isFavorite: updated.is_favorite,
        blockedAt: toIso(updated.blocked_at),
        createdAt: toIso(updated.created_at),
        user: mapContactUser(user)
      }
    });
  })
);

export default router;
