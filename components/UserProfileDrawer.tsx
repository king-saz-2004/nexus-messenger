import React, { useState } from 'react';
import { Ban, CheckCircle2, UserMinus, UserPlus, X } from 'lucide-react';
import { Contact, User } from '../types';
import { useI18n } from '../hooks/useI18n';
import { getAvatarColor } from '../services/chatAdapter';

type UserProfileDrawerProps = {
  open: boolean;
  user: User | null;
  contact?: Contact;
  isLoading: boolean;
  onClose: () => void;
  onAddContact: (userId: string) => Promise<void>;
  onRemoveContact: (userId: string) => Promise<void>;
  onBlockContact: (userId: string) => Promise<void>;
  onUnblockContact: (userId: string) => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
};

const formatStatus = (
  user: User,
  t: (key: string, vars?: Record<string, string | number>) => string,
  formatLastSeen: (value: string | number | Date | null | undefined) => string
) => {
  if (user.isOnline) {
    return t('online');
  }
  return formatLastSeen(user.lastSeenAt);
};

export default function UserProfileDrawer({
  open,
  user,
  contact,
  isLoading,
  onClose,
  onAddContact,
  onRemoveContact,
  onBlockContact,
  onUnblockContact,
  onNotify
}: UserProfileDrawerProps) {
  const { t, localizeApiError, formatDateTime, formatLastSeen } = useI18n();
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const runAction = async (key: string, action: () => Promise<void>, successMessage: string) => {
    if (!user) {
      return;
    }
    setPendingAction(key);
    try {
      await action();
      onNotify(successMessage, 'success');
    } catch (error) {
      onNotify(localizeApiError(error, 'Action failed'), 'error');
    } finally {
      setPendingAction(null);
    }
  };

  const isBusy = pendingAction !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-sm border-l border-tg-border bg-tg-bg-modal"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-tg-border px-4 py-3">
            <div>
              <h2 className="text-start text-base font-semibold text-tg-text-primary">{t('Profile')}</h2>
              <p className="text-start text-xs text-tg-text-secondary">{t('Private chat user')}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring rounded-lg p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
              aria-label={t('Close profile drawer')}
            >
              <X size={16} />
            </button>
          </header>

          <div className="message-scroll flex-1 space-y-4 overflow-y-auto p-4">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(row => (
                  <div key={row} className="h-16 animate-pulse rounded-xl bg-white/10" />
                ))}
              </div>
            ) : user ? (
              <>
                <section className="rounded-2xl border border-tg-border bg-tg-bg-input-field p-4">
                  <div className="flex items-center gap-3">
                    {user.avatar ? (
                      <img src={user.avatar} alt={`${user.name} avatar`} className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div
                        className="h-14 w-14 rounded-full text-center text-sm font-semibold leading-[3.5rem] text-white"
                        style={{ background: user.avatarColor || getAvatarColor(user.id) }}
                      >
                        {user.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-start truncate text-base font-semibold text-tg-text-primary">{contact?.customName || user.name}</p>
                      <p className="truncate text-sm text-tg-text-secondary text-start"><span dir="ltr">@{user.username}</span></p>
                      <p className="text-start mt-1 truncate text-xs text-tg-text-secondary">
                        {formatStatus(user, t, formatLastSeen)}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-tg-border bg-tg-bg-input-field p-4">
                  <p className="text-start mb-3 text-xs font-semibold uppercase tracking-wide text-tg-text-secondary">{t('Contact actions')}</p>
                  <div className="flex flex-wrap gap-2">
                    {contact ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void runAction('remove', () => onRemoveContact(user.id), t('Contact removed'))
                        }
                        className="focus-ring inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-tg-text-primary hover:bg-rose-500/25 disabled:opacity-60"
                      >
                        <UserMinus size={13} />
                        {t('Remove contact')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void runAction('add', () => onAddContact(user.id), t('Contact added'))
                        }
                        className="focus-ring inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs text-tg-text-primary hover:bg-emerald-500/25 disabled:opacity-60"
                      >
                        <UserPlus size={13} />
                        {t('Add contact')}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        const isBlocked = contact?.isBlocked ?? false;
                        void runAction(
                          isBlocked ? 'unblock' : 'block',
                          () => (isBlocked ? onUnblockContact(user.id) : onBlockContact(user.id)),
                          isBlocked ? t('Contact unblocked') : t('Contact blocked')
                        );
                      }}
                      className="focus-ring inline-flex items-center gap-1 rounded-lg border border-orange-500/40 bg-orange-500/15 px-3 py-2 text-xs text-tg-text-primary hover:bg-orange-500/25 disabled:opacity-60"
                    >
                      <Ban size={13} />
                      {contact?.isBlocked ? t('Unblock') : t('Block')}
                    </button>
                  </div>
                  {contact ? (
                    <div className="mt-3 text-xs text-tg-text-secondary">
                      {contact ? (
                        <p className="text-start inline-flex items-center gap-1">
                          <CheckCircle2 size={12} />
                          {t('In your contacts')}
                        </p>
                      ) : null}
                      {contact?.isBlocked ? (
                        <p className="text-start mt-1 text-rose-600">
                          {t('This contact is currently blocked.')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-tg-border bg-tg-bg-input-field px-3 py-6 text-center text-sm text-tg-text-secondary">
                {t('User profile is unavailable.')}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
