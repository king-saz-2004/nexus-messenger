import { emptySql, sql, type JsonValue } from '../../config/sql.js';
import { createHttpError } from '../../utils/errors.js';
import { decodeCursor } from '../../utils/pagination.js';
import { uuidPattern } from './constants.js';
import { jsonString } from './mappers.js';
import type {
  InsertMessageInput,
  MessageCursorRow,
  MessageDirection,
  MessageOrderRow,
  MessageRow,
  ReadPointerRow,
  TxClient,
  UuidRow
} from './types.js';

export const loadCurrentReadPointer = async (tx: TxClient, actorId: string, chatId: string) => {
  const rows = await tx.$queryRaw<ReadPointerRow[]>(
    sql`
      SELECT cm.last_read_message_id
      FROM chat_members cm
      WHERE cm.chat_id = ${chatId}::uuid
        AND cm.user_id = ${actorId}::uuid
        AND cm.status = 'active'
      LIMIT 1
    `
  );
  return rows[0]?.last_read_message_id ?? null;
};

export const resolveMonotonicReadPointer = async (
  tx: TxClient,
  chatId: string,
  currentMessageId: string | null | undefined,
  candidateMessageId: string | null | undefined
) => {
  const normalizedCurrent = currentMessageId ?? null;
  const normalizedCandidate = candidateMessageId ?? null;

  if (!normalizedCandidate) return normalizedCurrent;
  if (!normalizedCurrent) return normalizedCandidate;
  if (normalizedCandidate === normalizedCurrent) return normalizedCurrent;

  const rows = await tx.$queryRaw<MessageOrderRow[]>(
    sql`
      SELECT m.id, m.created_at
      FROM messages m
      WHERE m.chat_id = ${chatId}::uuid
        AND m.id IN (${normalizedCurrent}::uuid, ${normalizedCandidate}::uuid)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    `
  );

  const latest = rows[0];
  if (!latest) return normalizedCurrent;
  if (latest.id === normalizedCurrent || latest.id === normalizedCandidate) {
    return latest.id;
  }
  return normalizedCurrent;
};

export const queryMessageById = async (tx: TxClient, actorId: string, messageId: string, chatId?: string) => {
  const chatFilter = chatId ? sql`AND m.chat_id = ${chatId}::uuid` : emptySql;
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
      WHERE m.id = ${messageId}::uuid
        ${chatFilter}
        AND m.is_deleted_for_all = false
        AND NOT (m.deleted_for ? ${actorId})
        AND EXISTS (
          SELECT 1
          FROM chat_members cm
          WHERE cm.chat_id = m.chat_id
            AND cm.user_id = ${actorId}::uuid
            AND cm.status = 'active'
        )
      LIMIT 1
    `
  );
  return rows[0] ?? null;
};

export const recountUnreadForChat = async (tx: TxClient, chatId: string) => {
  await tx.$executeRaw(
    sql`SELECT app_recount_unread_counts(${chatId}::uuid)`
  );
};

export const insertMessageCore = async (tx: TxClient, input: InsertMessageInput) => {
  await tx.$executeRaw(
    sql`SELECT 1 FROM chats WHERE id = ${input.chatId}::uuid FOR UPDATE`
  );

  const mediaJson = input.media ? JSON.stringify(input.media) : null;
  const systemEventJson = input.systemEvent ? JSON.stringify(input.systemEvent) : null;
  const hasClientMessageId = typeof input.clientMessageId === 'string' && input.clientMessageId.length > 0;
  const clientMessageId = hasClientMessageId ? input.clientMessageId! : null;
  const rows = await tx.$queryRaw<UuidRow[]>(
    sql`
      INSERT INTO messages (
        chat_id,
        sender_id,
        type,
        content,
        media,
        reply_to_id,
        forward_from_id,
        forward_from_chat,
        forward_from_user,
        forward_date,
        system_event,
        client_message_id
      )
      VALUES (
        ${input.chatId}::uuid,
        ${input.senderId}::uuid,
        ${input.type},
        ${input.content},
        ${mediaJson}::jsonb,
        ${input.replyToId ? sql`${input.replyToId}::uuid` : sql`NULL`},
        ${input.forwardFromId ? sql`${input.forwardFromId}::uuid` : sql`NULL`},
        ${input.forwardFromChat ? sql`${input.forwardFromChat}::uuid` : sql`NULL`},
        ${input.forwardFromUser ? sql`${input.forwardFromUser}::uuid` : sql`NULL`},
        ${input.forwardDate ?? null},
        ${systemEventJson}::jsonb,
        ${clientMessageId}
      )
      ${hasClientMessageId
        ? sql`ON CONFLICT (sender_id, chat_id, client_message_id) DO NOTHING`
        : emptySql}
      RETURNING id
    `
  );

  let messageId = rows[0]?.id;
  let created = true;
  if (!messageId && hasClientMessageId) {
    created = false;
    const existing = await tx.$queryRaw<UuidRow[]>(
      sql`
        SELECT id
        FROM messages
        WHERE sender_id = ${input.senderId}::uuid
          AND chat_id = ${input.chatId}::uuid
          AND client_message_id = ${clientMessageId}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
    );
    messageId = existing[0]?.id;
  }

  if (!messageId) return null;
  if (!created) {
    return {
      messageId,
      created: false
    };
  }

  await tx.$executeRaw(
    sql`
      INSERT INTO message_reads (message_id, user_id, chat_id, read_at)
      VALUES (${messageId}::uuid, ${input.senderId}::uuid, ${input.chatId}::uuid, NOW())
      ON CONFLICT (message_id, user_id)
      DO UPDATE SET read_at = EXCLUDED.read_at
    `
  );

  await tx.$executeRaw(
    sql`
      UPDATE chat_members
      SET
        last_read_message_id = ${messageId}::uuid,
        last_read_at = NOW(),
        unread_count = 0,
        unread_mentions = 0,
        last_message_at = NOW()
      WHERE chat_id = ${input.chatId}::uuid
        AND user_id = ${input.senderId}::uuid
    `
  );

  if (input.incrementUnread !== false) {
    await recountUnreadForChat(tx, input.chatId);
  }

  await tx.$executeRaw(
    sql`
      UPDATE chats
      SET updated_at = NOW()
      WHERE id = ${input.chatId}::uuid
    `
  );

  return {
    messageId,
    created: true
  };
};

