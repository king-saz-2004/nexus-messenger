import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { runForRootAdmin } from '../config/dbContext.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { z } from 'zod';
import { getCache } from '../cache/index.js';
import { mutationRateLimiter } from '../middleware/rateLimits.js';
import {
  getRegistrationModeWithClient,
  getRegistrationRequiredFieldsWithClient,
  setRegistrationRequiredFieldsWithClient,
  getMediaLimitsWithClient,
  setMediaLimitsWithClient
} from '../services/appSettings.js';
import { rootClearAllMessages, rootClearAllMedia } from '../services/messageSystem.js';
import { broadcastPlatformCleared } from '../sockets/index.js';

const router = Router();

const requireRoot: RequestHandler[] = [
  requireAuth,
  (req, res, next) => {
    if (!req.user || !req.user.isRoot) {
      return res.status(403).json({ message: 'Forbidden: Root access required' });
    }
    next();
  }
];

const userIdParamSchema = z.object({ id: z.string().uuid() });

interface PendingUserRow {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  avatar_color: string;
  status: string;
  last_seen: Date;
  is_root: boolean;
  is_active: boolean;
  is_deleted: boolean;
  registration_status: string;
  created_at: Date;
  updated_at: Date;
}

interface UserCheckRow {
  id: string;
  registration_status: string;
  is_root: boolean;
  is_deleted: boolean;
}

// GET /admin/settings
router.get('/settings', requireRoot, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await runForRootAdmin(req.user!.sub, async tx => {
      const mode = await getRegistrationModeWithClient(tx);
      const fields = await getRegistrationRequiredFieldsWithClient(tx);
      const mediaLimits = await getMediaLimitsWithClient(tx);
      return { registrationMode: mode, registrationRequiredFields: fields, mediaLimits };
    });
    return res.json(settings);
  } catch (error) {
    return next(error);
  }
});

// PUT /admin/settings/registration-mode
router.put('/settings/registration-mode', requireRoot, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bodySchema = z.object({
      mode: z.enum(['public', 'private'])
    });
    const { mode } = bodySchema.parse(req.body);

    await runForRootAdmin(req.user!.sub, async tx => {
      const rows = await tx.$executeRaw`
        INSERT INTO app_settings (key, value, updated_by)
        VALUES ('registration_mode', ${JSON.stringify(mode)}::jsonb, ${req.user!.sub}::uuid)
        ON CONFLICT (key) DO UPDATE
        SET value = ${JSON.stringify(mode)}::jsonb, updated_at = NOW(), updated_by = ${req.user!.sub}::uuid
      `;
    });

    const cache = getCache();
    await cache.delByPrefix('lookup:').catch(() => undefined);
    await cache.delByPrefix('users:').catch(() => undefined);

    return res.json({ success: true, registrationMode: mode });
  } catch (error) {
    return next(error);
  }
});

// PUT /admin/settings/registration-required-fields
router.put('/settings/registration-required-fields', requireRoot, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bodySchema = z.object({
      lastName: z.boolean(),
      email: z.boolean(),
      phone: z.boolean()
    });
    const fields = bodySchema.parse(req.body);

    await runForRootAdmin(req.user!.sub, async tx => {
      await setRegistrationRequiredFieldsWithClient(tx, fields, req.user!.sub);
    });

    const cache = getCache();
    await cache.delByPrefix('lookup:').catch(() => undefined);
    await cache.delByPrefix('users:').catch(() => undefined);

    return res.json({ success: true, registrationRequiredFields: fields });
  } catch (error) {
    return next(error);
  }
});

// PUT /admin/settings/media-limits
router.put('/settings/media-limits', requireRoot, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bodySchema = z.object({
      voice: z.number().finite().positive(),
      audio: z.number().finite().positive(),
      photo: z.number().finite().positive(),
      video: z.number().finite().positive()
    });
    const limits = bodySchema.parse(req.body);

    await runForRootAdmin(req.user!.sub, async tx => {
      await setMediaLimitsWithClient(tx, limits, req.user!.sub);
    });

    const cache = getCache();
    await cache.delByPrefix('lookup:').catch(() => undefined);
    await cache.delByPrefix('users:').catch(() => undefined);

    return res.json({ success: true, mediaLimits: limits });
  } catch (error) {
    return next(error);
  }
});

