import { emptySql, sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { loadChatVisible, queryVisibleMessage } from './access.js';
import { toMessageDto } from './mappers.js';
import { loadCurrentReadPointer, queryMessageById, recountUnreadForChat, resolveMonotonicReadPointer } from './queries.js';
import type { MarkReadPayload, UnreadSnapshotEntry, UnreadSnapshotRow, UuidRow } from './types.js';

export const markMessageSeen = async (actorId: string, messageId: string) => {
  return runAsUser(actorId, async tx => {
    const visible = await queryVisibleMessage(tx, actorId, messageId);
    if (!visible) return null;
    const currentReadMessageId = await loadCurrentReadPointer(tx, actorId, visible.chat_id);
    const effectiveReadMessageId = await resolveMonotonicReadPointer(tx, visible.chat_id, currentReadMessageId, messageId);

    await tx.$executeRaw(
      sql`
        INSERT INTO message_reads (message_id, user_id, chat_id, read_at)
        VALUES (${messageId}::uuid, ${actorId}::uuid, ${visible.chat_id}::uuid, NOW())
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET read_at = EXCLUDED.read_at
      `
    );

    await tx.$executeRaw(
      sql`
        UPDATE chat_members
        SET
          last_read_message_id = ${effectiveReadMessageId ? sql`${effectiveReadMessageId}::uuid` : sql`NULL`},
          last_read_at = NOW(),
          unread_count = 0,
          unread_mentions = 0
        WHERE chat_id = ${visible.chat_id}::uuid
          AND user_id = ${actorId}::uuid
          AND status = 'active'
      `
    );

    await recountUnreadForChat(tx, visible.chat_id);
    const message = await queryMessageById(tx, actorId, messageId, visible.chat_id);
    return message ? toMessageDto(message) : null;
  });
};

export const markChatRead = async (actorId: string, chatId: string, payload: MarkReadPayload = {}) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId);
    if (!chat) return null;

    let candidateMessageId = payload.messageId;
    if (candidateMessageId) {
      const visible = await queryVisibleMessage(tx, actorId, candidateMessageId, chatId);
      if (!visible) return null;
    } else {
      const rows = await tx.$queryRaw<UuidRow[]>(
        sql`
          SELECT m.id
          FROM messages m
          WHERE m.chat_id = ${chatId}::uuid
            AND m.is_deleted_for_all = false
            AND NOT (m.deleted_for ? ${actorId})
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
        `
      );
      candidateMessageId = rows[0]?.id;
    }
    const currentReadMessageId = await loadCurrentReadPointer(tx, actorId, chatId);
    const effectiveReadMessageId = await resolveMonotonicReadPointer(
      tx,
      chatId,
      currentReadMessageId,
      candidateMessageId
    );

    await tx.$executeRaw(
      sql`
        UPDATE chat_members
        SET
          last_read_message_id = ${effectiveReadMessageId ? sql`${effectiveReadMessageId}::uuid` : sql`NULL`},
          last_read_at = NOW(),
          unread_count = 0,
          unread_mentions = 0
        WHERE chat_id = ${chatId}::uuid
          AND user_id = ${actorId}::uuid
          AND status = 'active'
      `
    );

    if (effectiveReadMessageId) {
      const currentReadFilter = currentReadMessageId
        ? sql`AND (m.created_at, m.id) > (SELECT m3.created_at, m3.id FROM messages m3 WHERE m3.id = ${currentReadMessageId}::uuid)`
        : emptySql;

      await tx.$executeRaw(
        sql`
          INSERT INTO message_reads (message_id, user_id, chat_id, read_at)
          SELECT m.id, ${actorId}::uuid, ${chatId}::uuid, NOW()
          FROM messages m
          WHERE m.chat_id = ${chatId}::uuid
            AND m.is_deleted_for_all = false
            AND NOT (m.deleted_for ? ${actorId})
            AND (m.created_at, m.id) <= (
              SELECT m2.created_at, m2.id FROM messages m2 WHERE m2.id = ${effectiveReadMessageId}::uuid
            )
            ${currentReadFilter}
          ON CONFLICT (message_id, user_id) DO NOTHING
        `
      );
    }

    await recountUnreadForChat(tx, chatId);
    return {
      success: true,
      chatId,
      lastReadMessageId: effectiveReadMessageId ?? null
    };
  });
};

export const listUnreadSnapshotForChat = async (actorId: string, chatId: string) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId);
    if (!chat) return null;

    const rows = await tx.$queryRaw<UnreadSnapshotRow[]>(
      sql`
        SELECT
          cm.user_id,
          GREATEST(cm.unread_count, 0)::int AS unread_count
        FROM chat_members cm
        WHERE cm.chat_id = ${chatId}::uuid
          AND cm.status = 'active'
      `
    );

    return rows.map(row => ({
      userId: row.user_id,
      unreadCount: row.unread_count
    })) satisfies UnreadSnapshotEntry[];
  });
};
