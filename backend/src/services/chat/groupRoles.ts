import { runAsUser } from '../../config/dbContext.js';
import { createHttpError } from '../../utils/errors.js';
import {
  canActorManageTargetRole,
  canActorPromoteMembers,
  defaultAdminPermissions,
  defaultMemberPermissions,
  toPermissionSet
} from './access.js';
import { insertAuditLog, loadChatMember, loadGroupActorContext, loadSingleChat } from './queries.js';
import type { PermissionKey, UpdateGroupMemberPermissionsPayload, UpdateGroupMemberRolePayload, UuidRow } from './types.js';

export const updateGroupMemberRole = async (
  actorId: string,
  chatId: string,
  targetUserId: string,
  payload: UpdateGroupMemberRolePayload
) => {
  return runAsUser(actorId, async tx => {
    if (actorId === targetUserId) {
      throw createHttpError(400, 'Cannot change your own role');
    }

    const context = await loadGroupActorContext(tx, actorId, chatId);
    if (!context || !canActorPromoteMembers(context)) {
      return null;
    }

    const target = await loadChatMember(tx, chatId, targetUserId);
    if (!target || target.status !== 'active' || !canActorManageTargetRole(context.actor_role, target.role)) {
      return null;
    }

    const nextRole = payload.role === 'ADMIN' ? 'admin' : 'member';
    if (nextRole === 'admin' && target.role !== 'member') {
      if (target.role === 'admin') {
        return loadSingleChat(tx, actorId, chatId);
      }
      return null;
    }
    if (nextRole === 'member' && target.role !== 'admin') {
      if (target.role === 'member') {
        return loadSingleChat(tx, actorId, chatId);
      }
      return null;
    }

    const permissions = payload.role === 'ADMIN' ? defaultAdminPermissions : defaultMemberPermissions;
    const action = payload.role === 'ADMIN' ? 'promote' : 'demote';

    const updated = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET
        role = ${nextRole},
        status = 'active',
        permissions = ${JSON.stringify(permissions)}::jsonb,
        promoted_at = CASE WHEN ${payload.role === 'ADMIN'} THEN NOW() ELSE promoted_at END,
        promoted_by = CASE WHEN ${payload.role === 'ADMIN'} THEN ${actorId}::uuid ELSE promoted_by END
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${targetUserId}::uuid
        AND app_can_manage_member(chat_id, user_id, ${action})
      RETURNING id
    `;

    if (updated.length === 0) {
      return null;
    }

    await insertAuditLog(
      tx,
      actorId,
      chatId,
      payload.role === 'ADMIN' ? 'member_promoted' : 'member_demoted',
      targetUserId,
      { by: actorId, role: nextRole }
    );
    return loadSingleChat(tx, actorId, chatId);
  });
};

const permissionPatchMap: Record<keyof UpdateGroupMemberPermissionsPayload, PermissionKey> = {
  canChangeInfo: 'can_change_info',
  canDeleteMessages: 'can_delete_messages',
  canBanUsers: 'can_ban_users',
  canInviteUsers: 'can_invite_users',
  canPinMessages: 'can_pin_messages',
  canPromoteMembers: 'can_promote_members',
  canManageCalls: 'can_manage_calls',
  canManageChat: 'can_manage_chat',
  isAnonymous: 'is_anonymous'
};

export const updateGroupMemberPermissions = async (
  actorId: string,
  chatId: string,
  targetUserId: string,
  patch: UpdateGroupMemberPermissionsPayload
) => {
  return runAsUser(actorId, async tx => {
    if (actorId === targetUserId) {
      throw createHttpError(400, 'Cannot change your own permissions');
    }

    const context = await loadGroupActorContext(tx, actorId, chatId);
    if (!context || context.actor_role !== 'owner') {
      return null;
    }

    const target = await loadChatMember(tx, chatId, targetUserId);
    if (!target || target.status !== 'active' || target.role !== 'admin') {
      return null;
    }

    const nextPermissions = toPermissionSet(target.permissions);
    for (const [inputKey, dbKey] of Object.entries(permissionPatchMap) as Array<
      [keyof UpdateGroupMemberPermissionsPayload, PermissionKey]
    >) {
      const value = patch[inputKey];
      if (typeof value === 'boolean') {
        nextPermissions[dbKey] = value;
      }
    }

    const updated = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET permissions = ${JSON.stringify(nextPermissions)}::jsonb
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${targetUserId}::uuid
        AND app_can_manage_member(chat_id, user_id, 'set_permissions')
      RETURNING id
    `;

    if (updated.length === 0) {
      return null;
    }

    await insertAuditLog(tx, actorId, chatId, 'permissions_changed', targetUserId, {
      by: actorId,
      permissions: nextPermissions
    });
    return loadSingleChat(tx, actorId, chatId);
  });
};

export const transferGroupOwnership = async (actorId: string, chatId: string, newOwnerUserId: string) => {
  return runAsUser(actorId, async tx => {
    if (actorId === newOwnerUserId) {
      throw createHttpError(400, 'User is already owner');
    }

    const context = await loadGroupActorContext(tx, actorId, chatId);
    if (!context || context.actor_role !== 'owner') {
      return null;
    }

    const target = await loadChatMember(tx, chatId, newOwnerUserId);
    if (!target || target.status !== 'active' || target.role === 'owner') {
      return null;
    }

    const promoted = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET
        role = 'owner',
        status = 'active',
        promoted_at = NOW(),
        promoted_by = ${actorId}::uuid
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${newOwnerUserId}::uuid
        AND app_can_manage_member(chat_id, user_id, 'transfer')
      RETURNING id
    `;

    if (promoted.length === 0) {
      return null;
    }

    await tx.$executeRaw`
      UPDATE chats
      SET created_by = ${newOwnerUserId}::uuid
      WHERE id = ${chatId}::uuid
    `;

    const demoted = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET
        role = 'member',
        status = 'active',
        permissions = ${JSON.stringify(defaultMemberPermissions)}::jsonb
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${actorId}::uuid
      RETURNING id
    `;

    if (demoted.length === 0) {
      return null;
    }

    await insertAuditLog(tx, actorId, chatId, 'member_promoted', newOwnerUserId, {
      by: actorId,
      transfer: true
    });
    return loadSingleChat(tx, actorId, chatId);
  });
};
