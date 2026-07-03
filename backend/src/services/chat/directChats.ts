import { runAsUser } from '../../config/dbContext.js';
import { ensureSenderContactLink } from '../contactSync.js';
import { isForeignKeyViolation } from '../../utils/errors.js';
import { acquireLock, loadSingleChat, recountMembers } from './queries.js';
import type { ExistingChatRow } from './types.js';

export const getOrCreateSavedChat = async (userId: string) => {
  return runAsUser(userId, async tx => {
    await acquireLock(tx, `saved:${userId}`);

    const existing = await tx.$queryRaw<ExistingChatRow[]>`
      SELECT c.id
      FROM chats c
      JOIN chat_members cm
        ON cm.chat_id = c.id
       AND cm.user_id = ${userId}::uuid
      WHERE c.type = 'private'
        AND c.created_by = ${userId}::uuid
        AND c.title = 'Saved Messages'
      ORDER BY c.created_at ASC
      LIMIT 1
    `;

    let chatId = existing[0]?.id;
    if (!chatId) {
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO chats (
          type,
          title,
          created_by,
          member_count,
          is_active,
          is_deleted
        )
        VALUES (
          'private',
          'Saved Messages',
          ${userId}::uuid,
          1,
          true,
          false
        )
        RETURNING id
      `;

      chatId = inserted[0]?.id;
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
          unread_mentions,
          is_muted,
          is_pinned
        )
        VALUES (
          ${chatId}::uuid,
          ${userId}::uuid,
          'owner',
          'active',
          NOW(),
          NOW(),
          0,
          0,
          false,
          false
        )
      `;
    } else {
      await tx.$executeRaw`
        UPDATE chats
        SET is_active = true, is_deleted = false, deleted_at = NULL
        WHERE id = ${chatId}::uuid
      `;

      await tx.$executeRaw`
        UPDATE chat_members
        SET status = 'active', left_at = NULL, unread_count = 0, unread_mentions = 0
        WHERE chat_id = ${chatId}::uuid
          AND user_id = ${userId}::uuid
      `;
    }

    await recountMembers(tx, chatId);
    return loadSingleChat(tx, userId, chatId);
  });
};

export const getOrCreatePrivateChat = async (actorId: string, targetUserId: string) => {
  if (actorId === targetUserId) {
    return null;
  }

  try {
    return await runAsUser(actorId, async tx => {
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'on', true)`;
      const targetUserRows = await tx.$queryRaw<any[]>`
        SELECT id FROM users
        WHERE id = ${targetUserId}::uuid
          AND is_active = true
          AND is_deleted = false
          AND registration_status = 'active'
        LIMIT 1
      `;
      if (targetUserRows.length === 0) {
        return null;
      }

      const [minId, maxId] = [actorId, targetUserId].sort();
      await acquireLock(tx, `private:${minId}:${maxId}`);

      // Search for ANY existing private chat between these two users — including
      // soft-deleted/inactive ones — so we restore rather than create a duplicate.
      // We prefer is_active=true chats (ORDER BY is_active DESC) and fall back to
      // restoring a deactivated one if no active chat exists.
      const existingRows = await tx.$queryRaw<ExistingChatRow[]>`
        SELECT c.id
        FROM chats c
        JOIN chat_members cm_actor
          ON cm_actor.chat_id = c.id
         AND cm_actor.user_id = ${actorId}::uuid
        JOIN chat_members cm_target
          ON cm_target.chat_id = c.id
         AND cm_target.user_id = ${targetUserId}::uuid
        WHERE c.type = 'private'
          AND NOT EXISTS (
            SELECT 1
            FROM chat_members cmx
            WHERE cmx.chat_id = c.id
              AND cmx.user_id NOT IN (${actorId}::uuid, ${targetUserId}::uuid)
          )
        ORDER BY c.is_active DESC, c.created_at ASC
        LIMIT 1
      `;

      let chatId = existingRows[0]?.id;
      if (chatId) {
        // Always restore the chat to a fully active state
        await tx.$executeRaw`
          UPDATE chats
          SET is_active = true, is_deleted = false, deleted_at = NULL
          WHERE id = ${chatId}::uuid
        `;

        // Re-activate the actor's membership; leave target's status intact
        // (they may have intentionally left — do not force-rejoin them)
        await tx.$executeRaw`
          UPDATE chat_members
          SET status = 'active', left_at = NULL
          WHERE chat_id = ${chatId}::uuid
            AND user_id = ${actorId}::uuid
            AND status IN ('left', 'kicked')
        `;
      } else {
        const inserted = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO chats (
            type,
            created_by,
            member_count,
            is_active,
            is_deleted
          )
          VALUES (
            'private',
            ${actorId}::uuid,
            2,
            true,
            false
          )
          RETURNING id
        `;

        chatId = inserted[0]?.id;
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
            ${targetUserId}::uuid,
            'member',
            'active',
            NOW(),
            NOW(),
            0,
            0
          )
        `;
      }

      await ensureSenderContactLink(tx, actorId, targetUserId);
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
