import type { Dispatch, SetStateAction } from 'react';
import { Pin } from 'lucide-react';
import type { Message } from '../../../types';

type PinnedMessagesBarProps = {
  pinnedMessages: Message[];
  pinnedBarIndex: number;
  setPinnedBarIndex: Dispatch<SetStateAction<number>>;
  jumpToMessage: (messageId: string) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function PinnedMessagesBar({
  pinnedMessages,
  pinnedBarIndex,
  setPinnedBarIndex,
  jumpToMessage,
  t
}: PinnedMessagesBarProps) {
  if (pinnedMessages.length === 0) return null;

  const goToCurrentPinnedMessage = () => {
    const msg = pinnedMessages[pinnedBarIndex % pinnedMessages.length];
    if (msg) jumpToMessage(msg.id);
    setPinnedBarIndex(prev => (prev + 1) % pinnedMessages.length);
  };

  const currentPinnedMessage = pinnedMessages[pinnedBarIndex % pinnedMessages.length];

  return (
    <div
      className="flex cursor-pointer items-center gap-3 border-b border-tg-border bg-tg-bg-header px-3 py-2 transition hover:bg-tg-hover sm:px-4"
      onClick={goToCurrentPinnedMessage}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          goToCurrentPinnedMessage();
        }
      }}
      aria-label={t('Go to pinned message')}
    >
      <Pin size={14} className="shrink-0 text-tg-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-tg-accent">
          {pinnedMessages.length === 1
            ? t('Pinned message')
            : t('{count} pinned messages', { count: pinnedMessages.length })}
        </p>
        <p dir="auto" className="bidi-text truncate text-xs text-tg-text-secondary">
          {currentPinnedMessage?.text || `[${currentPinnedMessage?.type ?? 'media'}]`}
        </p>
      </div>
    </div>
  );
}
