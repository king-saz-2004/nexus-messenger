import React from 'react';
import type { Chat } from '../../../types';
import { getPreviewText } from '../lib/chatDisplay';
import ChatListItem from './ChatListItem';

type ChatListProps = {
  chats: Chat[];
  activeChatId: string | null;
  currentUserId: string;
  chatDisplayTimeById: Map<string, string>;
  isInitialLoadingChats?: boolean;
  isRefreshingChats?: boolean;
  onChatSelect: (id: string) => void;
  onTogglePin: (chat: Chat) => Promise<void>;
  onToggleMute: (chat: Chat) => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
  localizeApiError: (error: unknown, fallbackKey?: string) => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function ChatList({
  chats,
  activeChatId,
  currentUserId,
  chatDisplayTimeById,
  isInitialLoadingChats,
  isRefreshingChats,
  onChatSelect,
  onTogglePin,
  onToggleMute,
  onNotify,
  localizeApiError,
  t
}: ChatListProps) {
  if (isInitialLoadingChats && chats.length === 0) {
    return (
      <div className="space-y-2 px-1">
        {[1, 2, 3, 4].map(row => (
          <div key={row} className="h-16 animate-pulse rounded-xl bg-tg-bg-input-field" />
        ))}
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-tg-border bg-tg-bg-input-field px-3 py-8 text-center text-sm text-tg-text-secondary">
        {t('No chats yet.')}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {isRefreshingChats ? (
        <div className="mb-2 overflow-hidden rounded-full bg-tg-bg-input-field">
          <div className="h-1 w-1/3 animate-pulse rounded-full bg-tg-accent" />
        </div>
      ) : null}

      {chats.map(chat => {
        const active = chat.id === activeChatId;
        const previewText = getPreviewText(chat, currentUserId, t);
        const lastTime = chatDisplayTimeById.get(chat.id) || '';

        return (
          <React.Fragment key={chat.id}>
            <ChatListItem
              chat={chat}
              active={active}
              previewText={previewText}
              lastTime={lastTime}
              onChatSelect={onChatSelect}
              onTogglePin={onTogglePin}
              onToggleMute={onToggleMute}
              onNotify={onNotify}
              localizeApiError={localizeApiError}
              t={t}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}
