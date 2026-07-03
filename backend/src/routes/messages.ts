import { Router } from 'express';
import type { Request, Response } from 'express';
import { logger } from '../config/logger.js';
import { z } from 'zod';
import { invalidateChatsForUsers, invalidateContactsForUser } from '../cache/invalidation.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { mediaUpload, preCheckContentLength } from '../middleware/mediaUpload.js';
import { mutationRateLimiter, uploadRateLimiter } from '../middleware/rateLimits.js';
import { deleteMediaFileByStorageKey, validateMediaFileSignature } from '../services/mediaStorage.js';
import { getMediaLimits } from '../services/appSettings.js';

import {
  MESSAGE_LIMITS,
  addReaction,
  addReactionById,
  deleteMessage,
  deleteMessageById,
  editMessage,
  editMessageById,
  forwardMessage,
  getMediaForActor,
  listMessages,
  listUnreadSnapshotForChat,
  isValidReactionEmoji,
  markChatRead,
  markMessageSeen,
  pinMessage,
  removeReaction,
  removeReactionById,
  resolveMessageChatForActor,
  searchMessages,
  sendMediaMessage,
  sendTextMessage,
  unpinMessage,
  clearChatMessages,
  listPinnedMessages
} from '../services/messageSystem.js';
import {
  broadcastMessageDeleted,
  broadcastMessageEdited,
  broadcastMessageReacted,
  broadcastMessageRead,
  broadcastNewMessage,
  broadcastUnreadForChat,
  broadcastChatCleared,
  emitToChat
} from '../sockets/index.js';

const router = Router();

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MESSAGE_LIMITS.maxListLimit).default(MESSAGE_LIMITS.defaultListLimit),
  cursor: z.string().trim().min(1).max(512).optional(),
  before: z.string().trim().min(1).max(512).optional(),
  direction: z.enum(['backward', 'forward']).optional()
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(MESSAGE_LIMITS.maxSearchLimit).default(MESSAGE_LIMITS.defaultSearchLimit)
});

const optionalTrimmedString = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, schema.optional());

const clientMessageIdSchema = optionalTrimmedString(
  z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,128}$/, 'Invalid client message id format')
);

const sendTextSchema = z.object({
  content: z.string().trim().min(1).max(MESSAGE_LIMITS.maxMessageLength),
  replyToId: z.string().uuid().optional(),
  clientMessageId: clientMessageIdSchema
});

const sendMediaSchema = z.object({
  caption: optionalTrimmedString(z.string().max(MESSAGE_LIMITS.maxMessageLength)),
  replyToId: optionalTrimmedString(z.string().uuid()),
  kind: z.enum(['voice', 'audio', 'photo', 'video']),
  durationMs: z.coerce.number().int().min(1).max(3_600_000).optional(),
  clientMessageId: clientMessageIdSchema
});

const editSchema = z.object({
  content: z.string().trim().min(1).max(MESSAGE_LIMITS.maxMessageLength),
  replyToId: z.string().uuid().optional()
});

const deleteQuerySchema = z.object({
  scope: z.enum(['everyone']).optional()
});

const forwardSchema = z.object({
  replyToId: z.string().uuid().optional()
});

const reactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(value => isValidReactionEmoji(value), 'Unsupported reaction emoji')
});

const readSchema = z.object({
  messageId: z.string().uuid().optional()
});

