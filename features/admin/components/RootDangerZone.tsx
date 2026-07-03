import React from 'react';
import type { Dispatch, SetStateAction } from 'react';

type RootDangerZoneProps = {
  rootDeleteConfirmText: string;
  setRootDeleteConfirmText: Dispatch<SetStateAction<string>>;
  isDeletingAllMessages: boolean;
  isDeletingAllMedia: boolean;
  onDeleteAllMessages: () => Promise<void>;
  onDeleteAllMedia: () => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function RootDangerZone({
  rootDeleteConfirmText,
  setRootDeleteConfirmText,
  isDeletingAllMessages,
  isDeletingAllMedia,
  onDeleteAllMessages,
  onDeleteAllMedia,
  t
}: RootDangerZoneProps) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-2.5 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-rose-500">{t('Root Admin Danger Zone')}</span>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] leading-relaxed text-tg-text-secondary text-start">
          {t('To confirm any platform-wide delete operation, type DELETE in the field below.')}
        </p>
        <input
          value={rootDeleteConfirmText}
          onChange={event => setRootDeleteConfirmText(event.target.value)}
          className="focus-ring h-8 w-full rounded-lg border border-rose-500/40 bg-tg-bg-input-field px-2.5 text-xs text-tg-text-primary placeholder:text-tg-text-tertiary focus:border-rose-500 focus:outline-none"
          placeholder="DELETE"
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-2 border-t border-rose-500/20">
        <button
          type="button"
          disabled={isDeletingAllMessages || isDeletingAllMedia || rootDeleteConfirmText !== 'DELETE'}
          onClick={() => void onDeleteAllMessages()}
          className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 py-1.5 text-[10px] font-semibold text-tg-text-primary hover:bg-rose-500/20 disabled:opacity-50 disabled:hover:bg-rose-500/10"
        >
          {isDeletingAllMessages ? t('Deleting messages...') : t('Delete all messages')}
        </button>

        <button
          type="button"
          disabled={isDeletingAllMessages || isDeletingAllMedia || rootDeleteConfirmText !== 'DELETE'}
          onClick={() => void onDeleteAllMedia()}
          className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 py-1.5 text-[10px] font-semibold text-tg-text-primary hover:bg-rose-500/20 disabled:opacity-50 disabled:hover:bg-rose-500/10"
        >
          {isDeletingAllMedia ? t('Deleting media...') : t('Delete all media')}
        </button>
      </div>
    </div>
  );
}
