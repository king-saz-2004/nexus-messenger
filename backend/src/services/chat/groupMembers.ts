import { runAsUser } from '../../config/dbContext.js';
import { toIso } from '../../utils/dates.js';
import { createHttpError, isForeignKeyViolation } from '../../utils/errors.js';
import {
  canActorBanMembers,
  canActorInviteMembers,
  canActorManageTargetRole,
  defaultMemberPermissions,
  toPermissionSet
} from './access.js';
import { mapRole, mapState } from './mappers.js';
import {
  insertAuditLog,
  loadChatMember,
  loadGroupActorContext,
  loadSingleChat,
  recountMembers,
  setDirectoryScope
} from './queries.js';
import type { GroupMemberDto, GroupMemberRow, MembershipCheckRow, UuidRow } from './types.js';

export const listGroupMembers = async (actorId: string, chatId: string): Promise<GroupMemberDto[] | null> => {
  return runAsUser(actorId, async tx => {
    const membershipRows = await tx.$queryRaw<MembershipCheckRow[]>`
      SELECT c.id, c.type, cm.role
      FROM chats c
      JOIN chat_members cm
        ON cm.chat_id = c.id
       AND cm.user_id = ${actorId}::uuid
       AND cm.status = 'active'
      WHERE c.id = ${chatId}::uuid
        AND c.type = 'group'
        AND c.is_active = true
        AND c.is_deleted = false
      LIMIT 1
    `;

    if (membershipRows.length === 0) {
      return null;
    }

    await setDirectoryScope(tx);
    const rows = await tx.$queryRaw<GroupMemberRow[]>`
      SELECT
        cm.user_id,
        cm.role,
        cm.status,
        cm.permissions,
        cm.joined_at,
        cm.updated_at,
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.status AS user_status,
        u.last_seen
      FROM chat_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = ${chatId}::uuid
        AND cm.status IN ('active', 'banned')
      ORDER BY
        CASE cm.role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          ELSE 2
        END,
        cm.joined_at ASC
    `;

    return rows.map(row => {
      const perms = toPermissionSet(row.permissions);
      const permissionsDto = {
        canChangeInfo: perms.can_change_info,
        canDeleteMessages: perms.can_delete_messages,
        canBanUsers: perms.can_ban_users,
        canInviteUsers: perms.can_invite_users,
        canPinMessages: perms.can_pin_messages,
        canPromoteMembers: perms.can_promote_members,
        canManageCalls: perms.can_manage_calls,
        canManageChat: perms.can_manage_chat,
        isAnonymous: perms.is_anonymous
      };

      return {
        userId: row.user_id,
        role: mapRole(row.role) ?? 'MEMBER',
        state: mapState(row.status) ?? 'ACTIVE',
        createdAt: toIso(row.joined_at),
        updatedAt: toIso(row.updated_at),
        permissions: permissionsDto,
        user: {
          id: row.id,
          name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username,
          username: row.username,
          avatar: row.avatar_url ?? undefined,
          role: 'USER',
          status: row.user_status,
          isOnline: row.user_status === 'online',
          lastSeenAt: toIso(row.last_seen),
          isRoot: false
        }
      };
    });
  });
};