const runSingleMediaUpload = (req: Request, res: Response) =>
  new Promise<void>((resolve, reject) => {
    preCheckContentLength(req, res, err => {
      if (err) {
        reject(err);
        return;
      }
      mediaUpload.single('file')(req, res, error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

const toListQuery = (raw: Record<string, unknown>) => {
  const parsed = listMessagesQuerySchema.parse(raw);
  return {
    limit: parsed.limit,
    cursor: parsed.cursor ?? parsed.before,
    direction: parsed.direction ?? 'backward'
  } as const;
};

const invalidateChatListCache = async (actorId: string, chatId: string) => {
  const snapshot = await listUnreadSnapshotForChat(actorId, chatId);
  const affected = snapshot?.map(entry => entry.userId) ?? [actorId];
  await invalidateChatsForUsers(affected);
};

router.get(
  '/chats/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await listMessages(req.user!.sub, req.params.id, toListQuery(req.query as Record<string, unknown>));
    if (!data) return res.status(404).json({ message: 'Chat not found' });
    return res.json({
      messages: data.messages,
      hasMore: data.hasMore,
      nextCursor: data.nextCursor
    });
  })
);

router.get(
  '/chats/:id/messages/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = searchQuerySchema.parse(req.query);
    const data = await searchMessages(req.user!.sub, req.params.id, query.q, query.limit);
    if (!data) return res.status(404).json({ message: 'Chat not found' });
    return res.json(data);
  })
);

router.post(
  '/chats/:id/messages',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = sendTextSchema.parse(req.body);
    const result = await sendTextMessage(req.user!.sub, req.params.id, body);
    if (!result) return res.status(404).json({ message: 'Chat not found' });
    if (result.created) {
      await broadcastNewMessage(req.params.id, result.message as Record<string, unknown>);
      await broadcastUnreadForChat(req.user!.sub, req.params.id);
      await invalidateChatListCache(req.user!.sub, req.params.id);
    }
    return res.status(result.created ? 201 : 200).json({ message: result.message });
  })
);

router.post(
  '/chats/:id/media',
  requireAuth,
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    await runSingleMediaUpload(req, res);
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'Missing file' });

    try {
      const body = sendMediaSchema.parse(req.body ?? {});
      const expectedMediaType =
        body.kind === 'photo'
          ? 'image'
          : body.kind === 'video'
          ? 'video'
          : 'audio';
      const signature = await validateMediaFileSignature(file, {
        expectedMediaType
      });
      file.mimetype = signature.mimeType;
      const result = await sendMediaMessage(req.user!.sub, req.params.id, file, body);
      if (!result) return res.status(404).json({ message: 'Chat not found' });
      if (result.created) {
        await broadcastNewMessage(req.params.id, result.message as Record<string, unknown>);
        await broadcastUnreadForChat(req.user!.sub, req.params.id);
        await invalidateChatListCache(req.user!.sub, req.params.id);
      }
      return res.status(result.created ? 201 : 200).json({ message: result.message });
    } catch (error) {
      try {
        await deleteMediaFileByStorageKey(file.filename);
      } catch (cleanupError) {
        logger.warn('Upload rollback physical media cleanup failed', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          chatId: req.params.id
        });
      }
      throw error;
    }
  })
);

router.put(
  '/chats/:id/messages/:messageId',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = editSchema.parse(req.body);
    const message = await editMessage(req.user!.sub, req.params.id, req.params.messageId, body);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    await broadcastMessageEdited(req.params.id, message as Record<string, unknown>);
    await invalidateChatListCache(req.user!.sub, req.params.id);
    return res.json({ message });
  })
);

router.delete(
  '/chats/:id/messages/:messageId',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    deleteQuerySchema.parse(req.query);
    const result = await deleteMessage(req.user!.sub, req.params.id, req.params.messageId);
    if (!result) return res.status(404).json({ message: 'Message not found' });
    await broadcastMessageDeleted(req.params.id, req.params.messageId, req.user!.sub, result.scope, result.mode);
    await broadcastUnreadForChat(req.user!.sub, req.params.id);
    await invalidateChatListCache(req.user!.sub, req.params.id);
    return res.json(result);
  })
);

router.delete(
  '/chats/:id/messages',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    try {
      const result = await clearChatMessages(req.user!.sub, req.params.id);
      if (!result) return res.status(404).json({ message: 'Chat not found' });
      await broadcastChatCleared(req.params.id);
      await broadcastUnreadForChat(req.user!.sub, req.params.id);
      await invalidateChatListCache(req.user!.sub, req.params.id);
      return res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error: any) {
      if (error.message && error.message.includes('Access denied: cannot clear chat history')) {
        return res.status(403).json({ message: 'Access denied: cannot clear chat history' });
      }
      throw error;
    }
  })
);

router.delete(
  '/groups/:id/messages',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    try {
      const result = await clearChatMessages(req.user!.sub, req.params.id);
      if (!result) return res.status(404).json({ message: 'Group not found' });
      await broadcastChatCleared(req.params.id);
      await broadcastUnreadForChat(req.user!.sub, req.params.id);
      await invalidateChatListCache(req.user!.sub, req.params.id);
      return res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error: any) {
      if (error.message && error.message.includes('Access denied: cannot clear chat history')) {
        return res.status(403).json({ message: 'Access denied: cannot clear chat history' });
      }
      throw error;
    }
  })
);

