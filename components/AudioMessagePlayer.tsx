import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Music } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';

type AudioMessagePlayerProps = {
  src: string;
  blob?: Blob;
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

type AudioMetadata = {
  title?: string;
  artist?: string;
  coverUrl?: string;
};

function decodeId3Text(view: DataView, offset: number, size: number): string {
  if (size <= 1) return '';
  const encoding = view.getUint8(offset);
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 1, size - 1);
  
  let label = 'utf-8';
  if (encoding === 0) label = 'iso-8859-1';
  else if (encoding === 1) label = 'utf-16';
  else if (encoding === 2) label = 'utf-16be';
  else if (encoding === 3) label = 'utf-8';

  try {
    const decoder = new TextDecoder(label);
    let text = decoder.decode(bytes).trim();
    text = text.replace(/\0+$/, '');
    return text;
  } catch {
    return '';
  }
}

function parseId3Metadata(arrayBuffer: ArrayBuffer): AudioMetadata {
  const view = new DataView(arrayBuffer);
  const metadata: AudioMetadata = {};
  if (view.byteLength < 10) return metadata;
  
  // ID3 header check
  if (
    view.getUint8(0) !== 0x49 || // 'I'
    view.getUint8(1) !== 0x44 || // 'D'
    view.getUint8(2) !== 0x33    // '3'
  ) {
    return metadata;
  }

  const getSynchsafeSize = (offset: number) => {
    const b1 = view.getUint8(offset);
    const b2 = view.getUint8(offset + 1);
    const b3 = view.getUint8(offset + 2);
    const b4 = view.getUint8(offset + 3);
    return (b1 << 21) | (b2 << 14) | (b3 << 7) | b4;
  };

  const id3Size = getSynchsafeSize(6);
  const totalHeaderSize = 10 + id3Size;

  let offset = 10;
  while (offset < totalHeaderSize && offset + 10 < view.byteLength) {
    const frameId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

    const frameSize = view.getUint32(offset + 4);
    if (frameSize <= 0 || offset + 10 + frameSize > view.byteLength) {
      break;
    }

    if (frameId === 'TIT2') {
      metadata.title = decodeId3Text(view, offset + 10, frameSize);
    } else if (frameId === 'TPE1') {
      metadata.artist = decodeId3Text(view, offset + 10, frameSize);
    } else if (frameId === 'APIC') {
      const dataStart = offset + 10;
      const dataEnd = dataStart + frameSize;

      let p = dataStart;
      const encoding = view.getUint8(p);
      p += 1;

      // Read MIME type
      let mimeType = '';
      while (p < dataEnd && view.getUint8(p) !== 0x00) {
        mimeType += String.fromCharCode(view.getUint8(p));
        p += 1;
      }
      p += 1; // skip null

      // Picture type
      p += 1;

      // Skip description
      if (encoding === 1 || encoding === 2) {
        while (p + 1 < dataEnd && !(view.getUint8(p) === 0x00 && view.getUint8(p + 1) === 0x00)) {
          p += 2;
        }
        p += 2;
      } else {
        while (p < dataEnd && view.getUint8(p) !== 0x00) {
          p += 1;
        }
        p += 1;
      }

      if (p < dataEnd) {
        const imgBytes = new Uint8Array(arrayBuffer.slice(p, dataEnd));
        let type = mimeType || 'image/jpeg';
        if (imgBytes.length >= 8 && imgBytes[0] === 0x89 && imgBytes[1] === 0x50 && imgBytes[2] === 0x4E && imgBytes[3] === 0x47) {
          type = 'image/png';
        }
        const blob = new Blob([imgBytes], { type });
        metadata.coverUrl = URL.createObjectURL(blob);
      }
    }

    offset += 10 + frameSize;
  }

  return metadata;
}

function parseMp4Metadata(arrayBuffer: ArrayBuffer): AudioMetadata {
  const view = new DataView(arrayBuffer);
  const length = view.byteLength;
  const metadata: AudioMetadata = {};

  const readType = (pos: number) => {
    if (pos + 4 > length) return '';
    return String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
  };

  const findBox = (start: number, end: number, path: string[]): { start: number; end: number } | null => {
    if (path.length === 0) {
      return { start, end };
    }
    const targetType = path[0];
    const remainingPath = path.slice(1);

    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      const type = readType(pos + 4);

      if (size === 1 && pos + 16 <= end) {
        const high = view.getUint32(pos + 8);
        const low = view.getUint32(pos + 12);
        size = low;
        if (high !== 0) {
          pos += 16;
          continue;
        }
      } else if (size === 0) {
        size = end - pos;
      }

      if (size < 8 || pos + size > end) {
        break;
      }

      if (type === targetType) {
        let contentStart = pos + 8;
        if (view.getUint32(pos) === 1) contentStart += 8;

        if (type === 'meta') {
          contentStart += 4;
        }

        const contentEnd = pos + size;
        if (contentStart <= contentEnd) {
          return findBox(contentStart, contentEnd, remainingPath);
        }
      }

      pos += size;
    }
    return null;
  };

  const ilstInfo = findBox(0, length, ['moov', 'udta', 'meta', 'ilst']);
  if (!ilstInfo) return metadata;

  const { start: ilstStart, end: ilstEnd } = ilstInfo;

  let pos = ilstStart;
  while (pos + 8 <= ilstEnd) {
    const size = view.getUint32(pos);
    const type = readType(pos + 4);

    if (size < 8 || pos + size > ilstEnd) {
      break;
    }

    const contentStart = pos + 8;
    const contentEnd = pos + size;

    const dataInfo = findBox(contentStart, contentEnd, ['data']);
    if (dataInfo) {
      const { start: dataStart, end: dataEnd } = dataInfo;
      if (dataStart + 8 <= dataEnd) {
        const payloadBytes = new Uint8Array(arrayBuffer.slice(dataStart + 8, dataEnd));
        
        if (type === '\xa9nam' || type === '©nam') {
          try {
            metadata.title = new TextDecoder('utf-8').decode(payloadBytes).trim();
          } catch {}
        } else if (type === '\xa9ART' || type === '©ART') {
          try {
            metadata.artist = new TextDecoder('utf-8').decode(payloadBytes).trim();
          } catch {}
        } else if (type === 'covr') {
          let mimeType = 'image/jpeg';
          if (payloadBytes.length >= 8 &&
              payloadBytes[0] === 0x89 && payloadBytes[1] === 0x50 && payloadBytes[2] === 0x4E && payloadBytes[3] === 0x47) {
            mimeType = 'image/png';
          }
          const blob = new Blob([payloadBytes], { type: mimeType });
          metadata.coverUrl = URL.createObjectURL(blob);
        }
      }
    }

    pos += size;
  }

  return metadata;
}

