import { sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { db } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { deleteMediaFileByStorageKey } from '../mediaStorage.js';
import { insertAuditLog, resolveDeletedMessageMediaCleanup } from './queries.js';
import type { MessageScopeRow } from './types.js';

export const clearChatMessages = async (actorId: string, chatId: string) => {
  const result = await runAsUser(actorId, async tx => {
    const deletedRows = await tx.$queryRaw<MessageScopeRow[]>(
      sql`SELECT * FROM app_clear_chat_messages(${chatId}::uuid)`
    );

    const filesToCleanup: Array<{ file_path: string; thumbnail_path: string | null }> = [];
    for (const row of deletedRows) {
      const files = await resolveDeletedMessageMediaCleanup(tx, row.media, row.id);
      if (files) {
        filesToCleanup.push(files);
      }
    }

    await insertAuditLog(tx, actorId, chatId, 'chat_history_cleared', {
      by: actorId,
      chatId,
      deletedCount: deletedRows.length
    });

    return { success: true as const, deletedCount: deletedRows.length, files: filesToCleanup };
  });

  if (result && result.files && result.files.length > 0) {
    for (const file of result.files) {
      if (file.file_path) {
        try {
          await deleteMediaFileByStorageKey(file.file_path);
        } catch (error) {
          logger.warn('Physical media file cleanup failed after clear chat', {
            error: error instanceof Error ? error.message : String(error),
            chatId
          });
        }
      }
      if (file.thumbnail_path) {
        try {
          await deleteMediaFileByStorageKey(file.thumbnail_path);
        } catch (error) {
          logger.warn('Physical thumbnail file cleanup failed after clear chat', {
            error: error instanceof Error ? error.message : String(error),
            chatId
          });
        }
      }
    }
  }

  return result;
};

export const rootClearAllMessages = async () => {
  const result = await db.$transaction(async tx => {
    const deletedRows = await tx.$queryRaw<MessageScopeRow[]>(
      sql`SELECT * FROM app_root_clear_all_messages()`
    );

    const filesToCleanup: Array<{ file_path: string; thumbnail_path: string | null }> = [];
    for (const row of deletedRows) {
      const files = await resolveDeletedMessageMediaCleanup(tx, row.media, row.id);
      if (files) {
        filesToCleanup.push(files);
      }
    }

    return { success: true as const, deletedCount: deletedRows.length, files: filesToCleanup };
  });

  if (result.files.length > 0) {
    for (const file of result.files) {
      if (file.file_path) {
        try {
          await deleteMediaFileByStorageKey(file.file_path);
        } catch (error) {
          logger.warn('Physical media file cleanup failed after root clear all messages', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (file.thumbnail_path) {
        try {
          await deleteMediaFileByStorageKey(file.thumbnail_path);
        } catch (error) {
          logger.warn('Physical thumbnail file cleanup failed after root clear all messages', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  return result;
};

export const rootClearAllMedia = async () => {
  const result = await db.$transaction(async tx => {
    const deletedRows = await tx.$queryRaw<MessageScopeRow[]>(
      sql`SELECT * FROM app_root_clear_all_media()`
    );

    const filesToCleanup: Array<{ file_path: string; thumbnail_path: string | null }> = [];
    for (const row of deletedRows) {
      const files = await resolveDeletedMessageMediaCleanup(tx, row.media, row.id);
      if (files) {
        filesToCleanup.push(files);
      }
    }

    return { success: true as const, deletedCount: deletedRows.length, files: filesToCleanup };
  });

  if (result.files.length > 0) {
    for (const file of result.files) {
      if (file.file_path) {
        try {
          await deleteMediaFileByStorageKey(file.file_path);
        } catch (error) {
          logger.warn('Physical media file cleanup failed after root clear all media', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (file.thumbnail_path) {
        try {
          await deleteMediaFileByStorageKey(file.thumbnail_path);
        } catch (error) {
          logger.warn('Physical thumbnail file cleanup failed after root clear all media', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  return result;
};
