import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { cacheKeys } from '../cache/cacheKeys.js';
import { cached } from '../cache/index.js';
import { invalidateChatsForUsers, invalidateMembersForChat } from '../cache/invalidation.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { avatarUpload } from '../middleware/avatarUpload.js';
import { mutationRateLimiter, uploadRateLimiter } from '../middleware/rateLimits.js';
import {
  buildAvatarUrl,
  deleteAvatarByStorageKey,
  deleteAvatarByUrl,
  validateAvatarFile,
  validateAvatarFileSignature
} from '../services/avatarStorage.js';
import {
  addGroupMembers,
  banGroupMember,
  createGroupChat,
  deleteChat,
  getChatById,
  kickGroupMember,
  leaveGroup,
  listGroupMembers,
  transferGroupOwnership,
  unbanGroupMember,
  updateChatInfo,
  updateGroupMemberRole,
  updateGroupMemberPermissions,
  type UpdateGroupMemberPermissionsPayload
} from '../services/chatSystem.js';
import {
  broadcastChatDeleted,
  broadcastChatUpdated,
  broadcastMemberAdded,
  broadcastMemberBanned,
  broadcastMemberRemoved,
  broadcastMemberRoleChanged,
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

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(255),
  participantIds: z.array(z.string().uuid()).min(1).max(500),
  avatar: avatarSchema.nullable().optional(),
  description: z.string().trim().max(2048).nullable().optional()
});

const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    avatar: avatarSchema.nullable().optional(),
    description: z.string().trim().max(2048).nullable().optional(),
    defaultPermissions: z.object({
      canPinMessages: z.boolean()
    }).optional()
  })
  .refine(payload => payload.name !== undefined || payload.avatar !== undefined || payload.description !== undefined || payload.defaultPermissions !== undefined, {
    message: 'No changes provided'
  });

const addMembersSchema = z.object({
  add: z.array(z.string().uuid()).min(1).max(500)
});

const roleUpdateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['ADMIN', 'MEMBER'])
});

const permissionsUpdateSchema = z.object({
  canChangeInfo: z.boolean().optional(),
  canDeleteMessages: z.boolean().optional(),
  canBanUsers: z.boolean().optional(),
  canInviteUsers: z.boolean().optional(),
  canPinMessages: z.boolean().optional(),
  canPromoteMembers: z.boolean().optional(),
  canManageCalls: z.boolean().optional(),
  canManageChat: z.boolean().optional(),
  isAnonymous: z.boolean().optional()
});

const banSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(512).optional()
});

const transferSchema = z.object({
  userId: z.string().uuid()
});

const listMembersQuerySchema = z.object({
  limit: z.unknown().optional(),
  cursor: z.string().trim().min(1).max(200).optional()
});

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

router.post(
  '/',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = createGroupSchema.parse(req.body);

    const chat = await createGroupChat(req.user!.sub, {
      title: body.name,
      description: body.description ?? null,
      avatarUrl: body.avatar ?? null,
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
    await invalidateMembersForChat(chat.id, participantIds);

    return res.status(201).json({ group: chat, chat });
  })
);

router.patch(
  '/:id',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = updateGroupSchema.parse(req.body);

    const chat = await updateChatInfo(req.user!.sub, req.params.id, {
      title: body.name,
      description: body.description,
      avatarUrl: body.avatar,
      defaultPermissions: body.defaultPermissions
    });

    if (!chat) {
      return res.status(404).json({ message: 'Group not found' });
    }

    broadcastChatUpdated(chat.id, chat as unknown as Record<string, unknown>, undefined, req.user!.sub);
    await invalidateChatsForUsers(chat.participants ?? [req.user!.sub]);

    return res.json({ group: chat, chat });
  })
);

router.post(
  '/:id/avatar',
  requireAuth,
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    await runAvatarUpload(req, res);

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'Missing avatar file' });
    }

    const uploadedAvatarUrl = buildAvatarUrl(file.filename);
    try {
      validateAvatarFile(file);
      await validateAvatarFileSignature(file);
    } catch (error) {
      await deleteAvatarByStorageKey(file.filename).catch(() => undefined);
      throw error;
    }

    try {
      const currentChat = await getChatById(req.user!.sub, req.params.id);
      if (!currentChat || currentChat.type !== 'group') {
        await deleteAvatarByStorageKey(file.filename).catch(() => undefined);
        return res.status(404).json({ message: 'Group not found' });
      }

      const updated = await updateChatInfo(req.user!.sub, req.params.id, {
        avatarUrl: uploadedAvatarUrl
      });

      if (!updated) {
        await deleteAvatarByStorageKey(file.filename).catch(() => undefined);
        return res.status(404).json({ message: 'Group not found' });
      }

      await deleteAvatarByUrl(currentChat.avatar).catch(() => undefined);
      broadcastChatUpdated(updated.id, updated as unknown as Record<string, unknown>, undefined, req.user!.sub);
      await invalidateChatsForUsers(updated.participants ?? [req.user!.sub]);
      return res.json({ group: updated, chat: updated });
    } catch (error) {
      await deleteAvatarByStorageKey(file.filename).catch(() => undefined);
      throw error;
    }
  })
);

