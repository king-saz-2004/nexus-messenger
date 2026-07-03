import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { sql, emptySql } from '../config/sql.js';
import { isUniqueViolation } from '../utils/errors.js';
import { z } from 'zod';
import { getCache } from '../cache/index.js';
import type { DbExecutor } from '../config/dbContext.js';
import { runAsUser, runForAuthLookup } from '../config/dbContext.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter, loginRateLimiter } from '../middleware/rateLimits.js';
import {
  getActiveUserByIdWithClient,
  getAvatarColorIndex,
  getUserByUsernameWithClient,
  toAuthUserDto,
  type AuthUserRow
} from '../services/authUser.js';
import { hashToken, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../utils/tokens.js';
import { decodeCursor, encodeCursor, parseLimit } from '../utils/pagination.js';
import {
  duplicateIdentityMessage,
  normalizeOptionalEmail,
  normalizeOptionalPhone,
  normalizeUsername,
  resolveDuplicateIdentityCode,
  type DuplicateIdentityCode
} from '../utils/identity.js';
import { assertBcryptHash } from '../utils/passwordHash.js';
import { getPublicRegistrationSettings } from '../services/appSettings.js';

const router = Router();

const PHONE_E164_REGEX = /^\+[1-9]\d{1,14}$/;
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
const BCRYPT_COST = 12;
const ACCESS_COOKIE_NAME = 'accessToken';
const REFRESH_COOKIE_NAME = 'refreshToken';
const LOGIN_LOCK_PREFIX = 'security:login-lock:';

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  refresh_token_hash: string | null;
  is_active: boolean;
  created_at: Date;
  last_activity: Date;
  expires_at: Date;
  device_name: string | null;
  device_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

type SessionWithUserRow = SessionRow & {
  user_is_active: boolean;
  user_is_deleted: boolean;
  user_registration_status: 'pending' | 'active' | 'rejected';
};

const optionalTrimmedString = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, schema.optional());

const stripControlChars = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').trim();

const registerSchema = z.object({
  username: z.string().trim().min(4).max(32).regex(USERNAME_REGEX),
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1).max(64),
  lastName: optionalTrimmedString(z.string().max(64)),
  email: optionalTrimmedString(z.string().email().max(255)),
  phone: optionalTrimmedString(z.string().regex(PHONE_E164_REGEX))
});

const loginSchema = z.object({
  username: z.string().trim().min(4).max(32).regex(USERNAME_REGEX),
  password: z.string().min(8).max(128)
});

const sessionIdSchema = z.object({
  id: z.string().uuid()
});

const listSessionsQuerySchema = z.object({
  limit: z.unknown().optional(),
  cursor: z.string().trim().min(1).max(200).optional()
});

const parseDurationToMs = (raw: string, fallbackMs: number) => {
  const match = /^(\d+)([smhd])$/i.exec(raw.trim());
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const multiplier = multipliers[unit];
  if (!multiplier || Number.isNaN(amount) || amount <= 0) return fallbackMs;
  return amount * multiplier;
};

const accessCookieMaxAgeMs = parseDurationToMs(env.accessTokenTtl, 15 * 60 * 1000);
const refreshCookieMaxAgeMs = parseDurationToMs(env.refreshTokenTtl, 7 * 24 * 60 * 60 * 1000);

const baseCookieOptions = {
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite as 'lax' | 'strict' | 'none',
  path: '/'
} as const;

const setAccessCookie = (res: Response, token: string) => {
  res.cookie(ACCESS_COOKIE_NAME, token, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: accessCookieMaxAgeMs
  });
};

const setRefreshCookie = (res: Response, token: string) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: refreshCookieMaxAgeMs
  });
};

const issueCsrfToken = () => randomBytes(24).toString('base64url');

const setCsrfCookie = (res: Response, csrfToken: string) => {
  res.cookie(env.csrfCookieName, csrfToken, {
    ...baseCookieOptions,
    httpOnly: false,
    maxAge: refreshCookieMaxAgeMs
  });
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE_NAME, { path: '/' });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/auth/refresh' });
  res.clearCookie(env.csrfCookieName, { path: '/' });
};

