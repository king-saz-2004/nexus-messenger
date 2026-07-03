import { ApiMessage } from '../../types';
import { request } from './baseClient';

export const messagesApi = {
  getMessages: (
    chatId: string,
    arg2?: boolean | string,
    arg3?: string | number,
    arg4?: number | boolean
  ) => {
    let isGroup = false;
    let cursor: string | undefined = undefined;
    let limit: number | undefined = undefined;

    if (typeof arg2 === 'boolean') {
      isGroup = arg2;
      if (typeof arg3 === 'string') {
        cursor = arg3;
      }
      if (typeof arg4 === 'number') {
        limit = arg4;
      }
    } else {
      if (typeof arg2 === 'string') {
        cursor = arg2;
      }
      if (typeof arg3 === 'number') {
        limit = arg3;
      }
      if (typeof arg4 === 'boolean') {
        isGroup = arg4;
      }
    }

    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit !== undefined) params.set('limit', String(limit));
    const query = params.toString();
    return request<{ messages: ApiMessage[]; hasMore: boolean; nextCursor?: string }>(
      `${isGroup ? '/groups' : '/chats'}/${chatId}/messages${query ? `?${query}` : ''}`
    );
  },
  searchMessages: (chatId: string, isGroup: boolean, query: string) =>
    request<{ messages: ApiMessage[] }>(
      `${isGroup ? '/groups' : '/chats'}/${chatId}/messages/search?q=${encodeURIComponent(query)}`
    ),
  sendMessage: (chatId: string, isGroup: boolean, content: string, replyToId?: string, clientMessageId?: string) =>
    request<{ message: ApiMessage }>(`${isGroup ? '/groups' : '/chats'}/${chatId}/messages`, {
      method: 'POST',
      body: { content, replyToId, ...(clientMessageId ? { clientMessageId } : {}) }
    }),
  sendMedia: async (
    chatId: string,
    isGroup: boolean,
    file: File,
    caption?: string,
    replyToId?: string,
    meta?: { kind: 'voice' | 'audio' | 'photo' | 'video'; durationMs?: number },
    clientMessageId?: string
  ) => {
    const form = new FormData();
    if (meta?.kind) form.append('kind', meta.kind);
    if (caption) form.append('caption', caption);
    if (replyToId) form.append('replyToId', replyToId);
    if (clientMessageId) form.append('clientMessageId', clientMessageId);
    if (typeof meta?.durationMs === 'number' && Number.isFinite(meta.durationMs)) {
      form.append('durationMs', String(Math.max(1, Math.round(meta.durationMs))));
    }
    form.append('file', file);
    return request<{ message: ApiMessage }>(`${isGroup ? '/groups' : '/chats'}/${chatId}/media`, {
      method: 'POST',
      body: form
    });
  },
  markSeen: (messageId: string) =>
    request<{ message: ApiMessage | null }>(`/messages/${messageId}/seen`, { method: 'POST' }),
  addReaction: (messageId: string, emoji: string) =>
    request<{ message: ApiMessage }>(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: { emoji }
    }),
  removeReaction: (messageId: string, emoji: string) =>
    request<{ message: ApiMessage }>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
      method: 'DELETE'
    }),
  editMessage: (messageId: string, content: string, replyToId?: string) =>
    request<{ message: ApiMessage }>(`/messages/${messageId}`, { method: 'PATCH', body: { content, replyToId } }),
  deleteMessage: (messageId: string) => request<{ success: boolean }>(`/messages/${messageId}`, { method: 'DELETE' })
};
