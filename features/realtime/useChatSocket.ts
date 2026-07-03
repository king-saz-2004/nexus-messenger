import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { ApiChat, Chat, Message, User } from '../../types';
import { apiClient } from '../../services/apiClient';
import { connectChatSocket, disconnectChatSocket, getChatSocket } from '../../services/socketClient';
import { sortChats, toUiMessage, upsertChat } from '../../services/chatAdapter';
import type { TranslationKey } from '../../services/i18n';

type SocketMessagePayload = { chatId: string; message: any };
type SocketDeletePayload = {
  chatId: string;
  messageId: string;
  actorId: string;
  scope: 'everyone';
  mode: 'hard_delete';
};
type SocketTypingStartPayload = { chatId: string; userId: string; username: string };
type SocketTypingStopPayload = { chatId: string; userId: string };
type SocketOnlinePayload = { userId: string };
type SocketOfflinePayload = { userId: string; lastSeenAt: string | null };
type SocketMemberAddedPayload = { chatId: string; userIds: string[]; addedBy: string };
type SocketMemberRemovedPayload = { chatId: string; userId: string; removedBy: string };
type SocketMemberRolePayload = { chatId: string; userId: string; newRole: string; changedBy: string };
type SocketMemberBannedPayload = { chatId: string; userId: string; bannedBy: string };
type SocketChatUpdatedPayload = { chatId: string; chat?: ApiChat; changes?: Record<string, unknown> };
type SocketChatDeletedPayload = { chatId: string; deletedBy: string };
type SocketForceDisconnectPayload = { chatId: string; reason: string };
type SocketUnreadUpdatedPayload = { chatId: string; count: number };
type SocketChatClearedPayload = { chatId: string };
type SocketPlatformClearedPayload = { type: 'messages' | 'media' };

type UserSettingsNotificationState = {
  notificationEnabled: boolean;
  notificationSound: boolean;
} | null;

type UseChatSocketParams = {
  currentUser: User | null;
  activeChatId: string | null;
  socketRef: MutableRefObject<Socket | null>;
  activeChatIdRef: MutableRefObject<string | null>;
  chatsByIdRef: MutableRefObject<Map<string, Chat>>;
  userSettingsRef: MutableRefObject<UserSettingsNotificationState>;
  isWindowFocusedRef: MutableRefObject<boolean>;
  hydrateChats: (viewer: User) => Promise<void>;
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  localizeError: (error: unknown, fallbackKey?: TranslationKey) => string;
  loadPinnedMessages: (chatId: string) => Promise<void>;
  playNotificationSound: () => void;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  setUsers: Dispatch<SetStateAction<User[]>>;
  setActiveChatId: Dispatch<SetStateAction<string | null>>;
  setPinnedMessagesByChat: Dispatch<SetStateAction<Map<string, Message[]>>>;
};

