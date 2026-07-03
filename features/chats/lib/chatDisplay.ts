import type { Chat } from '../../../types';

export const getPreviewText = (chat: Chat, currentUserId: string, t: (key: string) => string) => {
  const last = chat.lastMessage || (chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null);
  if (!last) return { prefix: '', body: t('No messages yet') };

  const prefix = last.senderId === currentUserId ? t('You: ') : '';
  if (last.type === 'image') return { prefix, body: `${t('[Photo]')} ${last.text || ''}`.trim() };
  if (last.type === 'video') return { prefix, body: `${t('[Video]')} ${last.text || ''}`.trim() };
  if (last.type === 'audio') return { prefix, body: `${t('[Audio]')} ${last.text || ''}`.trim() };
  return { prefix, body: last.text || '' };
};
