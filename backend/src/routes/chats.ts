import { Router } from 'express';
import { z } from 'zod';
import { cacheKeys } from '../cache/cacheKeys.js';
import { cached } from '../cache/index.js';
import { invalidateChatsForUsers, invalidateContactsForUser } from '../cache/invalidation.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { mutationRateLimiter } from '../middleware/rateLimits.js';
import {
  createGroupChat,
  deleteChat,
  getChatById,
  getOrCreatePrivateChat,
  getOrCreateSavedChat,
  listChats,
  updateChatInfo,
  updateChatPreferences
} from '../services/chatSystem.js';
import {
  broadcastChatDeleted,
  broadcastChatUpdated,
  broadcastMemberAdded,
  ejectUserFromChatRoom,
  joinUserChatRoom
} from '../sockets/index.js';
import { paginateArrayByCursor, parseLimit } from '../utils/pagination.js';

const router = Router();

const avatarSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(value => value.startsWith('/avatars/') || /^https?:\/\/\S+$/i.test(value), {
    message: 'Invalid avatar url'
  });

const listQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.unknown().optional(),
  cursor: z.string().trim().min(1).max(200).optional()
});

const privateChatSchema = z.object({
  userId: z.string().uuid()
});

const createGroupSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(2048).nullable().optional(),
    avatarUrl: avatarSchema.nullable().optional(),
    avatar: avatarSchema.nullable().optional(),
    participantIds: z.array(z.string().uuid()).min(1).max(500)
  })
  .refine(payload => Boolean(payload.title ?? payload.name), {
    message: 'Group title is required'
  });

const updateChatSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(2048).nullable().optional(),
    avatarUrl: avatarSchema.nullable().optional(),
    avatar: avatarSchema.nullable().optional()
  })
  .refine(
    payload =>
      payload.title !== undefined ||
      payload.name !== undefined ||
      payload.description !== undefined ||
      payload.avatarUrl !== undefined ||
      payload.avatar !== undefined,
    {
      message: 'No changes provided'
    }
  );

const chatPreferencesSchema = z
  .object({
    isPinned: z.boolean().optional(),
    isMuted: z.boolean().optional(),
    mutedUntil: z.string().datetime().nullable().optional()
  })
  .refine(payload => payload.isPinned !== undefined || payload.isMuted !== undefined || payload.mutedUntil !== undefined, {
    message: 'No preferences to update'
  });

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const search = (query.query ?? query.q ?? '').trim();
    const limit = parseLimit(query.limit, { fallback: 30, min: 1, max: 100 });

    const key = cacheKeys.chats(req.user!.sub, search, null, 200);
    const allChats = await cached({
      key,
      ttlSeconds: env.cacheChatsTtlSeconds,
      res,
      onMiss: async () => listChats(req.user!.sub, search.length > 0 ? search : undefined)
    });

    const page = paginateArrayByCursor(allChats, {
      limit,
      cursor: query.cursor,
      extractCursor: row => row.id
    });

    return res.json({
      chats: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    });
  })
);

router.get(
  '/saved',
  requireAuth,
  asyncHandler(async (req, res) => {
    const chat = await getOrCreateSavedChat(req.user!.sub);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    return res.json({ chat });
  })
);

router.post(
  '/private',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = privateChatSchema.parse(req.body);
    if (body.userId === req.user!.sub) {
      return res.status(400).json({ message: 'Cannot create a direct chat with yourself' });
    }

    const chat = await getOrCreatePrivateChat(req.user!.sub, body.userId);
    if (!chat) {
      return res.status(404).json({ message: 'User not found' });
    }

    const participantIds = [...new Set(chat.participants ?? [])];
    await Promise.all(participantIds.map(userId => joinUserChatRoom(userId, chat.id)));
    broadcastChatUpdated(chat.id, chat as unknown as Record<string, unknown>, undefined, req.user!.sub);
    await invalidateChatsForUsers(participantIds);
    await invalidateContactsForUser(req.user!.sub);

    return res.json({ chat });
  })
);