export const useChatSocket = ({
  currentUser,
  activeChatId,
  socketRef,
  activeChatIdRef,
  chatsByIdRef,
  userSettingsRef,
  isWindowFocusedRef,
  hydrateChats,
  notify,
  t,
  localizeError,
  loadPinnedMessages,
  playNotificationSound,
  setChats,
  setUsers,
  setActiveChatId,
  setPinnedMessagesByChat
}: UseChatSocketParams) => {
  useEffect(() => {
    if (!currentUser) return;
    connectChatSocket(apiClient.getApiBase());
    const socket = getChatSocket();
    if (!socket) return;
    socketRef.current = socket;

    const refreshChats = () => {
      void hydrateChats(currentUser).catch(() => undefined);
    };

    const handleIncomingMessage = ({ chatId, message }: SocketMessagePayload) => {
      const next = toUiMessage(message);
      if (next.type === 'system') return;
      const isIncomingFromOtherUser = next.senderId !== currentUser.id;
      const shouldIncrementUnread = isIncomingFromOtherUser && (activeChatIdRef.current !== chatId || !isWindowFocusedRef.current);

      if (isIncomingFromOtherUser) {
        const chat = chatsByIdRef.current.get(chatId);
        const isMuted = chat?.isMuted && (!chat.mutedUntil || new Date(chat.mutedUntil).getTime() > Date.now());
        const isGloballyEnabled = userSettingsRef.current ? userSettingsRef.current.notificationEnabled : true;
        const isSoundEnabled = userSettingsRef.current ? userSettingsRef.current.notificationSound : true;

        if (isGloballyEnabled && !isMuted) {
          if (isSoundEnabled && (activeChatIdRef.current !== chatId || !isWindowFocusedRef.current)) {
            playNotificationSound();
          }
        }
      }

      setChats(prev => {
        const target = prev.find(chat => chat.id === chatId);
        if (!target) {
          refreshChats();
          return prev;
        }

        const alreadyExists = target.messages.some(item => item.id === next.id);

        let messages = target.messages;
        let isReplaced = false;

        if (!alreadyExists) {
          if (next.clientMessageId) {
            const tempIndex = target.messages.findIndex(item => item.id === next.clientMessageId);
            if (tempIndex !== -1) {
              messages = [...target.messages];
              messages[tempIndex] = next;
              isReplaced = true;
            }
          }
          if (!isReplaced) {
            messages = [...target.messages, next];
          }
        }

        const unreadCount =
          shouldIncrementUnread && !alreadyExists && !isReplaced
            ? Math.max(0, (target.unreadCount || 0) + 1)
            : target.unreadCount;

        return upsertChat(prev, {
          ...target,
          messages,
          unreadCount,
          lastMessage: next,
          lastActivityAt: next.timestamp
        });
      });
    };

    socket.on('new_message', handleIncomingMessage);

    socket.on('message_edited', ({ chatId, message }: SocketMessagePayload) => {
      const next = toUiMessage(message);
      setChats(prev =>
        prev.map(chat =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map(item => (item.id === next.id ? next : item)),
                lastMessage: chat.lastMessage?.id === next.id ? next : chat.lastMessage
              }
            : chat
        )
      );
      // If a message's pin state changed via socket, refresh pinned list for that chat
      if (typeof (message as any).isPinned === 'boolean') {
        void loadPinnedMessages(chatId);
      }
    });

    socket.on('pinned_messages_updated', ({ chatId }: { chatId: string }) => {
      if (chatId) void loadPinnedMessages(chatId);
    });

    socket.on('message_deleted', ({ chatId, messageId }: SocketDeletePayload) => {
      setChats(prev => {
        const nextList = prev.map(chat => {
          if (chat.id !== chatId) return chat;
          const messages = chat.messages.filter(item => item.id !== messageId);
          const lastMessage = chat.lastMessage?.id === messageId ? messages[messages.length - 1] : chat.lastMessage;
          return {
            ...chat,
            messages,
            lastMessage,
            lastActivityAt: lastMessage ? lastMessage.timestamp : chat.lastActivityAt
          };
        });
        return sortChats(nextList);
      });
    });

    socket.on('message_reacted', ({ chatId, message }: SocketMessagePayload) => {
      const next = toUiMessage(message);
      setChats(prev =>
        prev.map(chat =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map(item => (item.id === next.id ? next : item)),
                lastMessage: chat.lastMessage?.id === next.id ? next : chat.lastMessage
              }
            : chat
        )
      );
    });

    socket.on(
      'message_read',
      ({ chatId, messageId, userId, message }: { chatId: string; messageId: string; userId: string; message?: any }) => {
        setChats(prev =>
          prev.map(chat => {
            if (chat.id !== chatId) return chat;

            const markOwnMessageRead = (item: (typeof chat.messages)[number]) => {
              if (item.senderId !== currentUser.id) {
                return item;
              }
              const seenBy = item.seenBy.includes(userId) ? item.seenBy : [...item.seenBy, userId];
              return {
                ...item,
                seenBy,
                isDelivered: true,
                isRead: true
              };
            };

            let messages = chat.messages;
            let lastMessage = chat.lastMessage;

            if (message) {
              const next = toUiMessage(message);
              messages = messages.map(item => (item.id === next.id ? next : item));
              if (lastMessage?.id === next.id) {
                lastMessage = next;
              }
            }

            const readUpToIndex = messages.findIndex(item => item.id === messageId);
            messages =
              readUpToIndex >= 0
                ? messages.map((item, index) => (index <= readUpToIndex ? markOwnMessageRead(item) : item))
                : messages.map(item => (item.id === messageId ? markOwnMessageRead(item) : item));

            if (lastMessage) {
              const syncedLast = messages.find(item => item.id === lastMessage?.id);
              if (syncedLast) {
                lastMessage = syncedLast;
              }
            }

            return {
              ...chat,
              messages,
              lastMessage
            };
          })
        );
      }
    );

    socket.on('unread_updated', ({ chatId, count }: SocketUnreadUpdatedPayload) => {
      setChats(prev =>
        prev.map(chat =>
          chat.id === chatId
            ? {
                ...chat,
                unreadCount: Math.max(0, Number.isFinite(count) ? count : 0)
              }
            : chat
        )
      );
    });

    socket.on('user_typing', ({ chatId, userId }: SocketTypingStartPayload) => {
      if (userId === currentUser.id) return;
      setChats(prev =>
        prev.map(chat => {
          if (chat.id !== chatId) return chat;
          const typingUsers = chat.typingUsers?.includes(userId) ? chat.typingUsers || [] : [...(chat.typingUsers || []), userId];
          return {
            ...chat,
            typingUsers,
            isTyping: typingUsers.some(id => id !== currentUser.id)
          };
        })
      );
    });

    socket.on('user_stopped_typing', ({ chatId, userId }: SocketTypingStopPayload) => {
      setChats(prev =>
        prev.map(chat => {
          if (chat.id !== chatId) return chat;
          const typingUsers = (chat.typingUsers || []).filter(id => id !== userId);
          return {
            ...chat,
            typingUsers,
            isTyping: typingUsers.some(id => id !== currentUser.id)
          };
        })
      );
    });

    socket.on('user_online', ({ userId }: SocketOnlinePayload) => {
      setUsers(prev => prev.map(user => (user.id === userId ? { ...user, isOnline: true } : user)));
      setChats(prev =>
        prev.map(chat => ({
          ...chat,
          participants: chat.participants.map(user => (user.id === userId ? { ...user, isOnline: true } : user))
        }))
      );
    });

    socket.on('user_offline', ({ userId, lastSeenAt }: SocketOfflinePayload) => {
      setUsers(prev =>
        prev.map(user => (user.id === userId ? { ...user, isOnline: false, lastSeenAt: lastSeenAt ?? undefined } : user))
      );
      setChats(prev =>
        prev.map(chat => ({
          ...chat,
          participants: chat.participants.map(user =>
            user.id === userId ? { ...user, isOnline: false, lastSeenAt: lastSeenAt ?? undefined } : user
          )
        }))
      );
    });

    socket.on('member_added', (_payload: SocketMemberAddedPayload) => {
      refreshChats();
    });

    socket.on('member_removed', (payload: SocketMemberRemovedPayload) => {
      if (payload.userId === currentUser.id && activeChatIdRef.current === payload.chatId) {
        setActiveChatId(null);
        notify(t('You were removed from this chat'), 'info');
      }
      refreshChats();
    });

    socket.on('member_role_changed', (_payload: SocketMemberRolePayload) => {
      refreshChats();
    });

    socket.on('member_banned', (payload: SocketMemberBannedPayload) => {
      if (payload.userId === currentUser.id && activeChatIdRef.current === payload.chatId) {
        setActiveChatId(null);
        notify(t('You were banned from this chat'), 'error');
      }
      refreshChats();
    });

    socket.on('chat_updated', (_payload: SocketChatUpdatedPayload) => {
      refreshChats();
    });

    socket.on('chat_deleted', (payload: SocketChatDeletedPayload) => {
      setChats(prev => prev.filter(chat => chat.id !== payload.chatId));
      if (activeChatIdRef.current === payload.chatId) {
        setActiveChatId(null);
      }
      refreshChats();
    });

    socket.on('force_disconnect', ({ chatId, reason }: SocketForceDisconnectPayload) => {
      if (activeChatIdRef.current === chatId) {
        setActiveChatId(null);
      }
      notify(localizeError(reason, 'You no longer have access to this chat'), 'info');
      refreshChats();
    });

    socket.on('chat:cleared', ({ chatId }: SocketChatClearedPayload) => {
      setChats(prev =>
        prev.map(chat =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [],
                lastMessage: undefined
              }
            : chat
        )
      );
    });

    socket.on('platform:cleared', ({ type }: SocketPlatformClearedPayload) => {
      if (type === 'messages') {
        setChats(prev =>
          prev.map(chat => ({
            ...chat,
            messages: [],
            lastMessage: undefined
          }))
        );
        setPinnedMessagesByChat(new Map());
      } else if (type === 'media') {
        setChats(prev =>
          prev.map(chat => {
            const filteredMessages = chat.messages.filter(m => !(m as any).media);
            const lastMessage = (chat.lastMessage as any)?.media
              ? (filteredMessages[filteredMessages.length - 1] ?? undefined)
              : chat.lastMessage;
            return {
              ...chat,
              messages: filteredMessages,
              lastMessage
            };
          })
        );
        const activeId = activeChatIdRef.current;
        if (activeId) {
          void loadPinnedMessages(activeId);
        }
        refreshChats();
      } else {
        refreshChats();
      }
    });

    return () => {
      disconnectChatSocket();
      socketRef.current = null;
    };
  }, [
    activeChatIdRef,
    chatsByIdRef,
    currentUser,
    hydrateChats,
    isWindowFocusedRef,
    loadPinnedMessages,
    localizeError,
    notify,
    playNotificationSound,
    setActiveChatId,
    setChats,
    setPinnedMessagesByChat,
    setUsers,
    socketRef,
    t,
    userSettingsRef
  ]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeChatId) return;

    socket.emit('join', activeChatId);
    return () => {
      socket.emit('leave', activeChatId);
    };
  }, [activeChatId, socketRef]);
};
