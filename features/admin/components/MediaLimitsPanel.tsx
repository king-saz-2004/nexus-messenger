import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { MediaLimits } from '../../../types';

type MediaLimitsPanelProps = {
  localVoice: string;
  localAudio: string;
  localPhoto: string;
  localVideo: string;
  setLocalVoice: Dispatch<SetStateAction<string>>;
  setLocalAudio: Dispatch<SetStateAction<string>>;
  setLocalPhoto: Dispatch<SetStateAction<string>>;
  setLocalVideo: Dispatch<SetStateAction<string>>;
  isMediaLimitsSaving: boolean;
  onCommitMediaLimit: (type: keyof MediaLimits, value: string) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function MediaLimitsPanel({
  localVoice,
  localAudio,
  localPhoto,
  localVideo,
  setLocalVoice,
  setLocalAudio,
  setLocalPhoto,
  setLocalVideo,
  isMediaLimitsSaving,
  onCommitMediaLimit,
  t
}: MediaLimitsPanelProps) {
  return (
    <div className="rounded-xl bg-tg-bg-input-field/40 p-2.5 border border-tg-border/50 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-tg-text-primary">
          {t('Media size limits (GB)')}
        </span>
        {isMediaLimitsSaving ? (
          <span className="text-[9px] text-tg-text-secondary animate-pulse">{t('Saving...')}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        {[
          { key: 'voice' as const, label: t('Voice'), value: localVoice, setter: setLocalVoice },
          { key: 'audio' as const, label: t('Audio'), value: localAudio, setter: setLocalAudio },
          { key: 'photo' as const, label: t('Photo'), value: localPhoto, setter: setLocalPhoto },
          { key: 'video' as const, label: t('Video'), value: localVideo, setter: setLocalVideo }
        ].map(item => (
          <div key={item.key} className="flex flex-col gap-0.5">
            <span className="capitalize text-tg-text-secondary text-start">{item.label}</span>
            <input
              type="number"
              step="0.000001"
              min="0.000015"
              disabled={isMediaLimitsSaving}
              value={item.value}
              onChange={e => item.setter(e.target.value)}
              onBlur={() => void onCommitMediaLimit(item.key, item.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  void onCommitMediaLimit(item.key, item.value);
                }
              }}
              className="rounded border border-tg-border bg-tg-bg-input-field px-1.5 py-0.5 text-tg-text-primary text-[10px] focus:border-tg-accent focus:outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
