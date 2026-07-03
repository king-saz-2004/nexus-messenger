import React from 'react';
import type { ReactNode } from 'react';
import type { Contact, User } from '../../../types';
import { getAvatarColor } from '../../../services/chatAdapter';

type ContactListItemProps = {
  user: User;
  contact?: Contact;
  isBusy: boolean;
  showContactBadges?: boolean;
  showOnlineIndicator?: boolean;
  onStartChat: (userId: string) => Promise<void>;
  renderContactActions: (user: User, contact?: Contact) => ReactNode;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function ContactListItem({
  user,
  contact,
  isBusy,
  showContactBadges,
  showOnlineIndicator,
  onStartChat,
  renderContactActions,
  t
}: ContactListItemProps) {
  return (
    <div className="rounded-xl border border-transparent hover:border-tg-border hover:bg-tg-hover/40">
      <button
        type="button"
        onClick={() => void onStartChat(user.id)}
        disabled={isBusy}
        className="focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div
          className="relative h-11 w-11 shrink-0 rounded-full text-center text-sm font-semibold leading-[2.75rem] text-white"
          style={{ background: user.avatar ? undefined : (user.avatarColor || getAvatarColor(user.id)) }}
        >
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            user.name.slice(0, 2).toUpperCase()
          )}
          {showOnlineIndicator ? (
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border border-tg-bg-sidebar ${user.isOnline ? 'bg-emerald-500' : 'bg-slate-500'
                }`}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-tg-text-primary">{contact?.customName || user.name}</p>
          <p className="text-start truncate text-xs text-tg-text-secondary"><span dir="ltr">@{user.username}</span></p>
          {showContactBadges ? (
            <div className="mt-1 flex flex-wrap gap-1">
              <span className="rounded-full bg-tg-bg-input-field px-1.5 py-0.5 text-[10px] text-tg-text-secondary">
                {t('Contact')}
              </span>
              {contact?.isFavorite ? (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-tg-text-primary">
                  {t('Favorite')}
                </span>
              ) : null}
              {contact?.isBlocked ? (
                <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-tg-text-primary">
                  {t('Blocked')}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
      {renderContactActions(user, contact)}
    </div>
  );
}
