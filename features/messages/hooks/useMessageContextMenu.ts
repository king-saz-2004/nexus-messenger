import { useCallback, useState } from 'react';
import type { Message } from '../../../types';

export type MessageContextState = {
  message: Message;
  x: number;
  y: number;
  isOwn: boolean;
};

export type ReactionPickerState = {
  message: Message;
  x: number;
  y: number;
};

export const useMessageContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<MessageContextState | null>(null);
  const [reactionPicker, setReactionPicker] = useState<ReactionPickerState | null>(null);

  const closeTransientMenus = useCallback(() => {
    setContextMenu(null);
    setReactionPicker(null);
  }, []);

  return {
    contextMenu,
    setContextMenu,
    reactionPicker,
    setReactionPicker,
    closeTransientMenus
  };
};