router.post(
  '/chats/:id/messages/:messageId/forward',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = forwardSchema.parse(req.body ?? {});
    const message = await forwardMessage(req.user!.sub, req.params.messageId, req.params.id, body);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    await broadcastNewMessage(req.params.id, message as Record<string, unknown>);
    await broadcastUnreadForChat(req.user!.sub, req.params.id);
    await invalidateChatListCache(req.user!.sub, req.params.id);
    return res.status(201).json({ message });
  })
);

router.get(
  '/chats/:id/pinned',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messages = await listPinnedMessages(req.user!.sub, req.params.id);
    return res.json({ messages });
  })
);

router.post(
  '/chats/:id/messages/:messageId/pin',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const result = await pinMessage(req.user!.sub, req.params.id, req.params.messageId);
    if (!result || !result.message) return res.status(404).json({ message: 'Message not found' });

    await broadcastMessageEdited(req.params.id, result.message as Record<string, unknown>);
    emitToChat(req.params.id, 'pinned_messages_updated', { chatId: req.params.id });

    return res.json({ message: result.message });
  })
);

router.delete(
  '/chats/:id/messages/:messageId/pin',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const result = await unpinMessage(req.user!.sub, req.params.id, req.params.messageId);
    if (!result || !result.message) return res.status(404).json({ message: 'Message not found' });

    await broadcastMessageEdited(req.params.id, result.message as Record<string, unknown>);
    emitToChat(req.params.id, 'pinned_messages_updated', { chatId: req.params.id });

    return res.json({ message: result.message });
  })
);

router.post(
  '/chats/:id/messages/:messageId/react',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = reactionSchema.parse(req.body);
    const message = await addReaction(req.user!.sub, req.params.id, req.params.messageId, body.emoji);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    await broadcastMessageReacted(req.params.id, message as Record<string, unknown>, req.user!.sub, body.emoji);
    return res.status(201).json({ message });
  })
);

router.delete(
  '/chats/:id/messages/:messageId/react',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = reactionSchema.safeParse(req.body ?? req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid input', issues: parsed.error.issues });
    }
    const message = await removeReaction(req.user!.sub, req.params.id, req.params.messageId, parsed.data.emoji);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    await broadcastMessageReacted(req.params.id, message as Record<string, unknown>, req.user!.sub, parsed.data.emoji);
    return res.json({ message });
  })
);

router.post(
  '/chats/:id/read',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = readSchema.parse(req.body ?? {});
    const result = await markChatRead(req.user!.sub, req.params.id, body);
    if (!result) return res.status(404).json({ message: 'Chat not found' });
    if (result.lastReadMessageId) {
      await broadcastMessageRead(req.params.id, result.lastReadMessageId, req.user!.sub);
    }
    await broadcastUnreadForChat(req.user!.sub, req.params.id);
    await invalidateChatListCache(req.user!.sub, req.params.id);
    return res.json(result);
  })
);

router.get(
  '/groups/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await listMessages(req.user!.sub, req.params.id, toListQuery(req.query as Record<string, unknown>), true);
    if (!data) return res.status(404).json({ message: 'Group not found' });
    return res.json({
      messages: data.messages,
      hasMore: data.hasMore,
      nextCursor: data.nextCursor
    });
  })
);

router.get(
  '/groups/:id/messages/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = searchQuerySchema.parse(req.query);
    const data = await searchMessages(req.user!.sub, req.params.id, query.q, query.limit, true);
    if (!data) return res.status(404).json({ message: 'Group not found' });
    return res.json(data);
  })
);

router.post(
  '/groups/:id/messages',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = sendTextSchema.parse(req.body);
    const result = await sendTextMessage(req.user!.sub, req.params.id, body, true);
    if (!result) return res.status(404).json({ message: 'Group not found' });
    if (result.created) {
      await broadcastNewMessage(req.params.id, result.message as Record<string, unknown>);
      await broadcastUnreadForChat(req.user!.sub, req.params.id);
      await invalidateChatListCache(req.user!.sub, req.params.id);
    }
    return res.status(result.created ? 201 : 200).json({ message: result.message });
  })
);

