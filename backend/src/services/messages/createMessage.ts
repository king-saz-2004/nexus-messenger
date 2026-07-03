import type { Express } from 'express';
import { sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { logger } from '../../config/logger.js';
import { ensureSenderContactLink, resolvePrivateChatPeerId } from '../contactSync.js';
import { getMediaLimitsWithClient } from '../appSettings.js';
import {
  deleteMediaFileByStorageKey,
  sanitizeOriginalFileName,
  validateMediaFile
} from '../mediaStorage.js';
import { createHttpError } from '../../utils/errors.js';
import { VOICE_LIMITS } from './constants.js';
import { assertReplyTarget, queryVisibleMessage, requireSendContext } from './access.js';
import { toMessageDto } from './mappers.js';
import { insertMessageCore, queryMessageByClientMessageId, queryMessageById } from './queries.js';
import type { ForwardPayload, SendMediaPayload, SendMessageResult, SendTextPayload, UuidRow } from './types.js';

export const sendTextMessage = async (
  actorId: string,
  chatId: string,
  payload: SendTextPayload,
  groupOnly = false
): Promise<SendMessageResult | null> => {
  return runAsUser(actorId, async tx => {
    const context = await requireSendContext(tx, actorId, chatId, groupOnly);
    if (!context) return null;
    if (context.chat_type === 'private') {
      const peerId = await resolvePrivateChatPeerId(tx, chatId, actorId);
      if (peerId) {
        await ensureSenderContactLink(tx, actorId, peerId);
      }
    }

    await assertReplyTarget(tx, actorId, chatId, payload.replyToId);

    const messageId = await insertMessageCore(tx, {
      chatId,
      senderId: actorId,
      type: 'text',
      content: payload.content.trim(),
      replyToId: payload.replyToId,
      clientMessageId: payload.clientMessageId
    });
    if (!messageId) return null;

    const message = await queryMessageById(tx, actorId, messageId.messageId, chatId);
    return message
      ? {
        message: toMessageDto(message),
        created: messageId.created
      }
      : null;
  });
};

export const sendMediaMessage = async (
  actorId: string,
  chatId: string,
  file: Express.Multer.File,
  payload: SendMediaPayload,
  groupOnly = false
): Promise<SendMessageResult | null> => {
  const isVoice = payload.kind === 'voice';
  if (isVoice) {
    const normalizedDuration = Math.round(payload.durationMs ?? 0);
    if (!Number.isFinite(normalizedDuration) || normalizedDuration < VOICE_LIMITS.minDurationMs) {
      throw createHttpError(400, 'Voice recording is too short');
    }
    if (normalizedDuration > VOICE_LIMITS.maxDurationMs) {
      throw createHttpError(413, 'Voice recording is too long');
    }
  }

  const safeName = sanitizeOriginalFileName(file.originalname);
  let storageKeyToDelete: string | null = null;

  const result = await runAsUser(actorId, async tx => {
    const limits = await getMediaLimitsWithClient(tx);
    const { mediaType } = validateMediaFile(file, limits, payload.kind);
    if (isVoice && mediaType !== 'audio') {
      throw createHttpError(400, 'Voice messages must be uploaded as audio');
    }

    let voiceDurationMs: number | undefined;
    if (isVoice) {
      voiceDurationMs = Math.round(payload.durationMs ?? 0);
    }

    const dbType = isVoice ? 'voice' : mediaType === 'image' ? 'photo' : mediaType;

    const context = await requireSendContext(tx, actorId, chatId, groupOnly);
    if (!context) return null;
    if (context.chat_type === 'private') {
      const peerId = await resolvePrivateChatPeerId(tx, chatId, actorId);
      if (peerId) {
        await ensureSenderContactLink(tx, actorId, peerId);
      }
    }

    await assertReplyTarget(tx, actorId, chatId, payload.replyToId);

    if (payload.clientMessageId) {
      const existing = await queryMessageByClientMessageId(tx, actorId, chatId, actorId, payload.clientMessageId);
      if (existing) {
        storageKeyToDelete = file.filename;
        return {
          message: toMessageDto(existing),
          created: false
        };
      }
    }

    const mediaRows = await tx.$queryRaw<UuidRow[]>(
      sql`
        INSERT INTO media_files (uploader_id, original_name, stored_name, mime_type, file_size, file_path)
        VALUES (${actorId}::uuid, ${safeName}, ${file.filename}, ${file.mimetype}, ${file.size}, ${file.filename})
        RETURNING id
      `
    );
    const mediaFileId = mediaRows[0]?.id;
    if (!mediaFileId) return null;

    const media = {
      type: mediaType,
      file_id: mediaFileId,
      mime: file.mimetype,
      name: safeName,
      size: file.size,
      path: file.filename,
      is_voice: isVoice,
      duration_ms: voiceDurationMs ?? null
    };

    const messageId = await insertMessageCore(tx, {
      chatId,
      senderId: actorId,
      type: dbType,
      content: payload.caption?.trim() || null,
      replyToId: payload.replyToId,
      media,
      clientMessageId: payload.clientMessageId
    });
    if (!messageId) return null;

    if (!messageId.created) {
      await tx.$executeRaw(
        sql`
          DELETE FROM media_files
          WHERE id = ${mediaFileId}::uuid
        `
      );
      storageKeyToDelete = file.filename;
      const existing = await queryMessageById(tx, actorId, messageId.messageId, chatId);
      return existing
        ? {
          message: toMessageDto(existing),
          created: false
        }
        : null;
    }

    const message = await queryMessageById(tx, actorId, messageId.messageId, chatId);
    return message
      ? {
        message: toMessageDto(message),
        created: true
      }
      : null;
  });

  if (storageKeyToDelete) {
    try {
      await deleteMediaFileByStorageKey(storageKeyToDelete);
    } catch (error) {
      logger.warn('Physical media file cleanup failed for duplicate upload', {
        error: error instanceof Error ? error.message : String(error),
        messageId: result ? result.message.id : undefined,
        chatId
      });
    }
  }

  return result;
};

export const forwardMessage = async (
  actorId: string,
  sourceMessageId: string,
  targetChatId: string,
  payload: ForwardPayload = {}
) => {
  return runAsUser(actorId, async tx => {
    const source = await queryVisibleMessage(tx, actorId, sourceMessageId);
    if (!source || source.type === 'system') return null;

    const context = await requireSendContext(tx, actorId, targetChatId);
    if (!context) return null;

    await assertReplyTarget(tx, actorId, targetChatId, payload.replyToId);
    const sourceFull = await queryMessageById(tx, actorId, sourceMessageId, source.chat_id);
    if (!sourceFull) return null;

    const messageId = await insertMessageCore(tx, {
      chatId: targetChatId,
      senderId: actorId,
      type: source.type,
      content: sourceFull.content,
      media: sourceFull.media,
      replyToId: payload.replyToId,
      forwardFromId: source.id,
      forwardFromChat: source.chat_id,
      forwardFromUser: source.sender_id,
      forwardDate: new Date()
    });
    if (!messageId) return null;

    const message = await queryMessageById(tx, actorId, messageId.messageId, targetChatId);
    return message ? toMessageDto(message) : null;
  });
};