router.post(
  '/direct',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = privateChatSchema.parse(req.body);
    if (body.userId === req.user!.sub) {
      return res.status(400).json({ message: 'Cannot create a direct chat with yourself' });
    }

    const chat = await getOrCreatePrivateChat(req.user!.sub, body.userId);
    if (!chat) {
      return res.status(404).json({ message: 'User not found' });
    }

    const participantIds = [...new Set(chat.participants ?? [])];
    await Promise.all(participantIds.map(userId => joinUserChatRoom(userId, chat.id)));
    broadcastChatUpdated(chat.id, chat as unknown as Record<string, unknown>, undefined, req.user!.sub);
    await invalidateChatsForUsers(participantIds);
    await invalidateContactsForUser(req.user!.sub);

    return res.json({ chat });
  })
);

router.post(
  '/group',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = createGroupSchema.parse(req.body);

    const title = (body.title ?? body.name ?? '').trim();
    const chat = await createGroupChat(req.user!.sub, {
      title,
      description: body.description ?? null,
      avatarUrl: body.avatarUrl ?? body.avatar ?? null,
      participantIds: body.participantIds
    });

    if (!chat) {
      return res.status(404).json({ message: 'One or more participants were not found' });
    }

    const participantIds = [...new Set(chat.participants ?? [])];
    await Promise.all(participantIds.map(userId => joinUserChatRoom(userId, chat.id)));
    broadcastChatUpdated(chat.id, chat as unknown as Record<string, unknown>, undefined, req.user!.sub);
    const addedParticipants = participantIds.filter(userId => userId !== req.user!.sub);
    if (addedParticipants.length > 0) {
      broadcastMemberAdded(chat.id, addedParticipants, req.user!.sub);
    }
    await invalidateChatsForUsers(participantIds);

    return res.status(201).json({ chat });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const chat = await getChatById(req.user!.sub, req.params.id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    return res.json({ chat });
  })
);

router.put(
  '/:id',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = updateChatSchema.parse(req.body);

    const updated = await updateChatInfo(req.user!.sub, req.params.id, {
      title: body.title ?? body.name,
      description: body.description,
      avatarUrl: body.avatarUrl ?? body.avatar
    });

    if (!updated) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    broadcastChatUpdated(updated.id, updated as unknown as Record<string, unknown>, undefined, req.user!.sub);
    await invalidateChatsForUsers(updated.participants ?? [req.user!.sub]);

    return res.json({ chat: updated });
  })
);

router.delete(
  '/:id',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const existing = await getChatById(req.user!.sub, req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const result = await deleteChat(req.user!.sub, req.params.id);
    if (!result) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    if (result.mode === 'group_deleted') {
      broadcastChatDeleted(req.params.id, req.user!.sub);
      for (const participantId of existing.participants ?? []) {
        ejectUserFromChatRoom(participantId, req.params.id, 'This chat has been deleted');
      }
    } else {
      ejectUserFromChatRoom(req.user!.sub, req.params.id, 'This chat is no longer visible');
    }

    const message = result.mode === 'group_deleted' ? 'Chat deleted' : 'Chat hidden';
    await invalidateChatsForUsers(existing.participants ?? [req.user!.sub]);
    return res.json({ success: true, mode: result.mode, message });
  })
);

router.patch(
  '/:id/preferences',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = chatPreferencesSchema.parse(req.body);

    const chat = await updateChatPreferences(req.user!.sub, req.params.id, {
      isPinned: body.isPinned,
      isMuted: body.isMuted,
      mutedUntil: body.mutedUntil
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    broadcastChatUpdated(chat.id, chat as unknown as Record<string, unknown>, undefined, req.user!.sub);
    await invalidateChatsForUsers(chat.participants ?? [req.user!.sub]);

    return res.json({ chat });
  })
);

export default router;
