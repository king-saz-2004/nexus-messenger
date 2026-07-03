import React from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Contact, User } from '../../../types';
import { getAvatarColor } from '../../../services/chatAdapter';

type UserLookupPanelProps = {
  lookupUserid: string;
  setLookupUserid: Dispatch<SetStateAction<string>>;
  lookupResult: User | null;
  setLookupResult: Dispatch<SetStateAction<User | null>>;
  lookupContact?: Contact;
  lookupBusy: boolean;
  isBusy: boolean;
  lookupUser: () => Promise<void>;
  startChat: (userId: string) => Promise<void>;
  renderContactActions: (user: User, contact?: Contact) => ReactNode;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function UserLookupPanel({
  lookupUserid,
  setLookupUserid,
  lookupResult,
  setLookupResult,
  lookupContact,
  lookupBusy,
  isBusy,
  lookupUser,
  startChat,
  renderContactActions,
  t
}: UserLookupPanelProps) {
  return (
    <section className="rounded-xl border border-tg-border bg-tg-bg-input-field p-2">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tg-text-secondary">
        {t('Find by userid')}
      </p>
      <div className="flex gap-2">
        <input
          value={lookupUserid}
          onChange={event => {
            setLookupUserid(event.target.value);
            setLookupResult(null);
          }}
          placeholder="@username"
          className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-tg-border bg-tg-bg-surface px-2 text-xs text-tg-text-primary"
        />
        <button
          type="button"
          onClick={() => void lookupUser()}
          disabled={lookupBusy}
          className="focus-ring rounded-lg bg-tg-accent px-3 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
        >
          {lookupBusy ? '...' : t('Find')}
        </button>
      </div>

      {lookupResult ? (
        <div className="mt-2 rounded-lg border border-tg-border bg-tg-bg-surface">
          <button
            type="button"
            onClick={() => void startChat(lookupResult.id)}
            disabled={isBusy}
            className="focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left disabled:opacity-60"
          >
            <div
              className="relative h-10 w-10 shrink-0 rounded-full text-center text-xs font-semibold leading-10 text-white"
              style={{ background: lookupResult.avatar ? undefined : (lookupResult.avatarColor || getAvatarColor(lookupResult.id)) }}
            >
              {lookupResult.avatar ? (
                <img src={lookupResult.avatar} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                lookupResult.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-tg-text-primary">
                {lookupContact?.customName || lookupResult.name}
              </p>
              <p className="text-start truncate text-xs text-tg-text-secondary"><span dir="ltr">@{lookupResult.username}</span></p>
            </div>
          </button>
          {renderContactActions(lookupResult, lookupContact)}
        </div>
      ) : null}
    </section>
  );
}
