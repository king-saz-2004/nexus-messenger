import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, Loader2, Pin } from 'lucide-react';
import { Message, LinkPreviewData } from '../types';
import { useI18n } from '../hooks/useI18n';
import { useAuthenticatedMedia } from '../hooks/useAuthenticatedMedia';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import AudioMessagePlayer from './AudioMessagePlayer';
import { apiClient } from '../services/apiClient';

type MessageContextAnchor = {
  x: number;
  y: number;
  isOwn: boolean;
};

const formatSize = (bytes?: number) => {
  if (!bytes || bytes <= 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

type MessageBubbleProps = {
  message: Message;
  isOwn: boolean;
  isGroup: boolean;
  showAvatar?: boolean;
  senderName?: string;
  senderAvatar?: string;
  avatarColor?: string;
  replySenderName?: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onJumpToRepliedMessage: (messageId: string) => void;
  onOpenContextMenu: (message: Message, anchor: MessageContextAnchor) => void;
};

export default function MessageBubble({
  message,
  isOwn,
  isGroup,
  showAvatar,
  senderName,
  senderAvatar,
  avatarColor,
  replySenderName,
  onToggleReaction,
  onJumpToRepliedMessage,
  onOpenContextMenu
}: MessageBubbleProps) {
  const { t, formatTime } = useI18n();
  const longPressTimerRef = useRef<number | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const canRenderAvatar = Boolean(senderAvatar && !avatarFailed);
  const {
    url: resolvedMediaUrl,
    blob: resolvedMediaBlob,
    isLoading: isMediaLoading,
    downloadProgress: mediaDownloadProgress,
    error: mediaError,
    reload: reloadMedia
  } = useAuthenticatedMedia(message.mediaUrl);

  useEffect(() => {
    setAvatarFailed(false);
  }, [senderAvatar]);

  const openContextMenuNearMessage = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const anchorY = rect.top + Math.max(16, Math.min(rect.height - 16, rect.height / 2));
    const anchorX = isOwn ? rect.left : rect.right;
    onOpenContextMenu(message, { x: anchorX, y: anchorY, isOwn });
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) return;
    longPressTimerRef.current = window.setTimeout(() => {
      openContextMenuNearMessage(event.currentTarget);
      clearLongPress();
    }, 450);
  };

  const mediaNode = (() => {
    if (!message.mediaUrl) return null;

    if (isMediaLoading) {
      const displayName = message.mediaName || (
        message.type === 'image' ? t('Photo') : message.type === 'video' ? t('Video') : t('Audio')
      );
      const sizeText = message.mediaSizeBytes ? formatSize(message.mediaSizeBytes) : '';
      return (
        <div className="mb-1.5 w-[min(20rem,75vw)] max-w-full rounded-2xl border border-white/15 bg-black/10 p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-tg-text-secondary text-xs">
            <Loader2 className="animate-spin text-tg-accent" size={16} />
            <span className="truncate flex-1 font-semibold">{t('Downloading...')}</span>
            {sizeText ? <span>{sizeText}</span> : null}
          </div>
          <p className="text-[11px] text-tg-text-secondary truncate">{displayName}</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/20 mt-1">
            <div className="h-full bg-tg-accent transition-all duration-200" style={{ width: `${mediaDownloadProgress}%` }} />
          </div>
        </div>
      );
    }

    if (mediaError || !resolvedMediaUrl) {
      return (
        <div className="mb-1.5 rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          <p>{mediaError || t('Unable to load media')}</p>
          <button
            type="button"
            className="mt-2 rounded-lg border border-red-300/40 px-2 py-1 text-[11px] hover:bg-red-500/20"
            onClick={reloadMedia}
          >
            {t('Retry')}
          </button>
        </div>
      );
    }

    if (message.type === 'image') {
      return (
        <button
          type="button"
          className="mb-1.5 block overflow-hidden rounded-xl border border-white/12"
          onClick={() => window.open(resolvedMediaUrl, '_blank', 'noopener,noreferrer')}
        >
          <img
            src={resolvedMediaUrl}
            alt={message.mediaName || t('Shared image')}
            className="max-h-72 w-full object-cover"
            loading="lazy"
          />
        </button>
      );
    }

    if (message.type === 'video') {
      return (
        <video controls className="mb-1.5 max-h-72 w-full rounded-xl border border-white/12" preload="metadata">
          <source src={resolvedMediaUrl} type={message.mediaMime || 'video/mp4'} />
        </video>
      );
    }

    if (message.type === 'audio') {
      return message.isVoice ? (
        <VoiceMessagePlayer
          src={resolvedMediaUrl}
          mimeType={message.mediaMime}
          fileName={message.mediaName}
          sizeBytes={message.mediaSizeBytes}
          isOwn={isOwn}
        />
      ) : (
        <AudioMessagePlayer
          src={resolvedMediaUrl}
          blob={resolvedMediaBlob}
          mimeType={message.mediaMime}
          fileName={message.mediaName}
          sizeBytes={message.mediaSizeBytes}
          isOwn={isOwn}
        />
      );
    }

    return null;
  })();

  const contentText = (message.text ?? '').trim();

  const extractFirstHttpUrl = (text: string): string | null => {
    if (!text) return null;
    const matches = text.match(/https?:\/\/[^\s]+/gi);
    if (!matches) return null;

    for (const rawMatch of matches) {
      let urlStr = rawMatch;
      if ((urlStr.startsWith('"') && urlStr.endsWith('"')) || (urlStr.startsWith("'") && urlStr.endsWith("'"))) {
        urlStr = urlStr.slice(1, -1);
      }

      const trailingPunctuation = /[.,!?:;)}\]،؛؟\s]$/;
      while (urlStr.length > 0 && trailingPunctuation.test(urlStr)) {
        const lastChar = urlStr[urlStr.length - 1];
        if (lastChar === ')' || lastChar === ']' || lastChar === '}') {
          const openChar = lastChar === ')' ? '(' : (lastChar === ']' ? '[' : '{');
          const openCount = (urlStr.match(new RegExp('\\' + openChar, 'g')) || []).length;
          const closeCount = (urlStr.match(new RegExp('\\' + lastChar, 'g')) || []).length;
          if (closeCount > openCount) {
            urlStr = urlStr.slice(0, -1);
          } else {
            break;
          }
        } else {
          urlStr = urlStr.slice(0, -1);
        }
      }

      try {
        if (urlStr.length > 2048) continue;
        const parsed = new URL(urlStr);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return urlStr;
        }
      } catch {
        // invalid URL
      }
    }
    return null;
  };

  const firstUrl = extractFirstHttpUrl(contentText);

  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { url: resolvedPreviewImageUrl } = useAuthenticatedMedia(preview?.image || undefined);

  useEffect(() => {
    if (!firstUrl) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    setPreview(null);
    setPreviewLoading(true);

    const controller = new AbortController();

    apiClient.getLinkPreview(firstUrl, controller.signal)
      .then(res => {
        if (controller.signal.aborted) return;
        if (res && res.preview) {
          setPreview(res.preview);
        } else {
          setPreview(null);
        }
      })
      .catch(err => {
        if (controller.signal.aborted || err.name === 'AbortError' || err.code === 'ABORT_ERR') {
          return;
        }
        // Quietly fail, don't log normal fetch/disabled/null errors
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [firstUrl]);

  const renderParsedContent = (text: string) => {
    if (!text) return null;
    const words = text.split(/(\s+)/);
    return words.map((word, index) => {
      if (word.startsWith('http://') || word.startsWith('https://')) {
        const cleanUrl = extractFirstHttpUrl(word);
        if (cleanUrl) {
          const trailingPart = word.slice(cleanUrl.length);
          return (
            <span key={index}>
              <a
                href={cleanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-tg-text-link hover:underline break-all"
              >
                {cleanUrl}
              </a>
              {trailingPart}
            </span>
          );
        }
      }
      return word;
    });
  };

  const previewNode = (() => {
    if (previewLoading) {
      return (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-tg-text-secondary">
          <Loader2 className="animate-spin text-tg-accent" size={12} />
          <span>{t('Loading preview...')}</span>
        </div>
      );
    }

    if (!preview) return null;

    return (
      <div className="mt-2 pl-2.5 border-l-2 border-tg-accent flex flex-col gap-1 text-left max-w-full">
        {preview.siteName ? (
          <span className="text-[11px] font-bold uppercase tracking-wider text-tg-text-link">
            {preview.siteName}
          </span>
        ) : null}
        {preview.title ? (
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold hover:underline line-clamp-1 break-all text-tg-text-primary"
          >
            {preview.title}
          </a>
        ) : (
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold hover:underline line-clamp-1 break-all text-tg-text-primary"
          >
            {preview.url}
          </a>
        )}
        {preview.description ? (
          <p className="text-[11px] text-tg-text-secondary line-clamp-3 leading-snug break-words">
            {preview.description}
          </p>
        ) : null}
        {resolvedPreviewImageUrl ? (
          <div className="mt-1 max-w-xs overflow-hidden rounded-lg border border-white/10">
            <img
              src={resolvedPreviewImageUrl}
              alt=""
              className="max-h-40 w-full object-cover"
            />
          </div>
        ) : null}
      </div>
    );
  })();

  return (
    <div
      className={`message-row-layout flex w-full min-w-0 ${isOwn ? 'justify-end' : 'justify-start'} gap-2 py-0.5`}
      data-message-id={message.id}
    >
      {!isOwn && isGroup ? (
        <div className="w-8 shrink-0">
          {showAvatar ? (
            <div
              className="relative h-8 w-8 overflow-hidden rounded-full text-center text-xs font-semibold leading-8 text-white"
              style={{ background: avatarColor }}
            >
              {senderName?.slice(0, 1).toUpperCase()}
              {canRenderAvatar ? (
                <img
                  src={senderAvatar}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`max-w-[min(30rem,72%)] min-w-0 ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        <article
          className={`rounded-2xl px-3 py-1.5 shadow-sm transition-colors max-w-full min-w-0 ${
            isOwn
              ? 'bg-tg-bubble-out text-tg-text-primary hover:bg-tg-bubble-out-hover'
              : 'bg-tg-bubble-in text-tg-text-primary hover:bg-tg-bubble-in-hover'
          }`}
          onContextMenu={event => {
            event.preventDefault();
            openContextMenuNearMessage(event.currentTarget);
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={clearLongPress}
          onTouchCancel={clearLongPress}
          onTouchMove={clearLongPress}
        >
          {!isOwn && isGroup && senderName ? (
            <p dir="auto" className="bidi-text mb-1 text-xs font-semibold text-tg-text-link">
              {senderName}
            </p>
          ) : null}

          {message.replyTo ? (
            <button
              type="button"
              onClick={() => onJumpToRepliedMessage(message.replyTo!.id)}
              className="mb-1.5 block w-full rounded-lg border border-tg-border bg-tg-bg-input-field px-2 py-1 text-left"
            >
              <p dir="auto" className="bidi-text text-[11px] font-semibold text-tg-text-link truncate">
                {replySenderName || message.replyTo.senderId}
              </p>
              <p dir="auto" className="bidi-text truncate text-xs text-tg-text-secondary">
                {message.replyTo.type === 'text'
                  ? message.replyTo.content
                  : `${message.replyTo.type === 'image'
                    ? t('[Photo]')
                    : message.replyTo.type === 'video'
                      ? t('[Video]')
                      : message.replyTo.type === 'audio'
                        ? t('[Audio]')
                        : message.replyTo.type.toUpperCase()
                  }${message.replyTo.mediaName ? ` - ${message.replyTo.mediaName}` : ''}`}
              </p>
            </button>
          ) : null}

          {mediaNode}

          {contentText ? (
            <p dir="auto" className="bidi-text whitespace-pre-wrap break-words text-[0.95rem] leading-[1.45]">
              {renderParsedContent(contentText)}
            </p>
          ) : null}

          {previewNode}

          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-tg-text-inTime">
            {message.isPinned ? <Pin size={12} className="text-tg-accent" /> : null}
            {message.isEdited ? <span>{t('(edited)')}</span> : null}
            <span>{formatTime(message.timestamp, { hour: '2-digit', minute: '2-digit' })}</span>
            {isOwn ? (
              message.isRead ? (
                <CheckCheck size={14} className="text-tg-text-success" />
              ) : message.isDelivered ? (
                <CheckCheck size={14} className="text-tg-text-outTime" />
              ) : (
                <Check size={14} className="text-tg-text-outTime" />
              )
            ) : null}
          </div>

          {message.reactions && message.reactions.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {message.reactions.map(reaction => (
                <button
                  key={`${message.id}:${reaction.emoji}`}
                  type="button"
                  className="rounded-full border border-tg-border bg-tg-bg-input-field px-2 py-0.5 text-xs hover:bg-tg-hover"
                  onClick={() => onToggleReaction(message.id, reaction.emoji)}
                >
                  {reaction.emoji} {reaction.count}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}
