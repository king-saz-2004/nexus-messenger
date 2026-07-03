import type { NextFunction, Request, Response } from 'express';
import { runAsUser } from '../config/dbContext.js';
import { hashToken, verifyAccessToken } from '../utils/tokens.js';

type SessionAccessRow = {
  id: string;
  user_id: string;
  is_root: boolean;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = typeof req.cookies?.accessToken === 'string' ? req.cookies.accessToken : null;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = verifyAccessToken(token);
    const tokenHash = hashToken(token);

    const session = await runAsUser(payload.sub, async tx => {
      const sessionRows = await tx.$queryRaw<SessionAccessRow[]>`
        SELECT s.id, s.user_id, u.is_root
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
      `;

      const currentSession = sessionRows[0];
      if (!currentSession) {
        return null;
      }

      await tx.$executeRaw`
        UPDATE sessions
        SET last_activity = NOW()
        WHERE id = ${payload.sid}::uuid
      `;

      return currentSession;
    });

    if (!session) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = {
      sub: session.user_id,
      sid: payload.sid,
      role: 'USER',
      isRoot: session.is_root,
      typ: 'access',
      iat: payload.iat,
      exp: payload.exp
    };

    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