const extractIpAddress = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : Array.isArray(forwarded) ? forwarded[0] : '';
  const rawIp = (firstForwarded || req.ip || '').trim();
  if (!rawIp) return null;
  if (rawIp === '::1') return '127.0.0.1';
  if (rawIp.startsWith('::ffff:')) return rawIp.slice(7);
  return rawIp;
};

const getDeviceName = (req: Request) => {
  const userAgent = req.get('user-agent')?.trim();
  if (!userAgent) return 'web';
  return userAgent.slice(0, 100);
};

type LoginLockState = {
  failures: number;
  lockedUntil: number | null;
};

const getLoginLockKey = (username: string, req: Request) => {
  const ip = extractIpAddress(req) ?? 'unknown';
  return `${LOGIN_LOCK_PREFIX}${username}:${ip}`;
};

const getLoginLockState = async (key: string) => {
  try {
    const cache = getCache();
    const cached = await cache.get<LoginLockState>(key);
    if (!cached.hit) {
      return {
        failures: 0,
        lockedUntil: null
      } satisfies LoginLockState;
    }
    return {
      failures: Math.max(0, Math.trunc(cached.value.failures || 0)),
      lockedUntil: typeof cached.value.lockedUntil === 'number' ? cached.value.lockedUntil : null
    } satisfies LoginLockState;
  } catch {
    return {
      failures: 0,
      lockedUntil: null
    } satisfies LoginLockState;
  }
};

const setLoginLockState = async (key: string, state: LoginLockState) => {
  try {
    const cache = getCache();
    const now = Date.now();
    const lockWindowSeconds = env.authLockWindowSeconds;
    const dynamicSeconds =
      typeof state.lockedUntil === 'number' && state.lockedUntil > now
        ? Math.ceil((state.lockedUntil - now) / 1000)
        : lockWindowSeconds;
    const ttlSeconds = Math.max(lockWindowSeconds, dynamicSeconds);
    await cache.set(key, state, ttlSeconds);
  } catch {
    // ignore cache write failures
  }
};

const clearLoginLockState = async (key: string) => {
  try {
    const cache = getCache();
    await cache.del(key);
  } catch {
    // ignore cache delete failures
  }
};

const getRemainingLockSeconds = (state: LoginLockState) => {
  if (!state.lockedUntil) return 0;
  const delta = state.lockedUntil - Date.now();
  return delta > 0 ? Math.ceil(delta / 1000) : 0;
};

const writeSecurityAudit = async (userId: string, action: string, details: Record<string, unknown>) => {
  await runAsUser(userId, tx =>
    tx.$executeRaw(
      sql`
        INSERT INTO audit_log (chat_id, actor_id, target_id, action, details)
        VALUES (NULL, ${userId}::uuid, ${userId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)
      `
    )
  );
};

