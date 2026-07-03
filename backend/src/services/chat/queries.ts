import { joinSql, sql, type JsonValue, type SqlFragment } from '../../config/sql.js';
import { toChatDto } from './mappers.js';
import type { ChatListRow, ChatMemberRow, GroupActorContext, LoadChatOptions, ParticipantRow, TxClient } from './types.js';

export const setDirectoryScope = async (tx: TxClient) => {
  await tx.$executeRaw`SELECT set_config('app.user_directory', 'on', true)`;
};

export const acquireLock = async (tx: TxClient, key: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
};

export const recountMembers = async (tx: TxClient, chatId: string) => {
  await tx.$executeRaw`
    UPDATE chats c
    SET member_count = (
      SELECT COUNT(*)
      FROM chat_members cm
      WHERE cm.chat_id = c.id
        AND cm.status = 'active'
    )
    WHERE c.id = ${chatId}::uuid
  `;
};

export const loadChatRows = async (tx: TxClient, userId: string, options: LoadChatOptions) => {
  const filters: SqlFragment[] = [
    sql`c.is_active = true`,
    sql`c.is_deleted = false`
  ];

  if (options.chatId) {
    filters.push(sql`c.id = ${options.chatId}::uuid`);
  }

  const trimmed = options.query?.trim().toLowerCase() ?? '';
  if (trimmed.length > 0) {
    await setDirectoryScope(tx);
    const escaped = trimmed.replace(/[%_\\]/g, char => `\\${char}`);
    const pattern = `%${escaped}%`;
    filters.push(
      sql`(
        LOWER(COALESCE(c.title, '')) LIKE ${pattern} ESCAPE '\\'
        OR LOWER(COALESCE(c.description, '')) LIKE ${pattern} ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM chat_members cmq
          JOIN users uq ON uq.id = cmq.user_id
          WHERE cmq.chat_id = c.id
            AND cmq.user_id != ${userId}::uuid
            AND cmq.status = 'active'
            AND (
              LOWER(COALESCE(uq.username, '')) LIKE ${pattern} ESCAPE '\\'
              OR LOWER(COALESCE(uq.first_name, '')) LIKE ${pattern} ESCAPE '\\'
              OR LOWER(COALESCE(uq.last_name, '')) LIKE ${pattern} ESCAPE '\\'
            )
        )
      )`
    );
  }

  const rows = await tx.$queryRaw<ChatListRow[]>(
    sql`
      SELECT
        c.id,
        c.type,
        c.title,
        c.description,
        c.avatar_url,
        c.created_by,
        c.created_at,
        c.updated_at,
        c.member_count,
        cm.role AS my_role,
        cm.status AS my_status,
        cm.permissions AS my_permissions,
        c.default_permissions,
        cm.is_pinned,
        cm.pin_order,
        cm.is_muted,
        cm.mute_until,
        cm.last_read_message_id,
        cm.last_read_at,
        cm.unread_count,
        lm.id AS last_message_id,
        lm.chat_id AS last_message_chat_id,
        lm.sender_id AS last_message_sender_id,
        lm.type AS last_message_type,
        lm.content AS last_message_content,
        lm.media AS last_message_media,
        lm.reply_to_id AS last_message_reply_to_id,
        lm.is_edited AS last_message_is_edited,
        lm.edited_at AS last_message_edited_at,
        lm.created_at AS last_message_created_at,
        lm.updated_at AS last_message_updated_at,
        lm.seen_by AS last_message_seen_by
      FROM chats c
      JOIN chat_members cm
        ON cm.chat_id = c.id
       AND cm.user_id = ${userId}::uuid
       AND cm.status = 'active'
      LEFT JOIN LATERAL (
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
          COALESCE(
            (
              SELECT array_agg(mr.user_id::text ORDER BY mr.read_at)
              FROM message_reads mr
              WHERE mr.message_id = m.id
            ),
            ARRAY[]::text[]
          ) AS seen_by
        FROM messages m
        WHERE m.chat_id = c.id
          AND m.is_deleted_for_all = false
          AND NOT (m.deleted_for ? ${userId})
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
      ) lm ON true
      WHERE ${joinSql(filters, ' AND ')}
      ORDER BY
        cm.is_pinned DESC,
        cm.pin_order ASC,
        COALESCE(lm.created_at, c.updated_at) DESC,
        c.created_at DESC
    `
  );

  if (rows.length === 0) {
    return [];
  }

  const chatIds = rows.map(row => sql`${row.id}::uuid`);
  await setDirectoryScope(tx);
  const participantRows = await tx.$queryRaw<ParticipantRow[]>(
    sql`
      SELECT cm.chat_id, cm.user_id, u.avatar_url
      FROM chat_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id IN (${joinSql(chatIds, ',')})
        AND cm.status = 'active'
      ORDER BY cm.joined_at ASC, cm.created_at ASC
    `
  );

  const participantsByChat = new Map<string, string[]>();
  const partnerAvatarByChat = new Map<string, string>();
  const privateChatIds = new Set(rows.filter(row => row.type === 'private').map(row => row.id));
  for (const participant of participantRows) {
    const list = participantsByChat.get(participant.chat_id) ?? [];
    list.push(participant.user_id);
    participantsByChat.set(participant.chat_id, list);
    if (
      privateChatIds.has(participant.chat_id) &&
      participant.user_id !== userId &&
      participant.avatar_url
    ) {
      partnerAvatarByChat.set(participant.chat_id, participant.avatar_url);
    }
  }

  for (const row of rows) {
    if (row.type === 'private' && row.created_by) {
      const list = participantsByChat.get(row.id) ?? [];
      if (!list.includes(row.created_by)) {
        list.push(row.created_by);
        participantsByChat.set(row.id, list);
      }
    }
  }

  return rows.map(row => toChatDto(row, participantsByChat.get(row.id) ?? [], userId, partnerAvatarByChat.get(row.id)));
};

