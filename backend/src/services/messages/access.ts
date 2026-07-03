import { emptySql, sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { createHttpError } from '../../utils/errors.js';
import type { ChatVisibilityRow, MessageContextRow, MessageScopeRow, TxClient, UuidRow } from './types.js';

export const assertReplyTarget = async (tx: TxClient, actorId: string, chatId: string, replyToId?: string) => {
  if (!replyToId) return;
  const rows = await tx.$queryRaw<UuidRow[]>(
    sql`
      SELECT m.id
      FROM messages m
      WHERE m.id = ${replyToId}::uuid
        AND m.chat_id = ${chatId}::uuid
        AND m.is_deleted_for_all = false
        AND NOT (m.deleted_for ? ${actorId})
      LIMIT 1
    `
  );
  if (rows.length === 0) {
    throw createHttpError(400, 'Invalid reply target');
  }
};

export const loadChatVisible = async (tx: TxClient, actorId: string, chatId: string, groupOnly = false) => {
  const groupFilter = groupOnly ? sql`AND c.type = 'group'` : emptySql;
  const rows = await tx.$queryRaw<ChatVisibilityRow[]>(
    sql`
      SELECT c.id AS chat_id, c.type AS chat_type
      FROM chats c
      JOIN chat_members cm
        ON cm.chat_id = c.id
       AND cm.user_id = ${actorId}::uuid
       AND cm.status = 'active'
      WHERE c.id = ${chatId}::uuid
        ${groupFilter}
        AND c.is_active = true
        AND c.is_deleted = false
      LIMIT 1
    `
  );
  return rows[0] ?? null;
};

export const loadMessageContext = async (tx: TxClient, actorId: string, chatId: string, groupOnly = false) => {
  const groupFilter = groupOnly ? sql`AND c.type = 'group'` : emptySql;
  const rows = await tx.$queryRaw<MessageContextRow[]>(
    sql`
      SELECT
        c.id AS chat_id,
        c.type AS chat_type,
        cm.role AS actor_role,
        check_permission(${actorId}::uuid, c.id, 'can_send_messages') AS can_send_messages,
        c.slow_mode_seconds,
        cm.last_message_at
      FROM chats c
      JOIN chat_members cm
        ON cm.chat_id = c.id
       AND cm.user_id = ${actorId}::uuid
       AND cm.status = 'active'
      WHERE c.id = ${chatId}::uuid
        ${groupFilter}
        AND c.is_active = true
        AND c.is_deleted = false
      LIMIT 1
    `
  );
  return rows[0] ?? null;
};

export const enforceSlowMode = (context: MessageContextRow) => {
  if (context.slow_mode_seconds <= 0) return;
  if (context.actor_role === 'owner' || context.actor_role === 'admin') return;
  if (!context.last_message_at) return;

  const lastMessageAt = new Date(context.last_message_at);
  if (Number.isNaN(lastMessageAt.getTime())) return;

  const waitMs = context.slow_mode_seconds * 1000 - (Date.now() - lastMessageAt.getTime());
  if (waitMs > 0) {
    throw createHttpError(429, `Slow mode is enabled. Try again in ${Math.ceil(waitMs / 1000)}s`);
  }
};

export const queryVisibleMessage = async (tx: TxClient, actorId: string, messageId: string, chatId?: string) => {
  const chatFilter = chatId ? sql`AND m.chat_id = ${chatId}::uuid` : emptySql;
  const rows = await tx.$queryRaw<MessageScopeRow[]>(
    sql`
      SELECT m.id, m.chat_id, m.sender_id, m.media, m.type
      FROM messages m
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

export const requireSendContext = async (tx: TxClient, actorId: string, chatId: string, groupOnly = false) => {
  const context = await loadMessageContext(tx, actorId, chatId, groupOnly);
  if (!context) return null;
  if (!context.can_send_messages) return null;
  enforceSlowMode(context);
  return context;
};

export const resolveMessageChatForActor = async (actorId: string, messageId: string) => {
  return runAsUser(actorId, async tx => {
    const visible = await queryVisibleMessage(tx, actorId, messageId);
    if (!visible) return null;
    const chat = await loadChatVisible(tx, actorId, visible.chat_id);
    if (!chat) return null;
    return {
      chatId: visible.chat_id,
      chatType: chat.chat_type
    };
  });
};