const detectDuplicateIdentity = async (params: {
  username: string;
  email: string | null;
  phone: string | null;
}): Promise<DuplicateIdentityCode | null> => {
  return runForAuthLookup(async tx => {
    const usernameRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM users
      WHERE lower(username) = ${params.username}
      LIMIT 1
    `;
    if (usernameRows.length > 0) {
      return 'DUPLICATE_USERNAME';
    }

    if (params.email) {
      const emailRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM users
        WHERE email IS NOT NULL
          AND lower(email) = ${params.email}
        LIMIT 1
      `;
      if (emailRows.length > 0) {
        return 'DUPLICATE_EMAIL';
      }
    }

    if (params.phone) {
      const phoneRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM users
        WHERE phone IS NOT NULL
          AND phone = ${params.phone}
        LIMIT 1
      `;
      if (phoneRows.length > 0) {
        return 'DUPLICATE_PHONE';
      }
    }

    return null;
  });
};

const areHashesEqual = (left: string | null, right: string) => {
  if (!left) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const createSessionTokens = (userId: string, sessionId: string, isRoot: boolean) => {
  const claims = {
    sub: userId,
    sid: sessionId,
    role: 'USER',
    isRoot
  } as const;

  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken(claims);

  return { accessToken, refreshToken };
};

const insertSession = async (params: {
  client: DbExecutor;
  sessionId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  req: Request;
}) => {
  const refreshPayload = verifyRefreshToken(params.refreshToken);
  const refreshExpiresAt = new Date(refreshPayload.exp * 1000);
  const ipAddress = extractIpAddress(params.req);
  const userAgent = params.req.get('user-agent')?.trim() ?? null;
  const deviceName = getDeviceName(params.req);
  const ipValue = ipAddress ? sql`${ipAddress}::inet` : sql`NULL`;
  const userAgentValue = userAgent ? sql`${userAgent}` : sql`NULL`;

  await params.client.$executeRaw(
    sql`
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        refresh_token_hash,
        device_name,
        device_type,
        ip_address,
        user_agent,
        is_active,
        last_activity,
        expires_at
      )
      VALUES (
        ${params.sessionId}::uuid,
        ${params.userId}::uuid,
        ${hashToken(params.accessToken)},
        ${hashToken(params.refreshToken)},
        ${deviceName},
        'web',
        ${ipValue},
        ${userAgentValue},
        true,
        NOW(),
        ${refreshExpiresAt}
      )
    `
  );
};

const rotateSessionTokens = async (params: {
  client: DbExecutor;
  sessionId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}) => {
  const refreshPayload = verifyRefreshToken(params.refreshToken);
  const refreshExpiresAt = new Date(refreshPayload.exp * 1000);

  await params.client.$executeRaw`
    UPDATE sessions
    SET
      token_hash = ${hashToken(params.accessToken)},
      refresh_token_hash = ${hashToken(params.refreshToken)},
      last_activity = NOW(),
      expires_at = ${refreshExpiresAt},
      is_active = true
    WHERE id = ${params.sessionId}::uuid
      AND user_id = ${params.userId}::uuid
  `;
};

const getSessionForRefresh = async (client: DbExecutor, sessionId: string, userId: string) => {
  const rows = await client.$queryRaw<SessionWithUserRow[]>`
    SELECT
      s.id,
      s.user_id,
      s.token_hash,
      s.refresh_token_hash,
      s.is_active,
      s.created_at,
      s.last_activity,
      s.expires_at,
      s.device_name,
      s.device_type,
      s.ip_address::text AS ip_address,
      s.user_agent,
      u.is_active AS user_is_active,
      u.is_deleted AS user_is_deleted,
      u.registration_status AS user_registration_status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId}::uuid
      AND s.user_id = ${userId}::uuid
    LIMIT 1
  `;

  return rows[0] ?? null;
};

const revokeAllUserSessions = async (userId: string) => {
  await runAsUser(userId, async tx => {
    await tx.$executeRaw`
      UPDATE sessions
      SET
        is_active = false,
        expires_at = NOW(),
        last_activity = NOW()
      WHERE user_id = ${userId}::uuid
        AND is_active = true
    `;

    await tx.$executeRaw`
      UPDATE users
      SET status = 'offline', last_seen = NOW()
      WHERE id = ${userId}::uuid
    `;
  });
};

router.get('/registration-settings', async (req, res, next) => {
  try {
    const settings = await getPublicRegistrationSettings();
    return res.json(settings);
  } catch (error) {
    return next(error);
  }
});

const getUserByUsernameForLogin = async (client: DbExecutor, username: string): Promise<AuthUserRow | null> => {
  const normalized = username.trim().toLowerCase();
  const rows = await client.$queryRaw<AuthUserRow[]>`
    SELECT
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
      registration_status,
      created_at,
      updated_at
    FROM users
    WHERE LOWER(username) = ${normalized}
      AND is_deleted = false
    LIMIT 1
  `;
  return rows[0] ?? null;
};

const DUMMY_HASH = '$2b$12$K.R7/zWv6TdfgOLeP48s/OqZqWc1V5CjA0K7O9yB/H8s.8Qh2P7Jy';

router.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const id = randomUUID();
    const username = normalizeUsername(body.username);
    const email = normalizeOptionalEmail(body.email) ?? null;
    const phone = normalizeOptionalPhone(body.phone) ?? null;
    const firstName = stripControlChars(body.firstName);
    const lastName = body.lastName ? stripControlChars(body.lastName) : null;

    const duplicateCode = await detectDuplicateIdentity({ username, email, phone });
    if (duplicateCode) {
      return res.status(409).json({
        message: duplicateIdentityMessage(duplicateCode),
        code: duplicateCode
      });
    }

    const settings = await getPublicRegistrationSettings();
    const reqFields = settings.registrationRequiredFields;
    const missingFields: string[] = [];
    if (reqFields.lastName && !lastName) {
      missingFields.push('lastName');
    }
    if (reqFields.email && !email) {
      missingFields.push('email');
    }
    if (reqFields.phone && !phone) {
      missingFields.push('phone');
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: 'Required registration fields are missing',
        code: 'REQUIRED_REGISTRATION_FIELDS_MISSING',
        fields: missingFields
      });
    }

    const isPending = settings.registrationMode === 'private';

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    assertBcryptHash(passwordHash, 'auth.register.password_hash');
    const avatarColor = getAvatarColorIndex(id);

    const sessionId = randomUUID();
    const { accessToken, refreshToken } = createSessionTokens(id, sessionId, false);
    const user = await runAsUser(id, async tx => {
      const insertedRows = await tx.$queryRaw<AuthUserRow[]>`
        INSERT INTO users (
          id,
          username,
          email,
          phone,
          password_hash,
          first_name,
          last_name,
          avatar_color,
          status,
          is_active,
          is_deleted,
          registration_status
        )
        VALUES (
          ${id}::uuid,
          ${username},
          ${email},
          ${phone},
          ${passwordHash},
          ${firstName},
          ${lastName},
          ${avatarColor},
          'offline',
          ${!isPending},
          false,
          ${isPending ? 'pending' : 'active'}
        )
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
          registration_status,
          created_at,
          updated_at
      `;

      if (!isPending) {
        await insertSession({
          client: tx,
          sessionId,
          userId: id,
          accessToken,
          refreshToken,
          req
        });
      }

      return insertedRows[0];
    });

    if (isPending) {
      return res.status(202).json({
        status: 'pending_approval',
        message: 'Registration submitted and pending approval.'
      });
    }

    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    const csrfToken = issueCsrfToken();
    setCsrfCookie(res, csrfToken);

    return res.status(201).json({
      user: toAuthUserDto(user),
      csrfToken
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const requestBody = req.body as Record<string, unknown>;
      const normalizedUsername = typeof requestBody?.username === 'string' ? normalizeUsername(requestBody.username) : null;
      const normalizedEmail =
        typeof requestBody?.email === 'string' || requestBody?.email == null
          ? normalizeOptionalEmail(requestBody.email as string | null | undefined) ?? null
          : null;
      const normalizedPhone =
        typeof requestBody?.phone === 'string' || requestBody?.phone == null
          ? normalizeOptionalPhone(requestBody.phone as string | null | undefined) ?? null
          : null;

      const code =
        resolveDuplicateIdentityCode(error) ??
        (normalizedUsername
          ? await detectDuplicateIdentity({
              username: normalizedUsername,
              email: normalizedEmail,
              phone: normalizedPhone
            })
          : null) ??
        'DUPLICATE_USERNAME';
      return res.status(409).json({
        message: duplicateIdentityMessage(code),
        code
      });
    }
    return next(error);
  }
});

router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const username = normalizeUsername(body.username);
    const lockKey = getLoginLockKey(username, req);
    const lockState = await getLoginLockState(lockKey);
    const lockedForSeconds = getRemainingLockSeconds(lockState);
    if (lockedForSeconds > 0) {
      res.setHeader('Retry-After', String(lockedForSeconds));
      return res.status(429).json({
        message: 'Too many login attempts. Try again later.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: lockedForSeconds
      });
    }

    const applyLoginFailure = async (userId?: string) => {
      const current = await getLoginLockState(lockKey);
      const nextFailures = current.failures + 1;
      const shouldLock = nextFailures >= env.authLockMaxAttempts;
      const nextState: LoginLockState = {
        failures: nextFailures,
        lockedUntil: shouldLock ? Date.now() + env.authLockWindowSeconds * 1000 : null
      };
      await setLoginLockState(lockKey, nextState);

      const retryAfterSeconds = getRemainingLockSeconds(nextState);
      if (shouldLock) {
        if (userId) {
          await writeSecurityAudit(userId, 'security_login_lockout', {
            username,
            lockSeconds: retryAfterSeconds,
            ipAddress: extractIpAddress(req)
          }).catch(() => undefined);
        }
        res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
        return res.status(429).json({
          message: 'Too many login attempts. Try again later.',
          code: 'RATE_LIMITED',
          retryAfterSeconds: Math.max(1, retryAfterSeconds)
        });
      }

      return res.status(401).json({ message: 'Invalid credentials' });
    };

    const user = await runForAuthLookup(tx => getUserByUsernameForLogin(tx, username));
    if (!user) {
      await bcrypt.compare(body.password, DUMMY_HASH);
      return applyLoginFailure();
    }

    const passwordOk = await bcrypt.compare(body.password, user.password_hash);
    if (!passwordOk) {
      return applyLoginFailure(user.id);
    }

    await clearLoginLockState(lockKey);

    if (user.registration_status === 'pending') {
      return res.status(403).json({
        message: 'Registration is pending approval.',
        code: 'REGISTRATION_PENDING'
      });
    }

    if (user.registration_status === 'rejected') {
      return res.status(403).json({
        message: 'Registration was rejected.',
        code: 'REGISTRATION_REJECTED'
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        message: 'User account is inactive.',
        code: 'USER_INACTIVE'
      });
    }

    const sessionId = randomUUID();
    const { accessToken, refreshToken } = createSessionTokens(user.id, sessionId, user.is_root);
    const refreshedUser = await runAsUser(user.id, async tx => {
      await tx.$executeRaw`
        UPDATE users
        SET status = 'online', last_seen = NOW()
        WHERE id = ${user.id}::uuid
      `;

      await insertSession({
        client: tx,
        sessionId,
        userId: user.id,
        accessToken,
        refreshToken,
        req
      });

      return getActiveUserByIdWithClient(tx, user.id);
    });

    setRefreshCookie(res, refreshToken);
    setAccessCookie(res, accessToken);
    const csrfToken = issueCsrfToken();
    setCsrfCookie(res, csrfToken);

    if (!refreshedUser) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    return res.json({
      user: toAuthUserDto(refreshedUser),
      csrfToken
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (!refreshToken) {
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Missing refresh token' });
    }

    const payload = verifyRefreshToken(refreshToken);
    const session = await runAsUser(payload.sub, tx => getSessionForRefresh(tx, payload.sid, payload.sub));
    if (!session || !session.is_active || !session.user_is_active || session.user_is_deleted || session.user_registration_status !== 'active' || session.expires_at <= new Date()) {
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const incomingHash = hashToken(refreshToken);
    if (!areHashesEqual(session.refresh_token_hash, incomingHash)) {
      await revokeAllUserSessions(payload.sub).catch(() => undefined);
      await writeSecurityAudit(payload.sub, 'security_refresh_replay_detected', {
        sessionId: payload.sid,
        ipAddress: extractIpAddress(req)
      }).catch(() => undefined);
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const refreshedUser = await runAsUser(payload.sub, async tx => {
      const activeUser = await getActiveUserByIdWithClient(tx, payload.sub);
      if (!activeUser) {
        return null;
      }

      const { accessToken, refreshToken: rotatedRefreshToken } = createSessionTokens(
        payload.sub,
        payload.sid,
        activeUser.is_root
      );

      await rotateSessionTokens({
        client: tx,
        sessionId: payload.sid,
        userId: payload.sub,
        accessToken: accessToken,
        refreshToken: rotatedRefreshToken
      });

      await tx.$executeRaw`
        UPDATE users
        SET status = 'online', last_seen = NOW()
        WHERE id = ${payload.sub}::uuid
      `;

      return { accessToken, rotatedRefreshToken };
    });

    if (!refreshedUser) {
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    setAccessCookie(res, refreshedUser.accessToken);
    setRefreshCookie(res, refreshedUser.rotatedRefreshToken);
    const csrfToken = issueCsrfToken();
    setCsrfCookie(res, csrfToken);
    return res.json({ csrfToken });
  } catch (error) {
    if (
      error instanceof Error && (
        error.name === 'JsonWebTokenError' ||
        error.name === 'TokenExpiredError' ||
        error.name === 'NotBeforeError' ||
        error.message.toLowerCase().includes('token') ||
        error.message.toLowerCase().includes('jwt') ||
        error.message.toLowerCase().includes('expired') ||
        error.message.toLowerCase().includes('signature') ||
        error.message.toLowerCase().includes('malformed')
      )
    ) {
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    return next(error);
  }
});

router.post('/logout', async (req, res) => {
  let tokenPayload: { sid: string; sub: string } | null = null;
  const accessToken = typeof req.cookies?.[ACCESS_COOKIE_NAME] === 'string' ? req.cookies[ACCESS_COOKIE_NAME] : null;

  if (accessToken) {
    try {
      const payload = verifyAccessToken(accessToken);
      tokenPayload = { sid: payload.sid, sub: payload.sub };
    } catch {
      tokenPayload = null;
    }
  }

  if (!tokenPayload) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(refreshToken);
        tokenPayload = { sid: payload.sid, sub: payload.sub };
      } catch {
        tokenPayload = null;
      }
    }
  }

  if (tokenPayload) {
    try {
      await runAsUser(tokenPayload.sub, async tx => {
        await tx.$executeRaw`
          UPDATE sessions
          SET is_active = false, last_activity = NOW(), expires_at = NOW()
          WHERE id = ${tokenPayload.sid}::uuid
            AND user_id = ${tokenPayload.sub}::uuid
        `;

        await tx.$executeRaw`
          UPDATE users
          SET status = 'offline', last_seen = NOW()
          WHERE id = ${tokenPayload.sub}::uuid
        `;
      });
    } catch {
      // Best-effort: cookie is still cleared below regardless
    }
  }

  clearAuthCookies(res);
  const csrfToken = issueCsrfToken();
  setCsrfCookie(res, csrfToken);
  return res.json({ message: 'Logged out', csrfToken });
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await runAsUser(req.user!.sub, tx => getActiveUserByIdWithClient(tx, req.user!.sub));
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ user: toAuthUserDto(user) });
  } catch (error) {
    return next(error);
  }
});

router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const query = listSessionsQuerySchema.parse(req.query);
    const limit = parseLimit(query.limit, { fallback: 25, min: 1, max: 100 });
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor ?? null);

    const rows = await runAsUser(req.user!.sub, tx =>
      tx.$queryRaw<SessionRow[]>`
        SELECT
          id,
          user_id,
          token_hash,
          refresh_token_hash,
          is_active,
          created_at,
          last_activity,
          expires_at,
          device_name,
          device_type,
          ip_address::text AS ip_address,
          user_agent
        FROM sessions
        WHERE user_id = ${req.user!.sub}::uuid
          AND is_active = true
          AND expires_at > NOW()
          ${
            cursor?.createdAt && cursor?.id
              ? sql`AND (created_at, id) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`
              : emptySql
          }
        ORDER BY created_at DESC
        LIMIT ${limit + 1}
      `
    );

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const sessions = sliced.map(session => ({
      id: session.id,
      deviceName: session.device_name,
      deviceType: session.device_type,
      ipAddress: session.ip_address,
      userAgent: session.user_agent,
      isActive: session.is_active,
      lastActivity: session.last_activity.toISOString(),
      createdAt: session.created_at.toISOString(),
      expiresAt: session.expires_at.toISOString(),
      isCurrent: session.id === req.user!.sid
    }));

    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            id: last.id,
            createdAt: last.created_at.toISOString()
          })
        : undefined;

    return res.json({ sessions, limit, nextCursor, hasMore });
  } catch (error) {
    return next(error);
  }
});

router.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const params = sessionIdSchema.parse(req.params);
    const rows = await runAsUser(req.user!.sub, tx =>
      tx.$queryRaw<{ id: string }[]>`
        UPDATE sessions
        SET is_active = false, last_activity = NOW(), expires_at = NOW()
        WHERE id = ${params.id}::uuid
          AND user_id = ${req.user!.sub}::uuid
        RETURNING id
      `
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    if (params.id === req.user!.sid) {
      clearAuthCookies(res);
      setCsrfCookie(res, issueCsrfToken());
    }

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

export default router;
