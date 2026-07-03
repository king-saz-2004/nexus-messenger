import { sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { loadChatVisible } from './access.js';
import { toMessageDto } from './mappers.js';
import { insertAuditLog, queryMessageById } from './queries.js';
import type { MessageRow, TxClient, UuidRow } from './types.js';

const applyPinnedState = async (
  tx: TxClient,
  actorId: string,
  chatId: string,
  messageId: string,
  isPinned: boolean
) => {
  const rows = await tx.$queryRaw<UuidRow[]>(
    sql`
      UPDATE messages m
      SET
        is_pinned = ${isPinned},
        pinned_at = CASE WHEN ${isPinned} THEN NOW() ELSE NULL END,
        pinned_by = CASE WHEN ${isPinned} THEN ${actorId}::uuid ELSE NULL END
      WHERE m.id = ${messageId}::uuid
        AND m.chat_id = ${chatId}::uuid
        AND m.is_deleted_for_all = false
        AND app_can_pin_message(m.chat_id)
      RETURNING id
    `
  );
  if (rows.length === 0) return null;

  if (isPinned) {
    await tx.$executeRaw(
      sql`
        UPDATE chats
        SET pinned_message_id = ${messageId}::uuid
        WHERE id = ${chatId}::uuid
      `
    );
  } else {
    await tx.$executeRaw(
      sql`
        UPDATE chats
        SET pinned_message_id = (
          SELECT id
          FROM messages
          WHERE chat_id = ${chatId}::uuid
            AND is_pinned = true
            AND is_deleted_for_all = false
          ORDER BY pinned_at DESC, id DESC
          LIMIT 1
        )
        WHERE id = ${chatId}::uuid
          AND pinned_message_id = ${messageId}::uuid
      `
    );
  }

  await insertAuditLog(tx, actorId, chatId, isPinned ? 'message_pinned' : 'message_unpinned', {
    by: actorId,
    messageId
  });
  return { success: true };
};

export const pinMessage = async (actorId: string, chatId: string, messageId: string) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId, false);
    if (!chat) return null;
    const applied = await applyPinnedState(tx, actorId, chatId, messageId, true);
    if (!applied) return null;
    const message = await queryMessageById(tx, actorId, messageId, chatId);
    return {
      message: message ? toMessageDto(message) : null
    };
  });
};

export const unpinMessage = async (actorId: string, chatId: string, messageId: string) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId, false);
    if (!chat) return null;
    const applied = await applyPinnedState(tx, actorId, chatId, messageId, false);
    if (!applied) return null;
    const message = await queryMessageById(tx, actorId, messageId, chatId);
    return {
      message: message ? toMessageDto(message) : null
    };
  });
};

export const listPinnedMessages = async (actorId: string, chatId: string) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId, false);
    if (!chat) return [];

    const rows = await tx.$queryRaw<MessageRow[]>(
      sql`
        SELECT
          m.id,
          m.chat_id,
          m.sender_id,
          m.type,
          m.content,
          m.media,
          m.reply_to_id,
          m.is_edited,
          m.edited_at,
          m.created_at,
          m.updated_at,
          m.client_message_id,
          m.is_pinned,
          m.pinned_at,
          m.pinned_by,
          c.type AS chat_type,
          (SELECT COUNT(*)::int FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.status = 'active') AS chat_member_count,
          rm.id AS reply_id,
          rm.sender_id AS reply_sender_id,
          rm.content AS reply_content,
          rm.type AS reply_type,
          rm.media AS reply_media,
          COALESCE(
            (
              SELECT array_agg(mr.user_id::text ORDER BY mr.read_at)
              FROM message_reads mr
              WHERE mr.message_id = m.id
            ),
            ARRAY[]::text[]
          ) AS seen_by,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'emoji', grouped.emoji,
                  'count', grouped.reaction_count,
                  'userIds', grouped.user_ids
                )
                ORDER BY grouped.emoji
              )
              FROM (
                SELECT
                  mr.emoji,
                  COUNT(*)::int AS reaction_count,
                  array_agg(mr.user_id::text ORDER BY mr.created_at) AS user_ids
                FROM message_reactions mr
                WHERE mr.message_id = m.id
                GROUP BY mr.emoji
              ) grouped
            ),
            '[]'::jsonb
          ) AS reactions
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        LEFT JOIN messages rm ON rm.id = m.reply_to_id
        WHERE m.chat_id = ${chatId}::uuid
          AND m.is_pinned = true
          AND m.is_deleted_for_all = false
          AND NOT (m.deleted_for ? ${actorId})
        ORDER BY m.pinned_at DESC NULLS LAST, m.id DESC
      `
    );

    return rows.map(toMessageDto);
  });
};
