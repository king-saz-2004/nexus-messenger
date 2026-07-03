import React, { useEffect, useState } from 'react';
import { Laptop, LogOut, ShieldOff, Smartphone, X } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';

type SessionDto = {
  id: string;
  deviceName?: string;
  deviceType?: string;
  ipAddress?: string;
  userAgent?: string;
  isActive: boolean;
  lastActivity: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

type SessionsDrawerProps = {
  open: boolean;
  onClose: () => void;
  onListSessions: (cursor?: string, limit?: number) => Promise<{
    sessions: SessionDto[];
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  }>;
  onTerminateSession: (sessionId: string) => Promise<void>;
  onLogoutCurrentSession: () => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
};

const deviceIcon = (type?: string) => {
  if (type === 'mobile') return <Smartphone size={13} />;
  return <Laptop size={13} />;
};

export default function SessionsDrawer({
  open,
  onClose,
  onListSessions,
  onTerminateSession,
  onLogoutCurrentSession,
  onNotify
}: SessionsDrawerProps) {
  const { t, localizeApiError, formatDateTime } = useI18n();
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  const loadSessions = async (cursor?: string) => {
    const response = await onListSessions(cursor, 20);
    setSessions(prev => (cursor ? [...prev, ...response.sessions] : response.sessions));
    setNextCursor(response.nextCursor);
    setHasMore(response.hasMore);
  };

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    void loadSessions()
      .catch(error => {
        onNotify(localizeApiError(error, 'Failed to load sessions'), 'error');
      })
      .finally(() => setIsLoading(false));
  }, [open, localizeApiError, onNotify, onListSessions]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-md border-l border-tg-border bg-tg-bg-modal"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-tg-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-tg-text-primary">{t('Active sessions')}</h2>
              <p className="text-xs text-tg-text-secondary">{t('Terminate old or unknown sessions')}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring rounded-lg p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
              aria-label={t('Close sessions drawer')}
            >
              <X size={16} />
            </button>
          </header>

          <div className="message-scroll flex-1 space-y-2 overflow-y-auto p-4">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(row => (
                  <div key={row} className="h-16 animate-pulse rounded-xl bg-white/10" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-tg-border bg-tg-bg-input-field px-3 py-6 text-center text-sm text-tg-text-secondary">
                {t('No active sessions found.')}
              </div>
            ) : (
              sessions.map(session => (
                <article key={session.id} className="rounded-xl border border-tg-border bg-tg-bg-input-field p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="inline-flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-tg-text-primary">
                      {deviceIcon(session.deviceType)}
                      {session.deviceName || session.deviceType || t('Unknown device')}
                    </p>
                    {session.isCurrent ? (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-tg-text-primary">
                        {t('Current')}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-1 text-xs text-tg-text-secondary">
                    <p>{t('IP: {ip}', { ip: session.ipAddress || '-' })}</p>
                    <p>{t('Last activity: {time}', { time: formatDateTime(session.lastActivity) })}</p>
                  </div>

                  <button
                    type="button"
                    disabled={pendingSessionId !== null}
                    onClick={() => {
                      setPendingSessionId(session.id);
                      void onTerminateSession(session.id)
                        .then(async () => {
                          if (session.isCurrent) {
                            await onLogoutCurrentSession();
                            return;
                          }
                          setSessions(prev => prev.filter(item => item.id !== session.id));
                          onNotify(t('Session terminated'), 'success');
                        })
                        .catch(error => {
                          onNotify(localizeApiError(error, 'Failed to terminate session'), 'error');
                        })
                        .finally(() => setPendingSessionId(null));
                    }}
                    className="focus-ring mt-2 inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] text-tg-text-primary hover:bg-rose-500/25 disabled:opacity-60"
                  >
                    {session.isCurrent ? <LogOut size={12} /> : <ShieldOff size={12} />}
                    {pendingSessionId === session.id
                      ? t('Terminating...')
                      : session.isCurrent
                        ? t('Logout this session')
                        : t('Terminate session')}
                  </button>
                </article>
              ))
            )}
          </div>

          {hasMore && nextCursor ? (
            <div className="border-t border-tg-border p-3">
              <button
                type="button"
                disabled={isLoading || pendingSessionId !== null}
                onClick={() => {
                  setIsLoading(true);
                  void loadSessions(nextCursor)
                    .catch(error => {
                      onNotify(localizeApiError(error, 'Failed to load more sessions'), 'error');
                    })
                    .finally(() => setIsLoading(false));
                }}
                className="focus-ring w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-3 py-2 text-xs text-tg-text-primary hover:bg-tg-hover disabled:opacity-60"
              >
                {t('Load more sessions')}
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
