import type { JsonValue } from '../../config/sql.js';
import { buildMediaUrl } from '../mediaStorage.js';
import { toIso } from '../../utils/dates.js';
import { mapMessageType } from '../../utils/mapping.js';
import type { MessageRow } from './types.js';

const asObject = (value: JsonValue | null | undefined): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const jsonString = (value: JsonValue | null | undefined, key: string) => {
  const obj = asObject(value);
  const raw = obj?.[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
};

export const jsonNumber = (value: JsonValue | null | undefined, key: string) => {
  const obj = asObject(value);
  const raw = obj?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
};

export const jsonBoolean = (value: JsonValue | null | undefined, key: string) => {
  const obj = asObject(value);
  const raw = obj?.[key];
  return typeof raw === 'boolean' ? raw : undefined;
};

export const readStringArray = (value: unknown) => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []) as string[];

export const parseReactions = (value: JsonValue | null | undefined) => {
  if (!Array.isArray(value)) return [] as Array<{ emoji: string; count: number; userIds: string[] }>;
  const normalized: Array<{ emoji: string; count: number; userIds: string[] }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const emoji = typeof item.emoji === 'string' ? item.emoji : null;
    const count = typeof item.count === 'number' && Number.isFinite(item.count) ? item.count : null;
    const userIds = readStringArray(item.userIds);
    if (!emoji || count === null) continue;
    normalized.push({ emoji, count, userIds });
  }
  return normalized;
};





export const toMessageDto = (row: MessageRow) => {
  const seenBy = readStringArray(row.seen_by);
  const reactions = parseReactions(row.reactions);
  const replyMediaName = jsonString(row.reply_media, 'name');
  const isVoice = row.type === 'voice' || jsonBoolean(row.media, 'is_voice') === true;
  const replyTo =
    row.reply_id && row.reply_sender_id
      ? {
        id: row.reply_id,
        senderId: row.reply_sender_id,
        content: row.reply_content ?? '',
        type: mapMessageType(row.reply_type),
        mediaName: replyMediaName
      }
      : undefined;
  
  const readCount = seenBy.filter(userId => userId !== row.sender_id).length;
  const isPrivate = !row.chat_type || row.chat_type === 'private';
  const chatMemberCount = row.chat_member_count ?? 2;
  const readByAll = isPrivate ? readCount > 0 : readCount >= Math.max(1, chatMemberCount - 1);
  const isRead = isPrivate ? readCount > 0 : readByAll;
  const isDelivered = readCount > 0;

  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    content: row.content ?? '',
    type: mapMessageType(row.type),
    replyToId: row.reply_to_id ?? undefined,
    replyTo,
    mediaUrl: row.media ? buildMediaUrl(row.id) : undefined,
    mediaMime: jsonString(row.media, 'mime'),
    mediaName: jsonString(row.media, 'name'),
    mediaSizeBytes: jsonNumber(row.media, 'size'),
    isVoice,
    voiceDurationMs: isVoice ? jsonNumber(row.media, 'duration_ms') : undefined,
    seenBy,
    reactions,
    isEdited: row.is_edited,
    editedAt: toIso(row.edited_at),
    isDelivered,
    isRead,
    readCount,
    readByAll,
    clientMessageId: row.client_message_id ?? undefined,
    isPinned: row.is_pinned ?? false,
    pinnedAt: toIso(row.pinned_at),
    pinnedBy: row.pinned_by ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
};
