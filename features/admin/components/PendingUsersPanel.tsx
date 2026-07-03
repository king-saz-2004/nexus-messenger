import React from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { User } from '../../../types';

type PendingUsersPanelProps = {
  pendingUsers: User[];
  pendingActionUserId: string | null;
  adminLoadError: string | null;
  onApproveUser: (userId: string) => Promise<void>;
  onRejectUser: (userId: string) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function PendingUsersPanel({
  pendingUsers,
  pendingActionUserId,
  adminLoadError,
  onApproveUser,
  onRejectUser,
  t
}: PendingUsersPanelProps) {
  return (
    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-tg-text-secondary">{t('Pending Approvals')}</span>
      </div>

      {adminLoadError ? (
        <p className="text-[10px] text-rose-400 text-center py-1.5">
          {adminLoadError}
        </p>
      ) : pendingUsers.length === 0 ? (
        <p className="text-[11px] text-tg-text-secondary text-center py-1.5">
          {t('No pending users.')}
        </p>
      ) : (
        pendingUsers.map(u => (
          <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg bg-tg-bg-input-field/50 p-2 border border-tg-border/30">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-tg-text-primary">{u.name}</p>
              <p className="text-start truncate text-[10px] text-tg-text-secondary"><span dir="ltr">@{u.username}</span></p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={pendingActionUserId !== null}
                onClick={() => void onApproveUser(u.id)}
                className="rounded-md bg-emerald-500/20 p-1 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50"
                title={t('Approve')}
              >
                {pendingActionUserId === u.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
              </button>
              <button
                type="button"
                disabled={pendingActionUserId !== null}
                onClick={() => void onRejectUser(u.id)}
                className="rounded-md bg-rose-500/20 p-1 text-rose-400 hover:bg-rose-500/30 disabled:opacity-50"
                title={t('Reject')}
              >
                {pendingActionUserId === u.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <XCircle size={13} />
                )}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
