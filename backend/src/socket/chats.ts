import { chatRoom, emitToChat, getSocketsForUser, joinUserChatRoom, ensureAllMembersJoined } from './rooms.js';
import { clearTypingEntry } from './typing.js';

export const ejectUserFromChatRoom = (userId: string, chatId: string, reason: string) => {
  for (const socket of getSocketsForUser(userId)) {
    socket.leave(chatRoom(chatId));
    socket.emit('force_disconnect', { chatId, reason });
  }
  clearTypingEntry(chatId, userId, true);
};

export const broadcastMemberAdded = async (chatId: string, userIds: string[], addedBy: string) => {
  for (const userId of userIds) {
    await joinUserChatRoom(userId, chatId);
  }
  emitToChat(chatId, 'member_added', { chatId, userIds, addedBy });
};

export const broadcastMemberRemoved = async (chatId: string, userId: string, removedBy: string) => {
  emitToChat(chatId, 'member_removed', { chatId, userId, removedBy });
};

export const broadcastMemberRoleChanged = async (chatId: string, userId: string, newRole: string, changedBy: string) => {
  emitToChat(chatId, 'member_role_changed', { chatId, userId, newRole, changedBy });
};

export const broadcastMemberBanned = async (chatId: string, userId: string, bannedBy: string) => {
  emitToChat(chatId, 'member_banned', { chatId, userId, bannedBy });
};

export const broadcastChatUpdated = async (
  chatId: string,
  chat?: Record<string, unknown>,
  changes?: Record<string, unknown>,
  actorId?: string
) => {
  if (actorId) {
    await ensureAllMembersJoined(chatId, actorId);
  }
  emitToChat(chatId, 'chat_updated', { chatId, ...(chat ? { chat } : {}), ...(changes ? { changes } : {}) });
};

export const broadcastChatDeleted = async (chatId: string, deletedBy: string) => {
  emitToChat(chatId, 'chat_deleted', { chatId, deletedBy });
};

export const broadcastChatCleared = async (chatId: string) => {
  emitToChat(chatId, 'chat:cleared', { chatId });
};
