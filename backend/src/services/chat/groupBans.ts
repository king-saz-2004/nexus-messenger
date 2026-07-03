import { runAsUser } from '../../config/dbContext.js';
import { createHttpError } from '../../utils/errors.js';
import { canActorBanMembers, canActorManageTargetRole, defaultMemberPermissions } from './access.js';
import { insertAuditLog, loadChatMember, loadGroupActorContext, loadSingleChat, recountMembers } from './queries.js';
import type { UuidRow } from './types.js';

export const banGroupMember = async (actorId: string, chatId: string, targetUserId: string, reason?: string) => {
  return runAsUser(actorId, async tx => {
    if (actorId === targetUserId) {
      throw createHttpError(400, 'Cannot ban yourself');
    }

    const context = await loadGroupActorContext(tx, actorId, chatId);
    if (!context || !canActorBanMembers(context)) {
      return null;
    }

    const target = await loadChatMember(tx, chatId, targetUserId);
    if (!target || target.status === 'banned' || !canActorManageTargetRole(context.actor_role, target.role)) {
      return null;
    }

    const updated = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET
        role = 'banned',
        status = 'banned',
        permissions = ${JSON.stringify(defaultMemberPermissions)}::jsonb,
        banned_at = NOW(),
        banned_by = ${actorId}::uuid,
        kicked_at = NULL,
        kicked_by = NULL,
        left_at = NULL,
        restricted_until = NULL,
        restricted_permissions = NULL,
        unread_count = 0,
        unread_mentions = 0
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${targetUserId}::uuid
        AND app_can_manage_member(chat_id, user_id, 'ban')
      RETURNING id
    `;

    if (updated.length === 0) {
      return null;
    }

    await recountMembers(tx, chatId);
    await insertAuditLog(tx, actorId, chatId, 'member_banned', targetUserId, {
      by: actorId,
      reason: reason ?? null
    });
    return loadSingleChat(tx, actorId, chatId);
  });
};

export const unbanGroupMember = async (actorId: string, chatId: string, targetUserId: string) => {
  return runAsUser(actorId, async tx => {
    const context = await loadGroupActorContext(tx, actorId, chatId);
    if (!context || !canActorBanMembers(context)) {
      return null;
    }

    const target = await loadChatMember(tx, chatId, targetUserId);
    if (!target || target.status !== 'banned') {
      return null;
    }

    const updated = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET
        role = 'member',
        status = 'active',
        permissions = ${JSON.stringify(defaultMemberPermissions)}::jsonb,
        banned_at = NULL,
        banned_by = NULL,
        left_at = NULL
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${targetUserId}::uuid
        AND app_can_manage_member(chat_id, user_id, 'unban')
      RETURNING id
    `;

    if (updated.length === 0) {
      return null;
    }

    await recountMembers(tx, chatId);
    await insertAuditLog(tx, actorId, chatId, 'member_unbanned', targetUserId, {
      by: actorId
    });
    return loadSingleChat(tx, actorId, chatId);
  });
};