export const loadSingleChat = async (tx: TxClient, userId: string, chatId: string) => {
  const rows = await loadChatRows(tx, userId, { chatId });
  return rows[0] ?? null;
};

export const loadGroupActorContext = async (tx: TxClient, actorId: string, chatId: string) => {
  const rows = await tx.$queryRaw<GroupActorContext[]>`
    SELECT
      c.id AS chat_id,
      cm.role AS actor_role,
      cm.status AS actor_status,
      cm.permissions AS actor_permissions
    FROM chats c
    JOIN chat_members cm
      ON cm.chat_id = c.id
     AND cm.user_id = ${actorId}::uuid
    WHERE c.id = ${chatId}::uuid
      AND c.type = 'group'
      AND c.is_active = true
      AND c.is_deleted = false
      AND cm.status = 'active'
    LIMIT 1
  `;

  return rows[0] ?? null;
};

export const loadChatMember = async (tx: TxClient, chatId: string, userId: string) => {
  const rows = await tx.$queryRaw<ChatMemberRow[]>`
    SELECT user_id, role, status, permissions
    FROM chat_members
    WHERE chat_id = ${chatId}::uuid
      AND user_id = ${userId}::uuid
    LIMIT 1
  `;

  return rows[0] ?? null;
};

export const insertAuditLog = async (
  tx: TxClient,
  actorId: string,
  chatId: string,
  action: string,
  targetId?: string,
  details?: JsonValue
) => {
  const targetSql = targetId ? sql`${targetId}::uuid` : sql`NULL`;
  const detailsJson = details === undefined ? null : JSON.stringify(details);

  await tx.$executeRaw(
    sql`
      INSERT INTO audit_log (chat_id, actor_id, target_id, action, details)
      VALUES (
        ${chatId}::uuid,
        ${actorId}::uuid,
        ${targetSql},
        ${action},
        ${detailsJson}::jsonb
      )
    `
  );
};
