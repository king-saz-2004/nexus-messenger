import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';

type VoiceMessagePlayerProps = {
  src: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  isOwn: boolean;
};

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

const formatSize = (bytes?: number) => {
  if (!bytes || bytes <= 0) {
    return '';
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildWave = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const bars: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const min = 4;
    const max = 17;
    bars.push(min + (hash % (max - min + 1)));
  }
  return bars;
};

export default function VoiceMessagePlayer({ src, mimeType, fileName, sizeBytes, isOwn }: VoiceMessagePlayerProps) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasError, setHasError] = useState(false);

  const bars = useMemo(() => buildWave(`${src}:${fileName || ''}`), [fileName, src]);
  const safeDuration = duration > 0 ? duration : 0;
  const progress = safeDuration > 0 ? clamp(currentTime / safeDuration, 0, 1) : 0;
  const progressPercent = clamp(Math.round(progress * 100), 0, 100);
  const sizeText = formatSize(sizeBytes);
  const currentLabel = formatDuration(currentTime);
  const totalLabel = formatDuration(safeDuration);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasError(false);

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      setHasError(true);
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, [src]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || hasError) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  };

  const onSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !safeDuration) {
      return;
    }
    const ratio = clamp(Number(event.target.value) / 100, 0, 1);
    const nextTime = safeDuration * ratio;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return (
    <div className="mb-1.5 w-[min(20rem,75vw)] max-w-full rounded-2xl border border-white/15 bg-black/10 px-2.5 py-2">
      <audio ref={audioRef} preload="metadata" src={src} />

      {hasError ? (
        <p dir="auto" className="bidi-text text-xs text-red-200">{t('Unable to play this voice message.')}</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlayback}
              className={`focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
                isOwn
                  ? 'bg-white/20 text-white hover:bg-white/30'
                  : 'bg-tg-accent text-white hover:bg-tg-accent-hover'
              }`}
              aria-label={isPlaying ? t('Pause voice message') : t('Play voice message')}
            >
              {isPlaying ? <Pause size={17} /> : <Play size={17} className="translate-x-[1px]" />}
            </button>

            <div className="min-w-0 flex-1">
              <div className="voice-wave-track">
                {bars.map((height, index) => (
                  <span
                    key={`${height}-${index}`}
                    className="voice-wave-bar"
                    style={{
                      height: `${height}px`,
                      opacity: index / bars.length <= progress ? 1 : 0.34
                    }}
                  />
                ))}
              </div>

              <div className="voice-progress-shell mt-1">
                <div className="voice-progress-rail" aria-hidden="true">
                  <span className="voice-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={progressPercent}
                  onChange={onSeek}
                  aria-label={t('Seek voice message')}
                  className="voice-progress-input"
                />
              </div>
            </div>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[11px] text-tg-text-outTime">
            <span>
              {currentLabel} / {totalLabel}
            </span>
            <span className="truncate pl-2">{sizeText || fileName || t('Voice message')}</span>
          </div>
        </>
      )}
    </div>
  );
}
