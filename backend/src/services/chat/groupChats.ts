import { joinSql, sql, type SqlFragment } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { isForeignKeyViolation } from '../../utils/errors.js';
import { toPermissionSet } from './access.js';
import { loadSingleChat, recountMembers, setDirectoryScope } from './queries.js';
import type { CreateGroupPayload, DeleteChatResult, MembershipCheckRow, UpdateChatPayload, UserLookupRow } from './types.js';

export const createGroupChat = async (actorId: string, payload: CreateGroupPayload) => {
  try {
    return await runAsUser(actorId, async tx => {
      const uniqueParticipants = new Set((payload.participantIds ?? []).filter(Boolean));
      uniqueParticipants.delete(actorId);
      const participantIds = [...uniqueParticipants];
      if (participantIds.length === 0) {
        return null;
      }

      await setDirectoryScope(tx);
      const allowedParticipantRows = await tx.$queryRaw<UserLookupRow[]>(
        sql`
          SELECT c.contact_user_id AS id
          FROM contacts c
          JOIN users u ON u.id = c.contact_user_id
          WHERE c.user_id = ${actorId}::uuid
            AND c.is_blocked = false
            AND u.is_active = true
            AND u.is_deleted = false
            AND u.registration_status = 'active'
            AND c.contact_user_id IN (${joinSql(participantIds.map(id => sql`${id}::uuid`), ',')})
        `
      );
      if (allowedParticipantRows.length !== participantIds.length) {
        return null;
      }

      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO chats (
          type,
          title,
          description,
          avatar_url,
          created_by,
          member_count,
          is_active,
          is_deleted
        )
        VALUES (
          'group',
          ${payload.title},
          ${payload.description ?? null},
          ${payload.avatarUrl ?? null},
          ${actorId}::uuid,
          ${participantIds.length + 1},
          true,
          false
        )
        RETURNING id
      `;

      const chatId = inserted[0]?.id;
      if (!chatId) {
        return null;
      }

      await tx.$executeRaw`
        INSERT INTO chat_members (
          chat_id,
          user_id,
          role,
          status,
          joined_at,
          last_read_at,
          unread_count,
          unread_mentions
        )
        VALUES (
          ${chatId}::uuid,
          ${actorId}::uuid,
          'owner',
          'active',
          NOW(),
          NOW(),
          0,
          0
        )
      `;

      for (const participantId of participantIds) {
        await tx.$executeRaw`
          INSERT INTO chat_members (
            chat_id,
            user_id,
            role,
            status,
            joined_at,
            last_read_at,
            unread_count,
            unread_mentions
          )
          VALUES (
            ${chatId}::uuid,
            ${participantId}::uuid,
            'member',
            'active',
            NOW(),
            NOW(),
            0,
            0
          )
        `;
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

export const updateChatInfo = async (actorId: string, chatId: string, patch: UpdateChatPayload) => {
  return runAsUser(actorId, async tx => {
    const allowedRows = await tx.$queryRaw<MembershipCheckRow[]>`
      SELECT c.id, c.type, cm.role, cm.permissions
      FROM chats c
      JOIN chat_members cm
        ON cm.chat_id = c.id
       AND cm.user_id = ${actorId}::uuid
       AND cm.status = 'active'
      WHERE c.id = ${chatId}::uuid
        AND c.is_active = true
        AND c.is_deleted = false
      LIMIT 1
    `;

    const allowed = allowedRows[0];

    // Block private chats or non-members
    if (!allowed || allowed.type === 'private') {
      return null;
    }

    // Owner can always edit; admins need can_change_info or can_manage_chat
    if (allowed.role !== 'owner') {
      if (allowed.role !== 'admin') {
        return null;
      }
      const perms = toPermissionSet(allowed.permissions);
      if (!perms.can_change_info && !perms.can_manage_chat) {
        return null;
      }
    }

    const updates: SqlFragment[] = [];
    if (patch.title !== undefined) {
      updates.push(sql`title = ${patch.title}`);
    }
    if (patch.description !== undefined) {
      updates.push(sql`description = ${patch.description}`);
    }
    if (patch.avatarUrl !== undefined) {
      updates.push(sql`avatar_url = ${patch.avatarUrl}`);
    }
    if (patch.defaultPermissions?.canPinMessages !== undefined) {
      const val = patch.defaultPermissions.canPinMessages ? 'true' : 'false';
      updates.push(sql`default_permissions = jsonb_set(COALESCE(default_permissions, '{}'::jsonb), '{can_pin_messages}', ${val}::jsonb)`);
    }

    if (updates.length > 0) {
      await tx.$executeRaw(
        sql`
          UPDATE chats
          SET ${joinSql(updates, ', ')}
          WHERE id = ${chatId}::uuid
        `
      );
    }

    return loadSingleChat(tx, actorId, chatId);
  });
};

export const deleteChat = async (actorId: string, chatId: string): Promise<DeleteChatResult | null> => {
  const result = await runAsUser(actorId, async tx => {
    const targetRows = await tx.$queryRaw<MembershipCheckRow[]>`
      SELECT c.id, c.type, cm.role
      FROM chats c
      JOIN chat_members cm
        ON cm.chat_id = c.id
       AND cm.user_id = ${actorId}::uuid
       AND cm.status = 'active'
      WHERE c.id = ${chatId}::uuid
        AND c.is_active = true
        AND c.is_deleted = false
      LIMIT 1
    `;

    const target = targetRows[0];
    if (!target) {
      return null;
    }

    if (target.type === 'private') {
      await tx.$executeRaw`
        UPDATE chat_members
        SET
          status = 'left',
          left_at = NOW(),
          unread_count = 0,
          unread_mentions = 0
        WHERE chat_id = ${chatId}::uuid
          AND user_id = ${actorId}::uuid
      `;
      await recountMembers(tx, chatId);
      return { mode: 'private_hidden' as const };
    }

    if (target.role !== 'owner') {
      return null;
    }

    await tx.$executeRaw`
      UPDATE chats
      SET
        is_active = false,
        is_deleted = true,
        deleted_at = NOW()
      WHERE id = ${chatId}::uuid
    `;

    await tx.$executeRaw`
      UPDATE chat_members
      SET
        status = 'left',
        left_at = NOW(),
        unread_count = 0,
        unread_mentions = 0
      WHERE chat_id = ${chatId}::uuid
        AND status = 'active'
    `;

    return { mode: 'group_deleted' as const };
  });

  // NOTE: In this release, group deletion is strictly a metadata tombstone operation.
  // We do not silently purge physical media files or message rows in the background.
  // Future updates will implement a fully consistent hard-delete flow for all group messages and associated files.
  
  return result;
};
