import fs from 'node:fs/promises';
import { sql, type JsonValue } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { resolveMediaPathFromStorageKey } from '../mediaStorage.js';
import { uuidPattern } from './constants.js';
import { jsonString } from './mappers.js';
import type { MediaFileRow } from './types.js';

export const getMediaForActor = async (actorId: string, messageId: string) => {
  return runAsUser(actorId, async tx => {
    const rows = await tx.$queryRaw<Array<{ media: JsonValue | null; chat_id: string }>>(
      sql`
        SELECT m.media, m.chat_id
        FROM messages m
        WHERE m.id = ${messageId}::uuid
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
    const target = rows[0];
    if (!target?.media) return null;

    const fileId = jsonString(target.media, 'file_id');
    let storageKey = jsonString(target.media, 'path');
    let mimeType = jsonString(target.media, 'mime') ?? 'application/octet-stream';
    let fileName = jsonString(target.media, 'name');

    if (fileId && uuidPattern.test(fileId)) {
      const mediaRows = await tx.$queryRaw<MediaFileRow[]>(
        sql`
          SELECT id, file_path, mime_type, original_name
          FROM media_files
          WHERE id = ${fileId}::uuid
          LIMIT 1
        `
      );
      const mediaFile = mediaRows[0];
      if (mediaFile) {
        storageKey = mediaFile.file_path;
        mimeType = mediaFile.mime_type || mimeType;
        fileName = mediaFile.original_name || fileName;
      }
    }

    if (!storageKey) return null;
    const absolutePath = resolveMediaPathFromStorageKey(storageKey);

    try {
      await fs.access(absolutePath);
    } catch {
      return null;
    }

    return {
      absolutePath,
      mimeType,
      fileName
    };
  });
};