// GET /admin/users/pending
router.get('/users/pending', requireRoot, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pendingUsers = await runForRootAdmin(req.user!.sub, async tx => {
      const rows = await tx.$queryRaw<PendingUserRow[]>`
        SELECT
          id, username, email, phone, first_name, last_name, avatar_url, avatar_color,
          status, last_seen, is_root, is_active, is_deleted, registration_status, created_at, updated_at
        FROM users
        WHERE registration_status = 'pending'
          AND is_deleted = false
        ORDER BY created_at DESC
      `;
      return rows;
    });

    const dtos = pendingUsers.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email ?? '',
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.first_name,
      firstName: u.first_name,
      lastName: u.last_name ?? undefined,
      avatar: u.avatar_url ?? undefined,
      avatarColor: String(u.avatar_color),
      status: u.status,
      isOnline: u.status === 'online',
      lastSeenAt: u.last_seen ? new Date(u.last_seen).toISOString() : undefined,
      role: 'USER',
      isRoot: Boolean(u.is_root),
      registrationStatus: u.registration_status
    }));

    return res.json({ users: dtos });
  } catch (error) {
    return next(error);
  }
});

// POST /admin/users/:id/approve
router.post('/users/:id/approve', requireRoot, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: targetUserId } = userIdParamSchema.parse(req.params);

    const result = await runForRootAdmin(req.user!.sub, async tx => {
      const checkRows = await tx.$queryRaw<UserCheckRow[]>`
        SELECT id, registration_status, is_root, is_deleted FROM users WHERE id = ${targetUserId}::uuid LIMIT 1
      `;
      if (
        checkRows.length === 0 ||
        checkRows[0].registration_status !== 'pending' ||
        checkRows[0].is_root ||
        checkRows[0].is_deleted
      ) {
        return null;
      }

      await tx.$executeRaw`
        UPDATE users
        SET
          is_active = true,
          registration_status = 'active',
          approved_at = NOW(),
          approved_by = ${req.user!.sub}::uuid,
          updated_at = NOW()
        WHERE id = ${targetUserId}::uuid
      `;
      return true;
    });

    if (!result) {
      return res.status(400).json({ message: 'User is not pending, is root/deleted, or does not exist' });
    }

    const cache = getCache();
    await cache.delByPrefix('lookup:').catch(() => undefined);
    await cache.delByPrefix('users:').catch(() => undefined);

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

// POST /admin/users/:id/reject
router.post('/users/:id/reject', requireRoot, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: targetUserId } = userIdParamSchema.parse(req.params);

    const result = await runForRootAdmin(req.user!.sub, async tx => {
      const checkRows = await tx.$queryRaw<UserCheckRow[]>`
        SELECT id, registration_status, is_root, is_deleted FROM users WHERE id = ${targetUserId}::uuid LIMIT 1
      `;
      if (
        checkRows.length === 0 ||
        checkRows[0].registration_status !== 'pending' ||
        checkRows[0].is_root ||
        checkRows[0].is_deleted
      ) {
        return null;
      }

      await tx.$executeRaw`
        UPDATE users
        SET
          is_active = false,
          registration_status = 'rejected',
          rejected_at = NOW(),
          rejected_by = ${req.user!.sub}::uuid,
          updated_at = NOW()
        WHERE id = ${targetUserId}::uuid
      `;
      return true;
    });

    if (!result) {
      return res.status(400).json({ message: 'User is not pending, is root/deleted, or does not exist' });
    }

    const cache = getCache();
    await cache.delByPrefix('lookup:').catch(() => undefined);
    await cache.delByPrefix('users:').catch(() => undefined);

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

// DELETE /admin/messages
router.delete('/messages', requireRoot, mutationRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rootClearAllMessages();
    await broadcastPlatformCleared('messages');
    
    // Clear cache
    const cache = getCache();
    await cache.delByPrefix('chats:').catch(() => undefined);
    await cache.delByPrefix('messages:').catch(() => undefined);
    
    return res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    return next(error);
  }
});

// DELETE /admin/media
router.delete('/media', requireRoot, mutationRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rootClearAllMedia();
    await broadcastPlatformCleared('media');
    
    // Clear cache
    const cache = getCache();
    await cache.delByPrefix('chats:').catch(() => undefined);
    await cache.delByPrefix('messages:').catch(() => undefined);
    
    return res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    return next(error);
  }
});

export default router;
