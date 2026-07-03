import { emptySql, sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { assertReplyTarget, loadChatVisible, queryVisibleMessage } from './access.js';
import { toMessageDto } from './mappers.js';
import { queryMessageById } from './queries.js';
import type { EditMessagePayload, MessageRow, TxClient, UuidRow } from './types.js';

const runEditMessage = async (tx: TxClient, actorId: string, chatId: string, messageId: string, payload: EditMessagePayload) => {
  await assertReplyTarget(tx, actorId, chatId, payload.replyToId);

  const replyFragment = payload.replyToId !== undefined
    ? sql`reply_to_id = ${payload.replyToId ? sql`${payload.replyToId}::uuid` : sql`NULL`},`
    : emptySql;

  const rows = await tx.$queryRaw<UuidRow[]>(
    sql`
      UPDATE messages
      SET
        content = ${payload.content.trim()},
        ${replyFragment}
        is_edited = true,
        edited_at = NOW(),
        edit_history = COALESCE(edit_history, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'content', content,
            'replaced_at', NOW(),
            'was_edited_at', COALESCE(edited_at, created_at)
          )
        )
      WHERE id = ${messageId}::uuid
        AND chat_id = ${chatId}::uuid
        AND sender_id = ${actorId}::uuid
        AND is_deleted_for_all = false
      RETURNING id
    `
  );
  if (rows.length === 0) return null;

  const message = await queryMessageById(tx, actorId, messageId, chatId);
  return message ? toMessageDto(message) : null;
};

export const editMessage = async (actorId: string, chatId: string, messageId: string, payload: EditMessagePayload) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId);
    if (!chat) return null;
    return runEditMessage(tx, actorId, chatId, messageId, payload);
  });
};

export const editMessageById = async (actorId: string, messageId: string, payload: EditMessagePayload) => {
  return runAsUser(actorId, async tx => {
    const scope = await queryVisibleMessage(tx, actorId, messageId);
    if (!scope) return null;
    return runEditMessage(tx, actorId, scope.chat_id, messageId, payload);
  });
};
