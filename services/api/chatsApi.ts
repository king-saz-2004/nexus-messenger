import { ApiChat, ApiMessage } from '../../types';
import { request } from './baseClient';

export const chatsApi = {
  getChats: (query?: string) =>
    request<{ chats: ApiChat[] }>(`/chats${query ? `?query=${encodeURIComponent(query)}` : ''}`),
  getSavedChat: () => request<{ chat: ApiChat }>('/chats/saved'),
  getDirectChat: (userId: string) => request<{ chat: ApiChat }>('/chats/direct', { method: 'POST', body: { userId } }),
  updateChatPreferences: (chatId: string, payload: { isPinned?: boolean; isMuted?: boolean; mutedUntil?: string | null }) =>
    request<{ chat: ApiChat }>(`/chats/${chatId}/preferences`, { method: 'PATCH', body: payload }),
  markChatRead: (chatId: string, messageId?: string) =>
    request<{ success: boolean; chatId: string; lastReadMessageId: string | null }>(`/chats/${chatId}/read`, {
      method: 'POST',
      body: messageId ? { messageId } : {}
    }),
  clearChatMessages: (chatId: string) =>
    request<{ success: boolean; deletedCount: number }>(`/chats/${chatId}/messages`, { method: 'DELETE' }),
  listPinnedMessages: (chatId: string) =>
    request<{ messages: ApiMessage[] }>(`/chats/${chatId}/pinned`),
  pinMessage: (chatId: string, messageId: string) =>
    request<{ message: ApiMessage }>(`/chats/${chatId}/messages/${messageId}/pin`, { method: 'POST' }),
  unpinMessage: (chatId: string, messageId: string) =>
    request<{ message: ApiMessage }>(`/chats/${chatId}/messages/${messageId}/pin`, { method: 'DELETE' })
};
