import type { Socket } from 'socket.io';
import { sql } from '../config/sql.js';
import { runAsUser } from '../config/dbContext.js';
import { hashToken, verifyAccessToken } from '../utils/tokens.js';
import type { AuthResult, ChatNamespace, SocketAuthRow } from './types.js';

const readCookie = (rawCookieHeader: string | undefined, cookieName: string) => {
  if (!rawCookieHeader) return null;
  const pairs = rawCookieHeader.split(';');
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = pair.slice(0, separatorIndex).trim();
    if (key !== cookieName) continue;
    const rawValue = pair.slice(separatorIndex + 1).trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
};

const resolveAccessToken = (socket: Socket) => {
  const rawCookieHeader = socket.handshake.headers.cookie;
  const cookieHeader = Array.isArray(rawCookieHeader) ? rawCookieHeader[0] : rawCookieHeader;
  if (typeof cookieHeader !== 'string') return null;
  return readCookie(cookieHeader, 'accessToken');
};

const authenticateSocketUser = async (token: string): Promise<AuthResult | null> => {
  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return null;
  }

  const tokenHash = hashToken(token);
  const rows = await runAsUser(payload.sub, tx =>
    tx.$queryRaw<SocketAuthRow[]>(
      sql`
        SELECT s.user_id, u.username
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = ${payload.sid}::uuid
          AND s.user_id = ${payload.sub}::uuid
          AND s.token_hash = ${tokenHash}
          AND s.is_active = true
          AND s.expires_at > NOW()
          AND u.is_active = true
          AND u.is_deleted = false
          AND u.registration_status = 'active'
        LIMIT 1
      `
    )
  );

  const row = rows[0];
  if (!row) return null;

  await runAsUser(payload.sub, tx =>
    tx.$executeRaw(
      sql`
        UPDATE sessions
        SET last_activity = NOW()
        WHERE id = ${payload.sid}::uuid
      `
    )
  );

  return {
    userId: row.user_id,
    username: row.username
  };
};

export const registerSocketAuthMiddleware = (namespace: ChatNamespace) => {
  namespace.use(async (socket, next) => {
    const token = resolveAccessToken(socket);
    if (!token) {
      next(new Error('Unauthorized'));
      return;
    }

    const auth = await authenticateSocketUser(token);
    if (!auth) {
      next(new Error('Unauthorized'));
      return;
    }

    socket.data.userId = auth.userId;
    socket.data.username = auth.username;
    next();
  });
};
