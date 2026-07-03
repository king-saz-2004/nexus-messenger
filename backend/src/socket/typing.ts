import { typingByChat } from './state.js';
import { emitToChat } from './rooms.js';

const TYPING_TTL_MS = 6000;

export const clearTypingEntry = (chatId: string, userId: string, emit = true) => {
  const typingUsers = typingByChat.get(chatId);
  if (!typingUsers) return;

  const timeout = typingUsers.get(userId);
  if (!timeout) return;

  clearTimeout(timeout);
  typingUsers.delete(userId);
  if (typingUsers.size === 0) {
    typingByChat.delete(chatId);
  }

  if (emit) {
    emitToChat(chatId, 'user_stopped_typing', { chatId, userId });
  }
};

export const clearTypingForUser = (userId: string) => {
  for (const [chatId] of typingByChat) {
    clearTypingEntry(chatId, userId, true);
  }
};

export const setTypingActive = (chatId: string, userId: string, username: string) => {
  const typingUsers = typingByChat.get(chatId) ?? new Map<string, NodeJS.Timeout>();
  const hadEntry = typingUsers.has(userId);

  if (hadEntry) {
    const timeout = typingUsers.get(userId);
    if (timeout) clearTimeout(timeout);
  } else {
    emitToChat(chatId, 'user_typing', { chatId, userId, username });
  }

  const timeout = setTimeout(() => {
    clearTypingEntry(chatId, userId, true);
  }, TYPING_TTL_MS);

  typingUsers.set(userId, timeout);
  typingByChat.set(chatId, typingUsers);
};
