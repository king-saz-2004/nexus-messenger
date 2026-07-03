import type { Chat } from '../../../types';

export const isSameDay = (a: string, b: string) => {
  const left = new Date(a);
  const right = new Date(b);
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
};

export const formatDateDivider = (
  isoTime: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string
) => {
  const date = new Date(isoTime);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return t('Today');
  if (date.toDateString() === yesterday.toDateString()) return t('Yesterday');
  return formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const formatVoiceDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

export const typingStatus = (
  chat: Chat,
  currentUserId: string,
  t: (key: string, vars?: Record<string, string | number>) => string
) => {
  const typing = (chat.typingUsers || []).filter(userId => userId !== currentUserId);
  if (typing.length === 0) return '';
  if (chat.type === 'group' && typing.length > 1) return t('{count} people are typing...', { count: typing.length });
  return t('typing...');
};
