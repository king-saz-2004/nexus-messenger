import React from 'react';
import { Bookmark, Pin, Volume2, VolumeX } from 'lucide-react';
import type { Chat } from '../../../types';
import { getAvatarColor } from '../../../services/chatAdapter';

type ChatListItemProps = {
  chat: Chat;
  active: boolean;
  previewText: { prefix: string; body: string };
  lastTime: string;
  onChatSelect: (id: string) => void;
  onTogglePin: (chat: Chat) => Promise<void>;
  onToggleMute: (chat: Chat) => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
  localizeApiError: (error: unknown, fallbackKey?: string) => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function ChatListItem({
  chat,
  active,
  previewText,
  lastTime,
  onChatSelect,
  onTogglePin,
  onToggleMute,
  onNotify,
  localizeApiError,
  t
}: ChatListItemProps) {
  const isSaved = chat.type === 'saved';

  return (
    <button
      type="button"
      onClick={() => onChatSelect(chat.id)}
      className={`group focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${active ? 'bg-tg-selected' : 'hover:bg-tg-hover'
        }`}
    >
      <div
        className="relative h-11 w-11 shrink-0 rounded-full text-center text-sm font-semibold leading-[2.75rem] text-white"
        style={{ background: chat.avatarUrl ? undefined : getAvatarColor(chat.id) }}
      >
        {isSaved ? (
          <Bookmark size={18} className="mx-auto mt-3" />
        ) : chat.avatarUrl ? (
          <img src={chat.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          chat.name.slice(0, 2).toUpperCase()
        )}
        {!isSaved && chat.type === 'private' && chat.participants[0]?.isOnline ? (
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-tg-bg-sidebar bg-emerald-500" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-tg-text-primary text-start">
            {chat.name}
          </p>
          <span className="text-[11px] text-tg-text-secondary">{lastTime}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-tg-text-secondary text-start">
            {previewText.prefix ? <span className="bidi-isolate">{previewText.prefix}</span> : null}
            {previewText.body || t('No messages yet')}
          </p>
          {chat.unreadCount > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-tg-badge-bg px-1.5 py-0.5 text-[10px] font-semibold text-tg-badge-text">
              {chat.unreadCount}
            </span>
          ) : chat.isPinned ? (
            <Pin size={12} className="text-tg-text-tertiary" />
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            void onTogglePin(chat).catch(error => {
              onNotify(localizeApiError(error, 'Failed to update pin'), 'error');
            });
          }}
          className="focus-ring rounded-full p-1.5 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
          aria-label={chat.isPinned ? t('Unpin chat') : t('Pin chat')}
        >
          <Pin size={12} />
        </button>
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            void onToggleMute(chat).catch(error => {
              onNotify(localizeApiError(error, 'Failed to update mute'), 'error');
            });
          }}
          className="focus-ring rounded-full p-1.5 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
          aria-label={chat.isMuted ? t('Unmute chat') : t('Mute chat')}
        >
          {chat.isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </button>
      </div>
    </button>
  );
}
