import { sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { logger } from '../../config/logger.js';
import { deleteMediaFileByStorageKey } from '../mediaStorage.js';
import { queryVisibleMessage, resolveMessageChatForActor } from './access.js';
import { insertAuditLog, recountUnreadForChat, resolveDeletedMessageMediaCleanup } from './queries.js';
import type { DeleteScope, MessageScopeRow } from './types.js';

export const deleteMessage = async (actorId: string, chatId: string, messageId: string) => {
  const scope: DeleteScope = 'everyone';

  const result = await runAsUser(actorId, async tx => {
    const visible = await queryVisibleMessage(tx, actorId, messageId, chatId);
    if (!visible) return null;

    const rows = await tx.$queryRaw<MessageScopeRow[]>(
      sql`
        DELETE FROM messages m
        WHERE m.id = ${messageId}::uuid
          AND m.chat_id = ${chatId}::uuid
          AND app_can_delete_message_for_all(m.chat_id, m.sender_id)
        RETURNING m.id, m.chat_id, m.sender_id, m.media, m.type
      `
    );
    const deleted = rows[0];
    if (!deleted) return null;

    const files = await resolveDeletedMessageMediaCleanup(tx, deleted.media, messageId);
    await recountUnreadForChat(tx, chatId);
    await insertAuditLog(tx, actorId, chatId, 'message_deleted', {
      by: actorId,
      scope: 'everyone',
      messageId
    });

    return { success: true as const, scope, mode: 'hard_delete' as const, files };
  });

  if (result && result.files) {
    if (result.files.file_path) {
      try {
        await deleteMediaFileByStorageKey(result.files.file_path);
      } catch (error) {
        logger.warn('Physical media file cleanup failed after hard delete', {
          error: error instanceof Error ? error.message : String(error),
          messageId,
          chatId
        });
      }
    }
    if (result.files.thumbnail_path) {
      try {
        await deleteMediaFileByStorageKey(result.files.thumbnail_path);
      } catch (error) {
        logger.warn('Physical thumbnail file cleanup failed after hard delete', {
          error: error instanceof Error ? error.message : String(error),
          messageId,
          chatId
        });
      }
    }
  }

  return result;
};

export const deleteMessageById = async (actorId: string, messageId: string) => {
  const resolved = await resolveMessageChatForActor(actorId, messageId);
  if (!resolved) return null;
  return deleteMessage(actorId, resolved.chatId, messageId);
};
