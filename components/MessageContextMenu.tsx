import React, { useMemo } from 'react';
import { Copy, MessageSquareReply, Pencil, SmilePlus, Trash2, Download, Pin, PinOff } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';

type MessageContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  isOwn: boolean;
  onReply: () => void;
  onCopy: () => void;
  onReact: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
};

const MENU_WIDTH = 172;

export default function MessageContextMenu({
  open,
  x,
  y,
  isOwn,
  onReply,
  onCopy,
  onReact,
  onEdit,
  onDelete,
  onDownload,
  onPin,
  onUnpin
}: MessageContextMenuProps) {
  const { t } = useI18n();

  const position = useMemo(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const itemCount =
      3 +
      (onEdit ? 1 : 0) +
      (onDelete ? 1 : 0) +
      (onDownload ? 1 : 0) +
      (onPin ? 1 : 0) +
      (onUnpin ? 1 : 0);
    const menuHeight = itemCount * 34 + 8;

    let left = isOwn ? x - MENU_WIDTH - 8 : x + 8;
    let top = y - 8;

    left = Math.max(8, Math.min(left, viewportWidth - MENU_WIDTH - 8));
    top = Math.max(8, Math.min(top, viewportHeight - menuHeight - 8));

    return { left, top };
  }, [isOwn, onDelete, onEdit, onPin, onUnpin, x, y]);

  if (!open) {
    return null;
  }

  return (
    <div
      data-message-context-menu
      className="fixed z-[120] w-[10.75rem] overflow-hidden rounded-xl border border-tg-border bg-tg-bg-modal p-1 shadow-2xl"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={t('Message actions')}
    >
      <button
        type="button"
        onClick={onReply}
        className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-tg-text-primary hover:bg-tg-hover"
        role="menuitem"
      >
        <MessageSquareReply size={14} />
        {t('Reply')}
      </button>

      <button
        type="button"
        onClick={onCopy}
        className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-tg-text-primary hover:bg-tg-hover"
        role="menuitem"
      >
        <Copy size={14} />
        {t('Copy')}
      </button>

      <button
        type="button"
        onClick={onReact}
        className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-tg-text-primary hover:bg-tg-hover"
        role="menuitem"
      >
        <SmilePlus size={14} />
        {t('React')}
      </button>

      {onDownload ? (
        <button
          type="button"
          onClick={onDownload}
          className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-tg-text-primary hover:bg-tg-hover"
          role="menuitem"
        >
          <Download size={14} />
          {t('Download')}
        </button>
      ) : null}

      {onPin ? (
        <button
          type="button"
          onClick={onPin}
          className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-tg-text-primary hover:bg-tg-hover"
          role="menuitem"
        >
          <Pin size={14} />
          {t('Pin message')}
        </button>
      ) : null}

      {onUnpin ? (
        <button
          type="button"
          onClick={onUnpin}
          className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-tg-text-primary hover:bg-tg-hover"
          role="menuitem"
        >
          <PinOff size={14} />
          {t('Unpin message')}
        </button>
      ) : null}

      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-tg-text-primary hover:bg-tg-hover"
          role="menuitem"
        >
          <Pencil size={14} />
          {t('Edit')}
        </button>
      ) : null}

      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-500/12"
          role="menuitem"
        >
          <Trash2 size={14} />
          {t('Delete message')}
        </button>
      ) : null}
    </div>
  );
}
