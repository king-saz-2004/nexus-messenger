import type { DbExecutor } from '../../config/dbContext.js';
import type { JsonValue } from '../../config/sql.js';
import type { toMessageDto } from './mappers.js';

export type TxClient = DbExecutor;

export type MessageDirection = 'backward' | 'forward';
export type DeleteScope = 'everyone';

export type MessageListQuery = {
  limit: number;
  cursor?: string;
  direction?: MessageDirection;
};

export type SendTextPayload = {
  content: string;
  replyToId?: string;
  clientMessageId?: string;
};

export type SendMediaPayload = {
  caption?: string;
  replyToId?: string;
  kind: 'voice' | 'audio' | 'photo' | 'video';
  durationMs?: number;
  clientMessageId?: string;
};

export type ForwardPayload = {
  replyToId?: string;
};

export type EditMessagePayload = {
  content: string;
  replyToId?: string;
};

export type MarkReadPayload = {
  messageId?: string;
};

export type UnreadSnapshotEntry = {
  userId: string;
  unreadCount: number;
};

export type UuidRow = { id: string };
export type CountRow = { count: number };
export type UnreadSnapshotRow = { user_id: string; unread_count: number };
export type ReadPointerRow = { last_read_message_id: string | null };
export type MessageOrderRow = { id: string; created_at: Date | string };
export type MessageCursorRow = { created_at: Date | string };

export type ChatVisibilityRow = {
  chat_id: string;
  chat_type: 'private' | 'group' | 'supergroup' | 'channel';
};

export type MessageContextRow = ChatVisibilityRow & {
  actor_role: string;
  can_send_messages: boolean;
  slow_mode_seconds: number;
  last_message_at: Date | string | null;
};

export type MessageScopeRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  media: JsonValue | null;
  type: string;
};

export type MediaFileRow = {
  id: string;
  file_path: string;
  mime_type: string;
  original_name: string;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  type: string;
  content: string | null;
  media: JsonValue | null;
  reply_to_id: string | null;
  is_edited: boolean;
  edited_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  client_message_id: string | null;
  reply_id: string | null;
  reply_sender_id: string | null;
  reply_content: string | null;
  reply_type: string | null;
  reply_media: JsonValue | null;
  seen_by: string[] | null;
  reactions: JsonValue | null;
  chat_type?: string;
  chat_member_count?: number;
  is_pinned?: boolean;
  pinned_at?: Date | string | null;
  pinned_by?: string | null;
};

export type InsertMessageInput = {
  chatId: string;
  senderId: string;
  type: string;
  content: string | null;
  media?: JsonValue | null;
  replyToId?: string;
  forwardFromId?: string;
  forwardFromChat?: string;
  forwardFromUser?: string;
  forwardDate?: Date;
  systemEvent?: JsonValue | null;
  incrementUnread?: boolean;
  clientMessageId?: string;
};

export type SendMessageResult = {
  message: ReturnType<typeof toMessageDto>;
  created: boolean;
};
