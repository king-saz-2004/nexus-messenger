import type { Dispatch, SetStateAction } from 'react';
import type { Message } from '../../../types';

type MessageSearchPanelProps = {
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  runMessageSearch: () => Promise<void>;
  isSearching: boolean;
  searchResults: Message[];
  jumpToMessage: (messageId: string) => void;
  setShowSearchPanel: Dispatch<SetStateAction<boolean>>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatDateTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
};

export default function MessageSearchPanel({
  searchQuery,
  setSearchQuery,
  runMessageSearch,
  isSearching,
  searchResults,
  jumpToMessage,
  setShowSearchPanel,
  t,
  formatDateTime
}: MessageSearchPanelProps) {
  return (
    <div className="border-b border-tg-border bg-tg-bg-header px-3 py-2 sm:px-4">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex gap-2">
          <input
            dir="auto"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runMessageSearch();
              }
            }}
            placeholder={t('Search messages in this chat')}
            className="focus-ring bidi-text h-10 min-w-0 flex-1 rounded-xl border border-tg-border bg-tg-bg-input-field px-3 text-sm text-tg-text-primary"
          />
          <button
            type="button"
            disabled={isSearching}
            onClick={() => void runMessageSearch()}
            className="focus-ring rounded-xl bg-tg-accent px-3 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
          >
            {isSearching ? t('Searching...') : t('Search')}
          </button>
        </div>

        {searchQuery.trim().length > 0 ? (
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-tg-border bg-tg-bg-input-field p-2">
            {searchResults.length === 0 ? (
              <p className="px-1 py-2 text-xs text-tg-text-secondary">
                {isSearching ? t('Searching...') : t('No matching messages')}
              </p>
            ) : (
              searchResults.map(result => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => {
                    jumpToMessage(result.id);
                    setShowSearchPanel(false);
                  }}
                  className="focus-ring w-full rounded-lg border border-transparent px-2 py-2 text-left hover:border-tg-border hover:bg-tg-hover"
                >
                  <p dir="auto" className="bidi-text line-clamp-1 text-xs text-tg-text-primary">
                    {result.text || `[${result.type}]`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-tg-text-secondary">
                    {formatDateTime(result.timestamp)}
                  </p>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
