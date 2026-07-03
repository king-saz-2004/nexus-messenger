import type { JsonValue } from '../../config/sql.js';
import { buildMediaUrl } from '../mediaStorage.js';
import { toIso } from '../../utils/dates.js';
import { mapMessageType } from '../../utils/mapping.js';
import { buildGroupCapabilities, toPermissionSet } from './access.js';
import type { ChatDto, ChatListRow } from './types.js';

export const mapRole = (role: string | null | undefined): 'OWNER' | 'ADMIN' | 'MEMBER' | undefined => {
  if (!role) return undefined;
  if (role === 'owner') return 'OWNER';
  if (role === 'admin') return 'ADMIN';
  return 'MEMBER';
};

export const mapState = (status: string | null | undefined): 'ACTIVE' | 'KICKED' | 'BANNED' | 'LEFT' | undefined => {
  if (!status) return undefined;
  if (status === 'active') return 'ACTIVE';
  if (status === 'kicked') return 'KICKED';
  if (status === 'banned') return 'BANNED';
  if (status === 'left') return 'LEFT';
  return 'ACTIVE';
};



const extractMediaField = (media: JsonValue | null, key: string) => {
  if (!media || typeof media !== 'object' || Array.isArray(media)) {
    return undefined;
  }
  const candidate = (media as Record<string, unknown>)[key];
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate;
  }
  if (typeof candidate === 'number') {
    return candidate;
  }
  return undefined;
};

const toLastMessageDto = (row: ChatListRow) => {
  if (!row.last_message_id || !row.last_message_chat_id || !row.last_message_sender_id) {
    return undefined;
  }

  const seenBy = Array.isArray(row.last_message_seen_by)
    ? row.last_message_seen_by.filter((v): v is string => typeof v === 'string')
    : [];

  const readCount = seenBy.filter(userId => userId !== row.last_message_sender_id).length;
  const isPrivate = !row.type || row.type === 'private';
  const chatMemberCount = row.member_count ?? 2;
  const readByAll = isPrivate ? readCount > 0 : readCount >= Math.max(1, chatMemberCount - 1);
  const isRead = isPrivate ? readCount > 0 : readByAll;
  const isDelivered = readCount > 0;

  const mediaUrl = row.last_message_media ? buildMediaUrl(row.last_message_id) : undefined;
  const mediaMime = extractMediaField(row.last_message_media, 'mime');
  const mediaName = extractMediaField(row.last_message_media, 'name');
  const mediaSize = extractMediaField(row.last_message_media, 'size');

  return {
    id: row.last_message_id,
    chatId: row.last_message_chat_id,
    senderId: row.last_message_sender_id,
    content: row.last_message_content ?? '',
    type: mapMessageType(row.last_message_type),
    replyToId: row.last_message_reply_to_id ?? undefined,
    mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : undefined,
    mediaMime: typeof mediaMime === 'string' ? mediaMime : undefined,
    mediaName: typeof mediaName === 'string' ? mediaName : undefined,
    mediaSizeBytes: typeof mediaSize === 'number' ? mediaSize : undefined,
    seenBy,
    reactions: [] as Array<{ emoji: string; count: number; userIds: string[] }>,
    isEdited: Boolean(row.last_message_is_edited),
    editedAt: toIso(row.last_message_edited_at),
    isDelivered,
    isRead,
    readCount,
    readByAll,
    createdAt: toIso(row.last_message_created_at),
    updatedAt: toIso(row.last_message_updated_at)
  };
};

const toChatType = (value: string): 'direct' | 'group' => {
  if (value === 'group' || value === 'supergroup' || value === 'channel') return 'group';
  return 'direct';
};

export const toChatDto = (row: ChatListRow, participants: string[], viewerId: string, partnerAvatar?: string): ChatDto => {
  const isSavedChat =
    row.type === 'private' && participants.length === 1 && participants[0] === viewerId && row.title === 'Saved Messages';
  const type = isSavedChat ? 'direct' : toChatType(row.type);
  const lastMessage = toLastMessageDto(row);
  const myRole = mapRole(row.my_role);
  const myState = mapState(row.my_status);
  const capabilities =
    row.type === 'group' && row.my_role && row.my_status
      ? buildGroupCapabilities(row.my_role, row.my_status, toPermissionSet(row.my_permissions), row.default_permissions)
      : undefined;
  // Partner avatars are only a private-chat fallback; groups without avatars must render placeholders.
  const avatar =
    row.avatar_url ??
    (row.type === 'private' && !isSavedChat ? partnerAvatar : undefined);

  return {
    id: row.id,
    type,
    name: row.type === 'group' ? row.title ?? 'Untitled Group' : isSavedChat ? 'Saved Messages' : undefined,
    avatar,
    creatorId: row.created_by ?? undefined,
    participants,
    myRole,
    myState,
    capabilities,
    unreadCount: row.unread_count ?? 0,
    lastMessage,
    lastReadMessageId: row.last_read_message_id ?? undefined,
    lastReadAt: toIso(row.last_read_at),
    typingUsers: [] as string[],
    lastActivityAt: toIso(row.last_message_created_at) ?? toIso(row.updated_at),
    isPinned: row.is_pinned,
    pinnedAt: row.is_pinned ? toIso(row.updated_at) : undefined,
    isMuted: row.is_muted,
    mutedUntil: toIso(row.mute_until),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
};
