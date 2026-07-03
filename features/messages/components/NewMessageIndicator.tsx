import type { Dispatch, RefObject, SetStateAction } from 'react';
import { ChevronDown } from 'lucide-react';

type NewMessageIndicatorProps = {
  showScrollBottom: boolean;
  showNewMessageIndicator: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  setShowNewMessageIndicator: Dispatch<SetStateAction<boolean>>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function NewMessageIndicator({
  showScrollBottom,
  showNewMessageIndicator,
  messagesEndRef,
  setShowNewMessageIndicator,
  t
}: NewMessageIndicatorProps) {
  if (!showScrollBottom) return null;

  return (
    <button
      type="button"
      onClick={() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShowNewMessageIndicator(false);
      }}
      className="focus-ring absolute bottom-24 right-4 z-20 rounded-full border border-tg-border bg-tg-bg-surface p-2 text-tg-text-secondary shadow-lg hover:bg-tg-hover"
      aria-label={t('Scroll to latest')}
    >
      <ChevronDown size={18} />
      {showNewMessageIndicator ? (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-tg-accent" />
      ) : null}
    </button>
  );
}
