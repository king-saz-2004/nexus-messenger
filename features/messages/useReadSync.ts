import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Chat, User } from '../../types';
import { apiClient } from '../../services/apiClient';

type UseReadSyncParams = {
  currentUser: User | null;
  activeChat: Chat | null;
  activeChatIdRef: MutableRefObject<string | null>;
  chatsByIdRef: MutableRefObject<Map<string, Chat>>;
  readSyncKeyByChatRef: MutableRefObject<Record<string, string>>;
  isWindowFocusedRef: MutableRefObject<boolean>;
  setChats: Dispatch<SetStateAction<Chat[]>>;
};

export const useReadSync = ({
  currentUser,
  activeChat,
  activeChatIdRef,
  chatsByIdRef,
  readSyncKeyByChatRef,
  isWindowFocusedRef,
  setChats
}: UseReadSyncParams) => {
  useEffect(() => {
    const handleFocus = () => {
      isWindowFocusedRef.current = true;
      if (!currentUser) return;
      const activeId = activeChatIdRef.current;
      if (!activeId) return;
      const chat = chatsByIdRef.current.get(activeId);
      if (!chat || (chat.unreadCount || 0) <= 0) return;

      const readSyncKey = `${activeId}:${chat.unreadCount}:${chat.lastMessage?.id ?? ''}`;
      if (readSyncKeyByChatRef.current[activeId] === readSyncKey) return;

      readSyncKeyByChatRef.current[activeId] = readSyncKey;
      void apiClient
        .markChatRead(activeId)
        .then(() => {
          setChats(prev =>
            prev.map(item =>
              item.id === activeId
                ? {
                    ...item,
                    unreadCount: 0
                  }
                : item
            )
          );
        })
        .catch(() => {
          if (readSyncKeyByChatRef.current[activeId] === readSyncKey) {
            delete readSyncKeyByChatRef.current[activeId];
          }
        });
    };

    const handleBlur = () => {
      isWindowFocusedRef.current = false;
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
      }
    };
  }, [activeChatIdRef, chatsByIdRef, currentUser, isWindowFocusedRef, readSyncKeyByChatRef, setChats]);

  useEffect(() => {
    if (!currentUser || !activeChat) return;

    const chatId = activeChat.id;
    if (activeChat.unreadCount <= 0) {
      delete readSyncKeyByChatRef.current[chatId];
      return;
    }

    const readSyncKey = `${chatId}:${activeChat.unreadCount}:${activeChat.lastMessage?.id ?? ''}`;
    if (readSyncKeyByChatRef.current[chatId] === readSyncKey) return;

    readSyncKeyByChatRef.current[chatId] = readSyncKey;
    void apiClient
      .markChatRead(chatId)
      .then(() => {
        setChats(prev =>
          prev.map(chat =>
            chat.id === chatId
              ? {
                  ...chat,
                  unreadCount: 0
                }
              : chat
          )
        );
      })
      .catch(() => {
        if (readSyncKeyByChatRef.current[chatId] === readSyncKey) {
          delete readSyncKeyByChatRef.current[chatId];
        }
      });
  }, [activeChat, currentUser, readSyncKeyByChatRef, setChats]);
};
