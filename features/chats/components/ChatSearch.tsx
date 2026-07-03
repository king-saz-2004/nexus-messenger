import React from 'react';
import { Search, X } from 'lucide-react';

type ChatSearchProps = {
  activeTab: 'chats' | 'contacts';
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function ChatSearch({ activeTab, searchTerm, setSearchTerm, t }: ChatSearchProps) {
  return (
    <div className="px-3 py-3 shrink-0">
      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tg-text-tertiary" />
        <input
          type="search"
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
          placeholder={activeTab === 'chats' ? t('Search chats') : t('Search contacts')}
          className="focus-ring h-10 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-9 pr-9 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary"
        />
        {searchTerm ? (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-tg-text-tertiary hover:bg-tg-hover hover:text-tg-text-primary"
            aria-label={t('Clear search')}
          >
            <X size={14} />
          </button>
        ) : null}
      </label>
    </div>
  );
}
