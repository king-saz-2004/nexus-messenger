import { listUnreadSnapshotForChat } from '../services/messageSystem.js';
import { emitToChat, emitToUser, ensureAllMembersJoined } from './rooms.js';
import type { SocketMessage } from './types.js';

export const broadcastNewMessage = async (chatId: string, message: SocketMessage) => {
  const messageId = typeof message.id === 'string' ? message.id : '';
  const senderId = typeof message.senderId === 'string' ? message.senderId : '';
  if (senderId) {
    await ensureAllMembersJoined(chatId, senderId);
  }
  emitToChat(chatId, 'new_message', { chatId, messageId, message });
  emitToChat(chatId, 'message:created', { ...message, chatId });
};

export const broadcastMessageEdited = async (chatId: string, message: SocketMessage) => {
  const messageId = typeof message.id === 'string' ? message.id : '';
  const senderId = typeof message.senderId === 'string' ? message.senderId : '';
  if (senderId) {
    await ensureAllMembersJoined(chatId, senderId);
  }
  emitToChat(chatId, 'message_edited', { chatId, messageId, message });
};

export const broadcastMessageDeleted = async (
  chatId: string,
  messageId: string,
  actorId: string,
  scope: 'everyone',
  mode: 'hard_delete'
) => {
  await ensureAllMembersJoined(chatId, actorId);
  emitToChat(chatId, 'message_deleted', { chatId, messageId, actorId, scope, mode });
};

export const broadcastMessageReacted = async (
  chatId: string,
  message: SocketMessage,
  userId: string,
  emoji: string
) => {
  await ensureAllMembersJoined(chatId, userId);
  const messageId = typeof message.id === 'string' ? message.id : '';
  emitToChat(chatId, 'message_reacted', { chatId, messageId, userId, emoji, message });
};

export const broadcastMessageRead = async (
  chatId: string,
  messageId: string,
  userId: string,
  message?: SocketMessage
) => {
  await ensureAllMembersJoined(chatId, userId);
  emitToChat(chatId, 'message_read', { chatId, messageId, userId, ...(message ? { message } : {}) });
};

export const broadcastUnreadUpdated = (
  chatId: string,
  snapshot: Array<{ userId: string; unreadCount: number }>
) => {
  for (const entry of snapshot) {
    emitToUser(entry.userId, 'unread_updated', {
      chatId,
      count: Math.max(0, entry.unreadCount)
    });
  }
};

export const broadcastUnreadForChat = async (actorId: string, chatId: string) => {
  try {
    const snapshot = await listUnreadSnapshotForChat(actorId, chatId);
    if (!snapshot) return false;
    broadcastUnreadUpdated(chatId, snapshot);
    return true;
  } catch {
    return false;
  }
};