export const addGroupMembers = async (actorId: string, chatId: string, addUserIds: string[]) => {
  try {
    return await runAsUser(actorId, async tx => {
      const context = await loadGroupActorContext(tx, actorId, chatId);
      if (!context || !canActorInviteMembers(context)) {
        return null;
      }

      const deduped = [...new Set(addUserIds)].filter(id => id !== actorId);
      if (deduped.length === 0) {
        return loadSingleChat(tx, actorId, chatId);
      }

      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'on', true)`;
      for (const userId of deduped) {
        const userRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users
          WHERE id = ${userId}::uuid
            AND is_active = true
            AND is_deleted = false
            AND registration_status = 'active'
          LIMIT 1
        `;
        if (userRows.length === 0) {
          throw createHttpError(400, 'Target user is not active, has been deleted, or is pending approval');
        }

        const current = await loadChatMember(tx, chatId, userId);
        let changed = false;

        if (current?.status === 'banned' || current?.role === 'banned') {
          throw createHttpError(400, 'Member is banned and must be unbanned first');
        }

        if (!current) {
          const inserted = await tx.$queryRaw<UuidRow[]>`
            INSERT INTO chat_members (
              chat_id,
              user_id,
              role,
              status,
              permissions,
              joined_at,
              unread_count,
              unread_mentions
            )
            VALUES (
              ${chatId}::uuid,
              ${userId}::uuid,
              'member',
              'active',
              ${JSON.stringify(defaultMemberPermissions)}::jsonb,
              NOW(),
              0,
              0
            )
            RETURNING id
          `;

          if (inserted.length === 0) {
            return null;
          }
          changed = true;
        } else if (current.status === 'left' || current.status === 'kicked' || current.status === 'restricted') {
          const updated = await tx.$queryRaw<UuidRow[]>`
            UPDATE chat_members
            SET
              role = 'member',
              status = 'active',
              permissions = ${JSON.stringify(defaultMemberPermissions)}::jsonb,
              left_at = NULL,
              kicked_at = NULL,
              kicked_by = NULL,
              banned_at = NULL,
              banned_by = NULL,
              restricted_until = NULL,
              restricted_permissions = NULL
            WHERE chat_id = ${chatId}::uuid
              AND user_id = ${userId}::uuid
              AND app_can_manage_member(chat_id, user_id, 'invite')
            RETURNING id
          `;

          if (updated.length === 0) {
            return null;
          }
          changed = true;
        }

        if (changed) {
          await insertAuditLog(tx, actorId, chatId, 'member_joined', userId, {
            by: actorId
          });
        }
      }

      await recountMembers(tx, chatId);
      return loadSingleChat(tx, actorId, chatId);
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return null;
    }
    throw error;
  }
};

export const kickGroupMember = async (actorId: string, chatId: string, targetUserId: string) => {
  return runAsUser(actorId, async tx => {
    if (actorId === targetUserId) {
      throw createHttpError(400, 'Use leave endpoint to exit the group');
    }

    const context = await loadGroupActorContext(tx, actorId, chatId);
    if (!context || !canActorBanMembers(context)) {
      return null;
    }

    const target = await loadChatMember(tx, chatId, targetUserId);
    if (!target || target.status !== 'active') {
      return null;
    }
    if (target.role === 'owner') {
      throw createHttpError(403, 'Cannot remove the group owner');
    }
    if (!canActorManageTargetRole(context.actor_role, target.role)) {
      return null;
    }

    const updated = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET
        role = 'member',
        status = 'kicked',
        kicked_at = NOW(),
        kicked_by = ${actorId}::uuid,
        left_at = NULL,
        banned_at = NULL,
        banned_by = NULL,
        restricted_until = NULL,
        restricted_permissions = NULL,
        unread_count = 0,
        unread_mentions = 0
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${targetUserId}::uuid
        AND app_can_manage_member(chat_id, user_id, 'kick')
      RETURNING id
    `;

    if (updated.length === 0) {
      return null;
    }

    await recountMembers(tx, chatId);
    await insertAuditLog(tx, actorId, chatId, 'member_kicked', targetUserId, {
      by: actorId
    });
    return loadSingleChat(tx, actorId, chatId);
  });
};

export const leaveGroup = async (actorId: string, chatId: string) => {
  return runAsUser(actorId, async tx => {
    const context = await loadGroupActorContext(tx, actorId, chatId);
    if (!context) {
      return null;
    }

    if (context.actor_role === 'owner') {
      throw createHttpError(400, 'Transfer ownership before leaving the group');
    }

    const activeMembers = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM chat_members
      WHERE chat_id = ${chatId}::uuid AND status = 'active'
    `;
    const participants = activeMembers.map(m => m.user_id);

    const updated = await tx.$queryRaw<UuidRow[]>`
      UPDATE chat_members
      SET
        role = 'left',
        status = 'left',
        left_at = NOW(),
        unread_count = 0,
        unread_mentions = 0
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${actorId}::uuid
      RETURNING id
    `;

    if (updated.length === 0) {
      return null;
    }

    await recountMembers(tx, chatId);
    await insertAuditLog(tx, actorId, chatId, 'member_left', actorId, {
      by: actorId
    });
    return { success: true, participants };
  });
};
