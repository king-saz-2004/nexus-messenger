import { Router } from 'express';
import { z } from 'zod';
import { cacheKeys } from '../cache/cacheKeys.js';
import { cached } from '../cache/index.js';
import { invalidateChatsForUsers, invalidateMembersForChat } from '../cache/invalidation.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { mutationRateLimiter } from '../middleware/rateLimits.js';
import {
  addGroupMembers,
  banGroupMember,
  kickGroupMember,
  leaveGroup,
  listGroupMembers,
  transferGroupOwnership,
  unbanGroupMember,
  updateGroupMemberPermissions,
  updateGroupMemberRole
} from '../services/chatSystem.js';
import {
  broadcastMemberAdded,
  broadcastMemberBanned,
  broadcastMemberRemoved,
  broadcastMemberRoleChanged,
  ejectUserFromChatRoom,
  joinUserChatRoom
} from '../sockets/index.js';
import { paginateArrayByCursor, parseLimit } from '../utils/pagination.js';

const router = Router();

const addMembersSchema = z.object({
  add: z.array(z.string().uuid()).min(1).max(500)
});

const roleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER'])
});

const permissionsSchema = z
  .object({
    canChangeInfo: z.boolean().optional(),
    canDeleteMessages: z.boolean().optional(),
    canBanUsers: z.boolean().optional(),
    canInviteUsers: z.boolean().optional(),
    canPinMessages: z.boolean().optional(),
    canPromoteMembers: z.boolean().optional(),
    canManageCalls: z.boolean().optional(),
    canManageChat: z.boolean().optional(),
    isAnonymous: z.boolean().optional()
  })
  .refine(
    payload =>
      payload.canChangeInfo !== undefined ||
      payload.canDeleteMessages !== undefined ||
      payload.canBanUsers !== undefined ||
      payload.canInviteUsers !== undefined ||
      payload.canPinMessages !== undefined ||
      payload.canPromoteMembers !== undefined ||
      payload.canManageCalls !== undefined ||
      payload.canManageChat !== undefined ||
      payload.isAnonymous !== undefined,
    { message: 'No permissions provided' }
  );

const banSchema = z.object({
  reason: z.string().trim().max(512).optional()
});

const transferSchema = z.object({
  userId: z.string().uuid()
});

const listMembersQuerySchema = z.object({
  limit: z.unknown().optional(),
  cursor: z.string().trim().min(1).max(200).optional()
});

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
      return res.status(404).json({ message: 'Chat not found' });
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
      return res.status(404).json({ message: 'Chat not found' });
    }

    const userIds = [...new Set(body.add)];
    await Promise.all(userIds.map(userId => joinUserChatRoom(userId, req.params.id)));
    if (userIds.length > 0) {
      broadcastMemberAdded(req.params.id, userIds, req.user!.sub);
    }
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ chat });
  })
);

router.delete(
  '/:id/members/:userId',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const chat = await kickGroupMember(req.user!.sub, req.params.id, req.params.userId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    ejectUserFromChatRoom(req.params.userId, req.params.id, 'You have been removed from this group');
    broadcastMemberRemoved(req.params.id, req.params.userId, req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ chat });
  })
);

router.put(
  '/:id/members/:userId/role',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = roleSchema.parse(req.body);
    const chat = await updateGroupMemberRole(req.user!.sub, req.params.id, req.params.userId, {
      role: body.role
    });
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    broadcastMemberRoleChanged(req.params.id, req.params.userId, body.role, req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ chat });
  })
);

router.put(
  '/:id/members/:userId/permissions',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = permissionsSchema.parse(req.body);
    const chat = await updateGroupMemberPermissions(req.user!.sub, req.params.id, req.params.userId, body);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ chat });
  })
);

router.put(
  '/:id/members/:userId/ban',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = banSchema.parse(req.body ?? {});
    const chat = await banGroupMember(req.user!.sub, req.params.id, req.params.userId, body.reason);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    ejectUserFromChatRoom(req.params.userId, req.params.id, 'You have been banned from this group');
    broadcastMemberBanned(req.params.id, req.params.userId, req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ chat });
  })
);

router.put(
  '/:id/members/:userId/unban',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const chat = await unbanGroupMember(req.user!.sub, req.params.id, req.params.userId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    await joinUserChatRoom(req.params.userId, req.params.id);
    broadcastMemberAdded(req.params.id, [req.params.userId], req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ chat });
  })
);

router.post(
  '/:id/leave',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const result = await leaveGroup(req.user!.sub, req.params.id);
    if (!result) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    ejectUserFromChatRoom(req.user!.sub, req.params.id, 'You left this group');
    broadcastMemberRemoved(req.params.id, req.user!.sub, req.user!.sub);
    const affectedUsers = [...new Set([...(result.participants || []), req.user!.sub])];
    await invalidateChatsForUsers(affectedUsers);
    await invalidateMembersForChat(req.params.id, affectedUsers);

    return res.json({ success: true });
  })
);

router.put(
  '/:id/transfer',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = transferSchema.parse(req.body);
    const chat = await transferGroupOwnership(req.user!.sub, req.params.id, body.userId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    broadcastMemberRoleChanged(req.params.id, body.userId, 'OWNER', req.user!.sub);
    broadcastMemberRoleChanged(req.params.id, req.user!.sub, 'MEMBER', req.user!.sub);
    await invalidateMembersForChat(req.params.id, [...new Set(chat.participants ?? [])]);
    await invalidateChatsForUsers([...new Set(chat.participants ?? [])]);

    return res.json({ chat });
  })
);

router.put(
  '/:id/members/:userId/restrict',
  requireAuth,
  mutationRateLimiter,
  asyncHandler(async (_req, res) => {
    return res.status(501).json({
      message: 'Phase 7+ endpoint: member restriction is not implemented yet'
    });
  })
);

export default router;