router.delete(
  '/:id',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const existing = await getChatById(req.user!.sub, req.params.id);
    if (!existing || existing.type !== 'group') {
      return res.status(404).json({ message: 'Group not found' });
    }
    const members = await listGroupMembers(req.user!.sub, req.params.id);

    const result = await deleteChat(req.user!.sub, req.params.id);
    if (!result || result.mode !== 'group_deleted') {
      return res.status(404).json({ message: 'Group not found' });
    }

    broadcastChatDeleted(req.params.id, req.user!.sub);
    for (const member of members ?? []) {
      ejectUserFromChatRoom(member.userId, req.params.id, 'This group has been deleted');
    }

    await deleteAvatarByUrl(existing.avatar).catch(() => undefined);
    await invalidateChatsForUsers(existing.participants ?? [req.user!.sub]);
    await invalidateMembersForChat(req.params.id, existing.participants ?? [req.user!.sub]);
    return res.json({ message: 'Group deleted' });
  })
);

router.get(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listMembersQuerySchema.parse(req.query);
    const limit = parseLimit(query.limit, { fallback: 100, min: 1, max: 500 });
    const key = cacheKeys.members(req.user!.sub, req.params.id, null, 500);

    const members = await cached({
      key,
      ttlSeconds: env.cacheMembersTtlSeconds,
      res,
      onMiss: async () => listGroupMembers(req.user!.sub, req.params.id)
    });
    if (!members) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const page = paginateArrayByCursor(members, {
      limit,
      cursor: query.cursor,
      extractCursor: row => row.userId
    });

    return res.json({ members: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
  })
);

router.post(
  '/:id/members',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = addMembersSchema.parse(req.body);
    const chat = await addGroupMembers(req.user!.sub, req.params.id, body.add);
    if (!chat) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const userIds = [...new Set(body.add)];
    await Promise.all(userIds.map(userId => joinUserChatRoom(userId, req.params.id)));
    if (userIds.length > 0) {
      broadcastMemberAdded(req.params.id, userIds, req.user!.sub);
    }
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ group: chat, chat });
  })
);

router.delete(
  '/:id/members/:userId',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const chat = await kickGroupMember(req.user!.sub, req.params.id, req.params.userId);
    if (!chat) {
      return res.status(404).json({ message: 'Group not found' });
    }

    ejectUserFromChatRoom(req.params.userId, req.params.id, 'You have been removed from this group');
    broadcastMemberRemoved(req.params.id, req.params.userId, req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ group: chat, chat });
  })
);

router.patch(
  '/:id/roles',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = roleUpdateSchema.parse(req.body);
    const chat = await updateGroupMemberRole(req.user!.sub, req.params.id, body.userId, {
      role: body.role
    });
    if (!chat) {
      return res.status(404).json({ message: 'Group not found' });
    }

    broadcastMemberRoleChanged(req.params.id, body.userId, body.role, req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ group: chat, chat });
  })
);

router.patch(
  '/:id/members/:userId/permissions',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = permissionsUpdateSchema.parse(req.body);
    const chat = await updateGroupMemberPermissions(
      req.user!.sub,
      req.params.id,
      req.params.userId,
      body
    );
    if (!chat) {
      return res.status(404).json({ message: 'Group not found or member is not an admin' });
    }

    await broadcastChatUpdated(req.params.id, chat, undefined, req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ group: chat, chat });
  })
);

router.post(
  '/:id/ban',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = banSchema.parse(req.body);
    const chat = await banGroupMember(req.user!.sub, req.params.id, body.userId, body.reason);
    if (!chat) {
      return res.status(404).json({ message: 'Group not found' });
    }

    ejectUserFromChatRoom(body.userId, req.params.id, 'You have been banned from this group');
    broadcastMemberBanned(req.params.id, body.userId, req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ group: chat, chat });
  })
);

router.post(
  '/:id/unban',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = transferSchema.parse(req.body);
    const chat = await unbanGroupMember(req.user!.sub, req.params.id, body.userId);
    if (!chat) {
      return res.status(404).json({ message: 'Group not found' });
    }

    await joinUserChatRoom(body.userId, req.params.id);
    broadcastMemberAdded(req.params.id, [body.userId], req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ group: chat, chat });
  })
);

router.post(
  '/:id/transfer-ownership',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = transferSchema.parse(req.body);
    const chat = await transferGroupOwnership(req.user!.sub, req.params.id, body.userId);
    if (!chat) {
      return res.status(404).json({ message: 'Group not found' });
    }

    broadcastMemberRoleChanged(req.params.id, body.userId, 'OWNER', req.user!.sub);
    broadcastMemberRoleChanged(req.params.id, req.user!.sub, 'MEMBER', req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ group: chat, chat });
  })
);

router.post(
  '/:id/leave',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const result = await leaveGroup(req.user!.sub, req.params.id);
    if (!result) {
      return res.status(404).json({ message: 'Group not found' });
    }

    ejectUserFromChatRoom(req.user!.sub, req.params.id, 'You left this group');
    broadcastMemberRemoved(req.params.id, req.user!.sub, req.user!.sub);
    const affectedUsers = [...new Set([...(result.participants || []), req.user!.sub])];
    await invalidateMembersForChat(req.params.id, affectedUsers);
    await invalidateChatsForUsers(affectedUsers);

    return res.json({ success: true });
  })
);

export default router;