export default function AudioMessagePlayer({ src, blob, mimeType, fileName, sizeBytes, isOwn }: AudioMessagePlayerProps) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [parsedTitle, setParsedTitle] = useState<string | null>(null);
  const [parsedArtist, setParsedArtist] = useState<string | null>(null);

  const safeDuration = duration > 0 ? duration : 0;
  const progress = safeDuration > 0 ? clamp(currentTime / safeDuration, 0, 1) : 0;
  const progressPercent = clamp(Math.round(progress * 100), 0, 100);
  const sizeText = formatSize(sizeBytes);
  const currentLabel = formatDuration(currentTime);
  const totalLabel = formatDuration(safeDuration);

  // Resolve title and artist with fallbacks
  const { title, artist } = React.useMemo(() => {
    const finalTitle = parsedTitle || (fileName ? fileName.replace(/\.[a-zA-Z0-9]+$/, '') : t('Audio File'));
    let finalArtist = parsedArtist;
    
    if (!finalArtist && fileName) {
      const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
      if (baseName.includes(' - ')) {
        const parts = baseName.split(' - ');
        finalArtist = parts[0].trim();
      }
    }
    
    let displayTitle = finalTitle;
    if (!parsedTitle && fileName && fileName.includes(' - ')) {
      const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
      const parts = baseName.split(' - ');
      displayTitle = parts.slice(1).join(' - ').trim();
    }

    return {
      title: displayTitle,
      artist: finalArtist
    };
  }, [fileName, parsedTitle, parsedArtist, t]);

  useEffect(() => {
    let isCancelled = false;
    let localUrl: string | null = null;

    if (blob) {
      void blob.arrayBuffer()
        .then(buf => {
          if (isCancelled) return;
          
          let meta = parseId3Metadata(buf);
          if (!meta.title && !meta.artist && !meta.coverUrl) {
            meta = parseMp4Metadata(buf);
          }

          if (meta.coverUrl) {
            localUrl = meta.coverUrl;
            setCoverUrl(meta.coverUrl);
          }
          if (meta.title) {
            setParsedTitle(meta.title);
          }
          if (meta.artist) {
            setParsedArtist(meta.artist);
          }
        })
        .catch(() => {});
    }

    return () => {
      isCancelled = true;
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [blob]);

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
    <div className="mb-1 w-[min(22rem,75vw)] max-w-full py-1 px-0.5">
      <audio ref={audioRef} preload="metadata" src={src} />

      {hasError ? (
        <p dir="auto" className="bidi-text text-xs text-red-200 text-start">{t('Unable to play this audio file.')}</p>
      ) : (
        <div className="flex items-center gap-3">
          {/* Cover Art / Play Button Container */}
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-black/15 flex items-center justify-center border border-white/12 group">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <Music className="text-tg-text-secondary" size={20} />
            )}

            {/* Play/Pause Button centered overlay */}
            <button
              type="button"
              onClick={togglePlayback}
              className={`absolute h-8 w-8 rounded-full bg-white text-black shadow-md flex items-center justify-center hover:scale-105 active:scale-95 transition ${
                coverUrl ? 'opacity-85 group-hover:opacity-100' : 'opacity-100'
              }`}
              aria-label={isPlaying ? t('Pause song') : t('Play song')}
            >
              {isPlaying ? (
                <Pause size={14} className="text-tg-accent fill-tg-accent" />
              ) : (
                <Play size={14} className="text-tg-accent fill-tg-accent translate-x-[1px]" />
              )}
            </button>
          </div>

          {/* Song Details & Seekbar */}
          <div className="min-w-0 flex-1 flex flex-col justify-between">
            <div className="text-start">
              <p dir="auto" className="bidi-text text-sm font-semibold text-tg-text-primary truncate mb-0.5 leading-snug">
                {title}
              </p>
              {artist ? (
                <p dir="auto" className="bidi-text text-[11px] text-tg-text-secondary truncate leading-tight mb-1">
                  {artist}
                </p>
              ) : null}
            </div>

            {/* Slider track */}
            <div className="voice-progress-shell mt-0.5">
              <div className="voice-progress-rail" aria-hidden="true">
                <span className="voice-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={progressPercent}
                onChange={onSeek}
                aria-label={t('Seek audio')}
                className="voice-progress-input"
              />
            </div>

            {/* Timestamps & File Size */}
            <div className="mt-1 flex items-center justify-between text-[10px] text-tg-text-outTime">
              <span>
                {currentLabel} / {totalLabel}
              </span>
              {sizeText ? <span className="truncate pl-2">{sizeText}</span> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