router.post(
  '/groups/:id/media',
  requireAuth,
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    await runSingleMediaUpload(req, res);
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'Missing file' });

    try {
      const body = sendMediaSchema.parse(req.body ?? {});
      const expectedMediaType =
        body.kind === 'photo'
          ? 'image'
          : body.kind === 'video'
          ? 'video'
          : 'audio';
      const signature = await validateMediaFileSignature(file, {
        expectedMediaType
      });
      file.mimetype = signature.mimeType;
      const result = await sendMediaMessage(req.user!.sub, req.params.id, file, body, true);
      if (!result) return res.status(404).json({ message: 'Group not found' });
      if (result.created) {
        await broadcastNewMessage(req.params.id, result.message as Record<string, unknown>);
        await broadcastUnreadForChat(req.user!.sub, req.params.id);
        await invalidateChatListCache(req.user!.sub, req.params.id);
      }
      return res.status(result.created ? 201 : 200).json({ message: result.message });
    } catch (error) {
      try {
        await deleteMediaFileByStorageKey(file.filename);
      } catch (cleanupError) {
        logger.warn('Upload rollback physical media cleanup failed', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          chatId: req.params.id
        });
      }
      throw error;
    }
  })
);

router.patch(
  '/messages/:id',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = editSchema.parse(req.body);
    const message = await editMessageById(req.user!.sub, req.params.id, body);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (typeof message.chatId === 'string') {
      await broadcastMessageEdited(message.chatId, message as Record<string, unknown>);
      await invalidateChatListCache(req.user!.sub, message.chatId);
    }
    return res.json({ message });
  })
);

router.delete(
  '/messages/:id',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    deleteQuerySchema.parse(req.query);
    const resolved = await resolveMessageChatForActor(req.user!.sub, req.params.id);
    if (!resolved) return res.status(404).json({ message: 'Message not found' });
    const result = await deleteMessageById(req.user!.sub, req.params.id);
    if (!result) return res.status(404).json({ message: 'Message not found' });
    await broadcastMessageDeleted(resolved.chatId, req.params.id, req.user!.sub, result.scope, result.mode);
    await broadcastUnreadForChat(req.user!.sub, resolved.chatId);
    await invalidateChatListCache(req.user!.sub, resolved.chatId);
    return res.json(result);
  })
);

router.post(
  '/messages/:id/reactions',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = reactionSchema.parse(req.body);
    const message = await addReactionById(req.user!.sub, req.params.id, body.emoji);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (typeof message.chatId === 'string') {
      await broadcastMessageReacted(message.chatId, message as Record<string, unknown>, req.user!.sub, body.emoji);
    }
    return res.status(201).json({ message });
  })
);

router.delete(
  '/messages/:id/reactions/:emoji',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = reactionSchema.parse({ emoji: req.params.emoji });
    const message = await removeReactionById(req.user!.sub, req.params.id, body.emoji);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (typeof message.chatId === 'string') {
      await broadcastMessageReacted(message.chatId, message as Record<string, unknown>, req.user!.sub, body.emoji);
    }
    return res.json({ message });
  })
);

router.post(
  '/messages/:id/seen',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const message = await markMessageSeen(req.user!.sub, req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (typeof message.chatId === 'string') {
      await broadcastMessageRead(message.chatId, message.id, req.user!.sub, message as Record<string, unknown>);
      await broadcastUnreadForChat(req.user!.sub, message.chatId);
      await invalidateChatListCache(req.user!.sub, message.chatId);
    }
    return res.json({ message });
  })
);

router.get(
  '/media/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const media = await getMediaForActor(req.user!.sub, req.params.id);
    if (!media) return res.status(404).json({ message: 'Media not found' });

    res.setHeader('Content-Type', media.mimeType);
    if (media.fileName) {
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`);
    }

    return res.sendFile(media.absolutePath, error => {
      if (error && !res.headersSent) {
        res.status(404).json({ message: 'Media not found' });
      }
    });
  })
);



router.get(
  '/media/limits',
  requireAuth,
  asyncHandler(async (req, res) => {
    const limits = await getMediaLimits();
    return res.json(limits);
  })
);

export default router;