export const insertAuditLog = async (
  tx: TxClient,
  actorId: string,
  chatId: string,
  action: string,
  details?: Record<string, unknown>
) => {
  const detailsJson = details ? JSON.stringify(details) : null;
  await tx.$executeRaw(
    sql`
      INSERT INTO audit_log (chat_id, actor_id, action, details)
      VALUES (${chatId}::uuid, ${actorId}::uuid, ${action}, ${detailsJson}::jsonb)
    `
  );
};

export const insertSystemMessage = async (
  tx: TxClient,
  actorId: string,
  chatId: string,
  eventType: string,
  payload: Record<string, unknown>
) => {
  return insertMessageCore(tx, {
    chatId,
    senderId: actorId,
    type: 'system',
    content: null,
    systemEvent: {
      type: eventType,
      ...payload
    }
  });
};

export const resolveDeletedMessageMediaCleanup = async (tx: TxClient, media: JsonValue | null | undefined, messageId: string) => {
  const fileId = jsonString(media, 'file_id');
  if (!fileId || !uuidPattern.test(fileId)) return null;

  const deleted = await tx.$queryRaw<Array<{ file_path: string; thumbnail_path: string | null }>>(
    sql`
      SELECT file_path, thumbnail_path FROM app_delete_unreferenced_media_file(${fileId}::uuid)
    `
  );
  return deleted[0] ?? null;
};

export const queryMessageByClientMessageId = async (
  tx: TxClient,
  actorId: string,
  chatId: string,
  senderId: string,
  clientMessageId?: string
) => {
  if (!clientMessageId) return null;
  const rows = await tx.$queryRaw<UuidRow[]>(
    sql`
      SELECT id
      FROM messages
      WHERE chat_id = ${chatId}::uuid
        AND sender_id = ${senderId}::uuid
        AND client_message_id = ${clientMessageId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
  );
  const messageId = rows[0]?.id;
  if (!messageId) return null;
  return queryMessageById(tx, actorId, messageId, chatId);
};

export const listRows = async (
  tx: TxClient,
  actorId: string,
  chatId: string,
  limit: number,
  direction: MessageDirection,
  cursor?: { createdAt: Date; id: string }
) => {
  const cursorFilter = cursor
    ? direction === 'forward'
      ? sql`AND (m.created_at, m.id) > (${cursor.createdAt}, ${cursor.id}::uuid)`
      : sql`AND (m.created_at, m.id) < (${cursor.createdAt}, ${cursor.id}::uuid)`
    : emptySql;
  const orderBy =
    direction === 'forward' ? sql`m.created_at ASC, m.id ASC` : sql`m.created_at DESC, m.id DESC`;

  return tx.$queryRaw<MessageRow[]>(
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
        AND m.is_deleted_for_all = false
        AND NOT (m.deleted_for ? ${actorId})
        ${cursorFilter}
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `
  );
};

export const parseMessageCursor = async (
  tx: TxClient,
  actorId: string,
  chatId: string,
  rawCursor?: string,
  direction: 'forward' | 'backward' = 'backward'
): Promise<{ createdAt: Date; id: string } | undefined> => {
  if (!rawCursor) return undefined;

  // 1. Check if it's base64url encoded JSON cursor
  const decoded = decodeCursor<{ createdAt: string; id: string }>(rawCursor);
  if (decoded && decoded.createdAt && decoded.id) {
    const d = new Date(decoded.createdAt);
    if (!Number.isNaN(d.getTime()) && uuidPattern.test(decoded.id)) {
      return { createdAt: d, id: decoded.id };
    }
  }

  // 2. Check if it is a direct ISO date string (backward compatibility)
  const dateCandidate = new Date(rawCursor);
  if (!Number.isNaN(dateCandidate.getTime())) {
    const fallbackId = direction === 'backward'
      ? 'ffffffff-ffff-ffff-ffff-ffffffffffff'
      : '00000000-0000-0000-0000-000000000000';
    return { createdAt: dateCandidate, id: fallbackId };
  }

  // 3. Check if it is a direct UUID (backward compatibility)
  if (uuidPattern.test(rawCursor)) {
    const rows = await tx.$queryRaw<MessageCursorRow[]>(
      sql`
        SELECT m.created_at
        FROM messages m
        WHERE m.id = ${rawCursor}::uuid
          AND m.chat_id = ${chatId}::uuid
          AND m.is_deleted_for_all = false
          AND NOT (m.deleted_for ? ${actorId})
        LIMIT 1
      `
    );
    const date = rows[0]?.created_at ? new Date(rows[0].created_at) : null;
    if (date && !Number.isNaN(date.getTime())) {
      return { createdAt: date, id: rawCursor };
    }
  }

  throw createHttpError(400, 'Invalid cursor');
};
