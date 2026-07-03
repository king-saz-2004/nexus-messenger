import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { ApiChat, Chat, Contact, GroupMember, Message, User, MediaLimits } from './types';
import AppShell from './features/app-shell/AppShell';
import { useResponsiveLayout } from './features/app-shell/useResponsiveLayout';
import { useNotificationSound } from './features/notifications/useNotificationSound';
import { useThemeLanguage, type UserSettingsDto } from './features/settings/useThemeLanguage';
import { useReadSync } from './features/messages/useReadSync';
import { updateAppBadge } from './features/pwa/appBadge';
import { useChatSocket } from './features/realtime/useChatSocket';
import { useToasts } from './shared/hooks/useToasts';
import { apiClient } from './services/apiClient';
import { localizeApiError, normalizeLocale, translate, type TranslationKey } from './services/i18n';
import { disconnectChatSocket } from './services/socketClient';
import {
  applyUsersToChats,
  mergeUsersById,
  normalizeUser,
  normalizeUsers,
  relabelSystemChats,
  sortChats,
  toUiChat,
  toUiChats,
  toUiMessage,
  upsertChat
} from './services/chatAdapter';

type LoadMessagesOptions = { force?: boolean };

const CHAT_QUERY_PARAM = 'chat';

const normalizeUrlChatId = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readChatIdFromUrl = () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return normalizeUrlChatId(params.get(CHAT_QUERY_PARAM));
};

const writeChatIdToUrl = (chatId: string | null) => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (chatId) {
    url.searchParams.set(CHAT_QUERY_PARAM, chatId);
  } else {
    url.searchParams.delete(CHAT_QUERY_PARAM);
  }

  const currentRelative = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextRelative = `${url.pathname}${url.search}${url.hash}`;
  if (currentRelative === nextRelative) return;

  window.history.replaceState(window.history.state, '', nextRelative);
};


export default function App() {
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    applyThemeSetting,
    applyLanguageSetting
  } = useThemeLanguage();
  const { isMobile } = useResponsiveLayout();
  const playNotificationSound = useNotificationSound();
  const { toasts, notify } = useToasts();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(() => readChatIdFromUrl());
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isInitialChatsLoading, setIsInitialChatsLoading] = useState(false);
  const [isChatsRefreshing, setIsChatsRefreshing] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettingsDto | null>(null);
  const [mediaLimits, setMediaLimits] = useState<MediaLimits>({
    voice: 0.03,
    audio: 0.03,
    photo: 0.03,
    video: 0.03
  });
  const [pinnedMessagesByChat, setPinnedMessagesByChat] = useState<Map<string, Message[]>>(new Map());

  const socketRef = useRef<Socket | null>(null);
  const readSyncKeyByChatRef = useRef<Record<string, string>>({});
  const hasLoadedChatsRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(null);
  const chatsByIdRef = useRef<Map<string, Chat>>(new Map());
  const userSettingsRef = useRef<UserSettingsDto | null>(null);
  const usersRef = useRef<User[]>([]);
  const messagesLoadInFlightRef = useRef<Record<string, Promise<void>>>({});
  const messagesLoadedByChatRef = useRef<Record<string, true>>({});
  const messagesHasMoreByChatRef = useRef<Record<string, boolean>>({});
  const urlChatIdRef = useRef<string | null>(readChatIdFromUrl());
  const isWindowFocusedRef = useRef(typeof document !== 'undefined' ? document.hasFocus() : true);

  const activeChat = useMemo(() => chats.find(chat => chat.id === activeChatId) || null, [chats, activeChatId]);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language]
  );
  const localizeError = useCallback(
    (error: unknown, fallbackKey: TranslationKey = 'Something went wrong. Please try again.') =>
      localizeApiError(language, error, fallbackKey),
    [language]
  );
  const systemChatLabels = useMemo(
    () => ({
      savedMessages: t('Saved Messages'),
      unknownUser: t('Unknown user'),
      untitledGroup: t('Untitled Group')
    }),
    [t]
  );

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    chatsByIdRef.current = new Map(chats.map(chat => [chat.id, chat]));
  }, [chats]);

  useEffect(() => {
    const onPopState = () => {
      const requestedChatId = normalizeUrlChatId(readChatIdFromUrl());
      urlChatIdRef.current = requestedChatId;

      if (!requestedChatId) {
        setActiveChatId(null);
        return;
      }

      if (chatsByIdRef.current.has(requestedChatId)) {
        setActiveChatId(requestedChatId);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!currentUser || !hasLoadedChatsRef.current) return;

    const requestedChatId = normalizeUrlChatId(urlChatIdRef.current);
    if (!requestedChatId) return;

    if (!chatsByIdRef.current.has(requestedChatId)) {
      urlChatIdRef.current = null;
      writeChatIdToUrl(null);
      return;
    }

    setActiveChatId(prev => (prev === requestedChatId ? prev : requestedChatId));
  }, [chats, currentUser]);

  useEffect(() => {
    if (!currentUser || !hasLoadedChatsRef.current) return;

    const syncedChatId = activeChatId && chatsByIdRef.current.has(activeChatId) ? activeChatId : null;
    urlChatIdRef.current = syncedChatId;
    writeChatIdToUrl(syncedChatId);
  }, [activeChatId, currentUser]);

  useEffect(() => {
    if (!currentUser || !activeChatId) return;
    if (!chatsByIdRef.current.has(activeChatId)) return;
    void loadPinnedMessages(activeChatId);
  }, [activeChatId, currentUser, chats]);

  const hydrateChats = useCallback(
    async (viewer: User, query = '') => {
      const isBackgroundRefresh = hasLoadedChatsRef.current;
      if (isBackgroundRefresh) {
        setIsChatsRefreshing(true);
      } else {
        setIsInitialChatsLoading(true);
      }

      try {
        const hasUsers = usersRef.current.length > 0;
        const savedPromise: Promise<{ chat: ApiChat } | null> = query.trim()
          ? Promise.resolve(null)
          : apiClient.getSavedChat().catch(() => null);

        const usersPromise = hasUsers
          ? Promise.resolve({ users: usersRef.current })
          : apiClient.getUsers(500).catch(() => ({ users: [] }));

        const [usersRes, chatsRes, savedRes]: [{ users: User[] }, { chats: ApiChat[] }, { chat: ApiChat } | null] =
          await Promise.all([usersPromise, apiClient.getChats(query), savedPromise]);

        const mergedUsers = mergeUsersById([viewer], normalizeUsers(usersRes.users || []));
        const resolvedViewer = mergedUsers.find(user => user.id === viewer.id) || normalizeUser(viewer);
        const apiChats: ApiChat[] = [...(chatsRes.chats || [])];

        if (savedRes?.chat && !apiChats.some(chat => chat.id === savedRes.chat.id)) {
          apiChats.unshift(savedRes.chat);
        }

        const nextUiChats: Chat[] = sortChats(toUiChats(apiChats, mergedUsers, resolvedViewer, systemChatLabels));

        setCurrentUser(resolvedViewer);
        setUsers(mergedUsers);
        setChats(prev => {
          const previousById = new Map<string, Chat>(prev.map(chat => [chat.id, chat] as const));
          const merged = nextUiChats.map(chat => {
            const existing = previousById.get(chat.id);
            if (existing && existing.messages.length > 0) {
              return {
                ...chat,
                messages: existing.messages,
                lastMessage: chat.lastMessage || existing.lastMessage
              };
            }
            return chat;
          });
          return sortChats(merged);
        });

        const searching = query.trim().length > 0;
        const availableChatIds = new Set(nextUiChats.map(chat => chat.id));
        const requestedFromUrl = searching ? null : normalizeUrlChatId(urlChatIdRef.current ?? readChatIdFromUrl());
        const validRequestedFromUrl =
          requestedFromUrl && availableChatIds.has(requestedFromUrl) ? requestedFromUrl : null;

        if (requestedFromUrl && !validRequestedFromUrl) {
          urlChatIdRef.current = null;
          writeChatIdToUrl(null);
        }

        setActiveChatId(prev => {
          if (validRequestedFromUrl) {
            return validRequestedFromUrl;
          }
          if (prev && availableChatIds.has(prev)) {
            return prev;
          }
          if (searching) {
            return prev;
          }
          if (!isMobile && nextUiChats.length > 0) {
            return nextUiChats[0].id;
          }
          return null;
        });
        hasLoadedChatsRef.current = true;
      } finally {
        if (isBackgroundRefresh) {
          setIsChatsRefreshing(false);
        } else {
          setIsInitialChatsLoading(false);
        }
      }
    },
    [isMobile, systemChatLabels]
  );

  const upsertFromApiChat = useCallback(
    (apiChat: any) => {
      if (!currentUser) return null;

      const usersById = new Map<string, User>([...users, currentUser].map(user => [user.id, user]));
      const nextChat = toUiChat(apiChat, usersById, currentUser, systemChatLabels);

      setChats(prev => {
        const existing = prev.find(chat => chat.id === nextChat.id);
        const mergedChat: Chat = {
          ...nextChat,
          messages: nextChat.messages.length > 0 ? nextChat.messages : existing?.messages || [],
          lastMessage: nextChat.lastMessage || existing?.lastMessage
        };
        return upsertChat(prev, mergedChat);
      });

      return nextChat;
    },
    [currentUser, users, systemChatLabels]
  );

  const loadMessages = useCallback(
    async (chatId: string, options: LoadMessagesOptions = {}) => {
      const chat = chatsByIdRef.current.get(chatId);
      if (!chat) return;
      if (!options.force && messagesLoadedByChatRef.current[chatId]) return;

      const inFlight = messagesLoadInFlightRef.current[chatId];
      if (inFlight) {
        await inFlight;
        return;
      }

      const fetchPromise = (async () => {
        const data = await apiClient.getMessages(chat.id, undefined, 50, chat.type === 'group');
        const messages = (data.messages || [])
          .map(toUiMessage)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        messagesLoadedByChatRef.current[chatId] = true;
        messagesHasMoreByChatRef.current[chatId] = Boolean(data.hasMore);
        setChats(prev =>
          prev.map(item =>
            item.id === chat.id
              ? {
                ...item,
                messages,
                nextCursor: data.nextCursor,
                hasMore: Boolean(data.nextCursor),
                lastMessage: messages[messages.length - 1] || item.lastMessage
              }
              : item
          )
        );
      })()
        .finally(() => {
          delete messagesLoadInFlightRef.current[chatId];
        });

      messagesLoadInFlightRef.current[chatId] = fetchPromise;
      await fetchPromise;
    },
    []
  );

  const refreshUsersDirectory = useCallback(async () => {
    if (!currentUser) return;
    const usersRes = await apiClient.getUsers();
    const mergedUsers = mergeUsersById([currentUser], normalizeUsers(usersRes.users || []));
    const resolvedViewer = mergedUsers.find(user => user.id === currentUser.id) || currentUser;
    setUsers(mergedUsers);
    setCurrentUser(resolvedViewer);
  }, [currentUser]);

  const refreshContactsDirectory = useCallback(async () => {
    const contactsRes = await apiClient.listContacts();
    const nextContacts = (contactsRes.contacts || []).map(contact => ({
      ...contact,
      user: normalizeUser(contact.user)
    }));
    setContacts(nextContacts);
  }, []);

  const loadMediaLimits = useCallback(async () => {
    try {
      const limits = await apiClient.getMediaLimits();
      setMediaLimits(limits);
    } catch (err) {
      console.error('Failed to load media limits:', err);
    }
  }, []);

  const loadMySettings = useCallback(async () => {
    const response = await apiClient.getMySettings();
    const normalizedSettings = {
      ...response.settings,
      language: normalizeLocale(response.settings.language)
    };
    setUserSettings(normalizedSettings);
    applyThemeSetting(normalizedSettings.theme);
    applyLanguageSetting(normalizedSettings.language);
    return normalizedSettings;
  }, [applyLanguageSetting, applyThemeSetting]);

  const saveMySettings = useCallback(
    async (payload: {
      theme?: 'light' | 'dark' | 'system';
      chatWallpaper?: string | null;
      fontSize?: 14 | 16 | 18 | 20;
      messageCorner?: number;
      showStickersTab?: boolean;
      autoDownloadPhoto?: boolean;
      autoDownloadVideo?: boolean;
      autoDownloadDoc?: boolean;
      autoPlayGif?: boolean;
      notificationEnabled?: boolean;
      notificationSound?: boolean;
      notificationPreview?: boolean;
      notificationCountBadge?: boolean;
      language?: string;
      timeFormat?: '12h' | '24h';
    }) => {
      const response = await apiClient.updateMySettings(payload);
      const normalizedSettings = {
        ...response.settings,
        language: normalizeLocale(response.settings.language)
      };
      setUserSettings(normalizedSettings);
      applyThemeSetting(normalizedSettings.theme);
      applyLanguageSetting(normalizedSettings.language);
      return normalizedSettings;
    },
    [applyLanguageSetting, applyThemeSetting]
  );

  const toggleThemeFromSidebar = useCallback(() => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    setUserSettings(prev => (prev ? { ...prev, theme: nextTheme } : prev));
    void saveMySettings({ theme: nextTheme }).catch(error => {
      notify(localizeError(error, 'Failed to save theme preference'), 'error');
    });
  }, [localizeError, notify, saveMySettings, theme]);

  const toggleLanguage = useCallback(() => {
    const nextLanguage = language === 'fa' ? 'en' : 'fa';
    setLanguage(nextLanguage);
    setUserSettings(prev => (prev ? { ...prev, language: nextLanguage } : prev));
    void saveMySettings({ language: nextLanguage }).catch(error => {
      notify(localizeError(error, 'Failed to save language preference'), 'error');
    });
  }, [language, localizeError, notify, saveMySettings]);

  const listMySessions = useCallback(async (cursor?: string, limit = 25) => {
    return apiClient.listSessions(cursor, limit);
  }, []);

  const terminateMySession = useCallback(async (sessionId: string) => {
    return apiClient.terminateSession(sessionId);
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      const restored = await apiClient.restoreSession();
      if (!restored?.user) {
        setIsBootstrapping(false);
        return;
      }

      const viewer = normalizeUser(restored.user);
      setCurrentUser(viewer);
      await hydrateChats(viewer);
      await refreshContactsDirectory();
      await loadMySettings().catch(() => undefined);
      await loadMediaLimits().catch(() => undefined);
    } catch {
      setCurrentUser(null);
      setContacts([]);
      setUserSettings(null);
    } finally {
      setIsBootstrapping(false);
    }
  }, [hydrateChats, loadMySettings, refreshContactsDirectory]);

  useEffect(() => {
    void restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setChats(prev => applyUsersToChats(prev, users));
  }, [users, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    setChats(prev => relabelSystemChats(prev, currentUser, systemChatLabels));
  }, [currentUser, systemChatLabels]);

  useEffect(() => {
    userSettingsRef.current = userSettings;
  }, [userSettings]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const totalUnreadCount = chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
    const showBadge = userSettings ? userSettings.notificationCountBadge : true;
    const titleBase = 'Nexus Messenger';

    if (!currentUser) {
      document.title = titleBase;
      void updateAppBadge(0, false);
      return;
    }

    if (showBadge && totalUnreadCount > 0) {
      document.title = `(${totalUnreadCount}) ${titleBase}`;
    } else {
      document.title = titleBase;
    }

    void updateAppBadge(totalUnreadCount, showBadge);
  }, [chats, currentUser, userSettings]);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setIsAuthLoading(true);
      try {
        const login = await apiClient.login(username, password);
        const viewer = normalizeUser(login.user);
        setCurrentUser(viewer);
        await hydrateChats(viewer);
        await refreshContactsDirectory();
        await loadMySettings().catch(() => undefined);
        await loadMediaLimits().catch(() => undefined);
        notify(t('Signed in successfully'), 'success');
      } finally {
        setIsAuthLoading(false);
      }
    },
    [hydrateChats, loadMySettings, loadMediaLimits, notify, refreshContactsDirectory, t]
  );

  const handleRegister = useCallback(
    async (payload: {
      username: string;
      firstName: string;
      lastName?: string;
      email?: string;
      phone?: string;
      password: string;
    }) => {
      setIsAuthLoading(true);
      try {
        const register = await apiClient.register(payload);
        if ('status' in register && register.status === 'pending_approval') {
          notify(register.message || t('Registration submitted and pending approval.'), 'success');
          return register;
        }
        if ('user' in register && register.user) {
          const viewer = normalizeUser(register.user);
          setCurrentUser(viewer);
          await hydrateChats(viewer);
          await refreshContactsDirectory();
          await loadMySettings().catch(() => undefined);
          await loadMediaLimits().catch(() => undefined);
          notify(t('Account created successfully'), 'success');
          return register;
        }
      } finally {
        setIsAuthLoading(false);
      }
    },
    [hydrateChats, loadMySettings, loadMediaLimits, notify, refreshContactsDirectory, t]
  );

  const handleLogout = useCallback(async () => {
    await apiClient.logout();
    disconnectChatSocket();
    socketRef.current = null;
    setCurrentUser(null);
    setUsers([]);
    setContacts([]);
    setUserSettings(null);
    setChats([]);
    setPinnedMessagesByChat(new Map());
    setActiveChatId(null);
    setShowProfileSettings(false);
    readSyncKeyByChatRef.current = {};
    hasLoadedChatsRef.current = false;
    chatsByIdRef.current = new Map();
    messagesLoadInFlightRef.current = {};
    messagesLoadedByChatRef.current = {};
    messagesHasMoreByChatRef.current = {};
    urlChatIdRef.current = null;
    writeChatIdToUrl(null);
    setIsInitialChatsLoading(false);
    setIsChatsRefreshing(false);
    notify(t('Signed out'), 'info');
  }, [notify, t]);

  const loadPinnedMessages = useCallback(async (chatId: string) => {
    try {
      const data = await apiClient.listPinnedMessages(chatId);
      const pinned = (data.messages || []).filter(m => m.type !== 'system').map(toUiMessage);
      setPinnedMessagesByChat(prev => {
        const next = new Map(prev);
        next.set(chatId, pinned);
        return next;
      });
    } catch (err) {
      console.error('Failed to load pinned messages:', err);
    }
  }, []);

  const selectChat = useCallback(
    (chatId: string) => {
      urlChatIdRef.current = chatId;
      setActiveChatId(chatId);
      void loadMessages(chatId).catch(error => {
        notify(localizeError(error, 'Failed to load messages'), 'error');
      });
      void loadPinnedMessages(chatId);
    },
    [loadMessages, loadPinnedMessages, localizeError, notify]
  );

  const startDirectChat = useCallback(
    async (userId: string) => {
      const data = await apiClient.getDirectChat(userId);
      const chat = upsertFromApiChat(data.chat);
      if (chat) {
        setActiveChatId(chat.id);
        await loadMessages(chat.id);
      }
    },
    [loadMessages, upsertFromApiChat]
  );

  const createGroup = useCallback(
    async (name: string, participantIds: string[]) => {
      const data = await apiClient.createGroup(name, participantIds);
      const chat = upsertFromApiChat(data.group || data.chat);
      if (chat) {
        setActiveChatId(chat.id);
      }
    },
    [upsertFromApiChat]
  );

  const updatePreferences = useCallback(
    async (chat: Chat, patch: { isPinned?: boolean; isMuted?: boolean; mutedUntil?: string | null }) => {
      const data = await apiClient.updateChatPreferences(chat.id, patch);
      upsertFromApiChat(data.chat);
    },
    [upsertFromApiChat]
  );

  const handleSearchChats = useCallback(
    async (query: string) => {
      if (!currentUser) return;
      await hydrateChats(currentUser, query);
    },
    [currentUser, hydrateChats]
  );

  const upsertContact = useCallback(
    async (userId: string, customName?: string | null, isFavorite?: boolean) => {
      await apiClient.upsertContact(userId, customName, isFavorite);
      await refreshContactsDirectory();
      await refreshUsersDirectory();
    },
    [refreshContactsDirectory, refreshUsersDirectory]
  );

  const removeContact = useCallback(
    async (userId: string) => {
      await apiClient.removeContact(userId);
      await refreshContactsDirectory();
      await refreshUsersDirectory();
    },
    [refreshContactsDirectory, refreshUsersDirectory]
  );

  const blockContact = useCallback(
    async (userId: string) => {
      await apiClient.blockContact(userId);
      await refreshContactsDirectory();
      await refreshUsersDirectory();
    },
    [refreshContactsDirectory, refreshUsersDirectory]
  );

  const unblockContact = useCallback(
    async (userId: string) => {
      await apiClient.unblockContact(userId);
      await refreshContactsDirectory();
      await refreshUsersDirectory();
    },
    [refreshContactsDirectory, refreshUsersDirectory]
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      await apiClient.deleteUser(userId);
      await refreshContactsDirectory();
      await refreshUsersDirectory();
      if (currentUser) {
        await hydrateChats(currentUser);
      }

      const currentlyActiveChatId = activeChatIdRef.current;
      if (!currentlyActiveChatId) return;
      const currentlyActiveChat = chatsByIdRef.current.get(currentlyActiveChatId);
      if (!currentlyActiveChat) return;
      const deletedUserInActivePrivateChat =
        currentlyActiveChat.type === 'private' && currentlyActiveChat.participants.some(participant => participant.id === userId);
      if (deletedUserInActivePrivateChat) {
        setActiveChatId(null);
      }
    },
    [currentUser, hydrateChats, refreshContactsDirectory, refreshUsersDirectory]
  );

  const lookupUserByUserid = useCallback(async (userid: string) => {
    const data = await apiClient.lookupUserByUserid(userid);
    const foundUser = normalizeUser(data.user);
    setUsers(prev => mergeUsersById(prev, [foundUser]));
    return foundUser;
  }, []);

  const loadUserProfile = useCallback(async (userId: string) => {
    const data = await apiClient.getUserById(userId);
    const foundUser = normalizeUser(data.user);
    setUsers(prev => mergeUsersById(prev, [foundUser]));
    return foundUser;
  }, []);

  const withActiveChat = () => {
    if (!activeChat) {
      throw new Error('No active chat selected');
    }
    return activeChat;
  };

  const sendMessage = useCallback(
    async (content: string, replyToId?: string, clientMessageId?: string) => {
      const chat = withActiveChat();
      if (!currentUser) return;

      const tempId = clientMessageId || `temp-${Date.now()}`;
      const optimisticMessage: Message = {
        id: tempId,
        text: content,
        senderId: currentUser.id,
        timestamp: new Date().toISOString(),
        isRead: false,
        isDelivered: false,
        replyToId,
        type: 'text',
        seenBy: [],
        reactions: []
      };

      setChats(prev =>
        prev.map(item =>
          item.id === chat.id
            ? {
              ...item,
              messages: [...item.messages, optimisticMessage],
              lastMessage: optimisticMessage,
              lastActivityAt: optimisticMessage.timestamp
            }
            : item
        )
      );

      try {
        const data = await apiClient.sendMessage(chat.id, chat.type === 'group', content, replyToId, tempId);
        const message = toUiMessage(data.message);

        setChats(prev =>
          prev.map(item =>
            item.id === chat.id
              ? {
                ...item,
                messages: item.messages.map(m => m.id === tempId ? message : m),
                lastMessage: item.lastMessage?.id === tempId ? message : item.lastMessage
              }
              : item
          )
        );
      } catch (err) {
        setChats(prev =>
          prev.map(item =>
            item.id === chat.id
              ? {
                ...item,
                messages: item.messages.filter(m => m.id !== tempId),
                lastMessage: item.lastMessage?.id === tempId ? (item.messages.filter(m => m.id !== tempId).slice(-1)[0] || undefined) : item.lastMessage
              }
              : item
          )
        );
        throw err;
      }
    },
    [activeChat, currentUser]
  );

  const sendMedia = useCallback(
    async (
      file: File,
      caption?: string,
      replyToId?: string,
      options?: {
        onProgress?: (percent: number) => void;
        signal?: AbortSignal;
        kind?: 'voice' | 'audio' | 'photo' | 'video';
        durationMs?: number;
      },
      clientMessageId?: string
    ) => {
      const chat = withActiveChat();
      if (!currentUser) return;

      const tempId = clientMessageId || `temp-${Date.now()}`;

      try {
        if (!options?.onProgress) {
          const data = await apiClient.sendMedia(
            chat.id,
            chat.type === 'group',
            file,
            caption,
            replyToId,
            {
              kind: options?.kind,
              durationMs: options?.durationMs
            },
            tempId
          );
          const message = toUiMessage(data.message);
          setChats(prev =>
            prev.map(item => {
              if (item.id !== chat.id) return item;
              const alreadyExists = item.messages.some(m => m.id === message.id);
              if (alreadyExists) return item;
              return {
                ...item,
                messages: [...item.messages, message],
                lastMessage: message,
                lastActivityAt: message.timestamp
              };
            })
          );
          return;
        }

        const xhr = new XMLHttpRequest();
        const url = `${apiClient.getApiBase()}${chat.type === 'group' ? '/groups' : '/chats'}/${chat.id}/media`;
        const csrfToken = apiClient.getCsrfToken();
        const form = new FormData();
        if (options?.kind) form.append('kind', options.kind);
        if (caption) form.append('caption', caption);
        if (replyToId) form.append('replyToId', replyToId);
        form.append('clientMessageId', tempId);
        if (typeof options?.durationMs === 'number' && Number.isFinite(options.durationMs)) {
          form.append('durationMs', String(Math.max(1, Math.round(options.durationMs))));
        }
        form.append('file', file);

        const payload = await new Promise<any>((resolve, reject) => {
          xhr.open('POST', url);
          xhr.withCredentials = true;
          if (csrfToken) {
            xhr.setRequestHeader('X-CSRF-Token', csrfToken);
          }

          xhr.upload.onprogress = event => {
            if (!event.lengthComputable) return;
            options.onProgress?.(Math.round((event.loaded / event.total) * 100));
          };

          xhr.onerror = () => reject(new Error('Upload failed'));
          xhr.onload = () => {
            const parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {};
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(parsed);
              return;
            }
            reject(new Error(parsed?.message || 'Upload failed'));
          };
          xhr.send(form);
        });

        const message = toUiMessage(payload.message);
        setChats(prev =>
          prev.map(item => {
            if (item.id !== chat.id) return item;
            const alreadyExists = item.messages.some(m => m.id === message.id);
            if (alreadyExists) return item;
            return {
              ...item,
              messages: [...item.messages, message],
              lastMessage: message,
              lastActivityAt: message.timestamp
            };
          })
        );
      } catch (err) {
        throw err;
      }
    },
    [activeChat, currentUser]
  );

  const editMessage = useCallback(async (messageId: string, content: string, replyToId?: string) => {
    const data = await apiClient.editMessage(messageId, content, replyToId);
    const next = toUiMessage(data.message);

    setChats(prev =>
      prev.map(chat => ({
        ...chat,
        messages: chat.messages.map(message => (message.id === messageId ? next : message)),
        lastMessage: chat.lastMessage?.id === messageId ? next : chat.lastMessage
      }))
    );
  }, []);

  const deleteMessage = useCallback(async (messageId: string) => {
    await apiClient.deleteMessage(messageId);
    setChats(prev =>
      prev.map(chat => {
        const messages = chat.messages.filter(message => message.id !== messageId);
        return {
          ...chat,
          messages,
          lastMessage: chat.lastMessage?.id === messageId ? messages[messages.length - 1] : chat.lastMessage
        };
      })
    );
  }, []);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!currentUser) return;
      const targetMessage = chats.flatMap(chat => chat.messages).find(message => message.id === messageId);
      const reacted = targetMessage?.reactions?.some(
        reaction => reaction.emoji === emoji && reaction.userIds.includes(currentUser.id)
      );

      const data = reacted
        ? await apiClient.removeReaction(messageId, emoji)
        : await apiClient.addReaction(messageId, emoji);
      const next = toUiMessage(data.message);

      setChats(prev =>
        prev.map(chat => ({
          ...chat,
          messages: chat.messages.map(message => (message.id === messageId ? next : message)),
          lastMessage: chat.lastMessage?.id === messageId ? next : chat.lastMessage
        }))
      );
    },
    [chats, currentUser]
  );

  const pinMessage = useCallback(
    async (chatId: string, messageId: string) => {
      const data = await apiClient.pinMessage(chatId, messageId);
      const next = toUiMessage(data.message);
      // Update the message in chats
      setChats(prev =>
        prev.map(chat => ({
          ...chat,
          messages: chat.messages.map(m => (m.id === messageId ? next : m)),
          lastMessage: chat.lastMessage?.id === messageId ? next : chat.lastMessage
        }))
      );
      // Refresh pinned messages for this chat
      await loadPinnedMessages(chatId);
    },
    [loadPinnedMessages]
  );

  const unpinMessage = useCallback(
    async (chatId: string, messageId: string) => {
      const data = await apiClient.unpinMessage(chatId, messageId);
      const next = toUiMessage(data.message);
      // Update the message in chats
      setChats(prev =>
        prev.map(chat => ({
          ...chat,
          messages: chat.messages.map(m => (m.id === messageId ? next : m)),
          lastMessage: chat.lastMessage?.id === messageId ? next : chat.lastMessage
        }))
      );
      // Refresh pinned messages for this chat
      await loadPinnedMessages(chatId);
    },
    [loadPinnedMessages]
  );

  const loadGroupMembers = useCallback(async (chatId: string) => {
    const data = await apiClient.getGroupMembers(chatId);
    const members = (data.members || []).map(member => ({
      ...member,
      user: normalizeUser(member.user)
    })) as GroupMember[];
    setUsers(prev => mergeUsersById(prev, members.map(member => member.user)));
    return members;
  }, []);

  const addGroupMembers = useCallback(
    async (chatId: string, userIds: string[]) => {
      const data = await apiClient.addGroupMembers(chatId, userIds);
      upsertFromApiChat(data.group);
      await hydrateChats(currentUser!, '');
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const removeGroupMember = useCallback(
    async (chatId: string, userId: string) => {
      const data = await apiClient.removeGroupMember(chatId, userId);
      upsertFromApiChat(data.group);
      await hydrateChats(currentUser!, '');
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const updateGroupRole = useCallback(
    async (chatId: string, userId: string, role: 'ADMIN' | 'MEMBER') => {
      const data = await apiClient.updateGroupMemberRole(chatId, userId, role);
      upsertFromApiChat(data.group);
      await hydrateChats(currentUser!, '');
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const banGroupMember = useCallback(
    async (chatId: string, userId: string) => {
      const data = await apiClient.banGroupMember(chatId, userId);
      upsertFromApiChat(data.group);
      await hydrateChats(currentUser!, '');
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const unbanGroupMember = useCallback(
    async (chatId: string, userId: string) => {
      const data = await apiClient.unbanGroupMember(chatId, userId);
      upsertFromApiChat(data.group);
      await hydrateChats(currentUser!, '');
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const transferOwnership = useCallback(
    async (chatId: string, userId: string) => {
      const data = await apiClient.transferOwnership(chatId, userId);
      upsertFromApiChat(data.group);
      await hydrateChats(currentUser!, '');
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const updateGroupDetails = useCallback(
    async (chatId: string, payload: { name?: string }) => {
      const data = await apiClient.updateGroup(chatId, payload);
      upsertFromApiChat(data.group || data.chat);
      if (currentUser) {
        await hydrateChats(currentUser, '');
      }
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const uploadGroupAvatar = useCallback(
    async (chatId: string, file: File) => {
      const data = await apiClient.uploadGroupAvatar(chatId, file);
      upsertFromApiChat(data.group || data.chat);
      if (currentUser) {
        await hydrateChats(currentUser, '');
      }
    },
    [currentUser, hydrateChats, upsertFromApiChat]
  );

  const deleteGroup = useCallback(
    async (chatId: string) => {
      await apiClient.deleteGroup(chatId);
      setChats(prev => prev.filter(chat => chat.id !== chatId));
      setActiveChatId(prev => (prev === chatId ? null : prev));
      if (currentUser) {
        await hydrateChats(currentUser, '');
      }
    },
    [currentUser, hydrateChats]
  );

  const leaveGroup = useCallback(
    async (chatId: string) => {
      await apiClient.leaveGroup(chatId);
      setChats(prev => prev.filter(chat => chat.id !== chatId));
      setActiveChatId(prev => (prev === chatId ? null : prev));
      if (currentUser) {
        await hydrateChats(currentUser, '');
      }
    },
    [currentUser, hydrateChats]
  );

  const searchChatMessages = useCallback(async (chatId: string, isGroup: boolean, query: string) => {
    const response = await apiClient.searchMessages(chatId, isGroup, query);
    return (response.messages || []).map(toUiMessage);
  }, []);

  const syncCurrentUserFromServer = useCallback(async () => {
    const me = await apiClient.getMe();
    const normalized = normalizeUser(me.user);
    setCurrentUser(normalized);
    setUsers(prevUsers => {
      const nextUsers = mergeUsersById(prevUsers.filter(user => user.id !== normalized.id), [normalized]);
      setChats(prevChats => applyUsersToChats(prevChats, nextUsers));
      return nextUsers;
    });
    return normalized;
  }, []);

  const updateMyName = useCallback(
    async (name: string) => {
      await apiClient.updateMe({ name });
      await syncCurrentUserFromServer();
    },
    [syncCurrentUserFromServer]
  );

  const uploadMyAvatar = useCallback(
    async (file: File) => {
      await apiClient.uploadMyAvatar(file);
      await syncCurrentUserFromServer();
    },
    [syncCurrentUserFromServer]
  );

  const [isLoadingOlder, setIsLoadingOlder] = useState<Record<string, boolean>>({});

  const loadOlderMessages = useCallback(async (chatId: string) => {
    const chat = chatsByIdRef.current.get(chatId);
    if (!chat || !chat.hasMore || !chat.nextCursor) return;
    if (isLoadingOlder[chatId]) return;

    setIsLoadingOlder(prev => ({ ...prev, [chatId]: true }));
    try {
      const data = await apiClient.getMessages(chat.id, chat.type === 'group', chat.nextCursor);
      const newMessages = (data.messages || []).map(toUiMessage);

      setChats(prev =>
        prev.map(item => {
          if (item.id !== chatId) return item;
          const existingIds = new Set(item.messages.map(m => m.id));
          const filteredNew = newMessages.filter(m => !existingIds.has(m.id));
          return {
            ...item,
            messages: [...filteredNew, ...item.messages],
            nextCursor: data.nextCursor,
            hasMore: Boolean(data.nextCursor)
          };
        })
      );
    } catch (error) {
      notify(localizeError(error, 'Failed to load older messages'), 'error');
    } finally {
      setIsLoadingOlder(prev => ({ ...prev, [chatId]: false }));
    }
  }, [isLoadingOlder, localizeError, notify]);

  useEffect(() => {
    if (!currentUser || !activeChatId) return;
    if (!chatsByIdRef.current.has(activeChatId)) return;
    if (messagesLoadedByChatRef.current[activeChatId]) return;

    void loadMessages(activeChatId).catch(error => {
      notify(localizeError(error, 'Failed to load messages'), 'error');
    });
  }, [activeChatId, chats, currentUser, loadMessages, localizeError, notify]);

  useChatSocket({
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
  });

  useReadSync({
    currentUser,
    activeChat,
    activeChatIdRef,
    chatsByIdRef,
    readSyncKeyByChatRef,
    isWindowFocusedRef,
    setChats
  });

  const handleTypingStart = useCallback((chatId: string) => {
    socketRef.current?.emit('typing_start', { chatId });
  }, []);

  const handleTypingStop = useCallback((chatId: string) => {
    socketRef.current?.emit('typing_stop', { chatId });
  }, []);

  return (
    <AppShell
      isBootstrapping={isBootstrapping}
      loadingText={t('Loading Nexus Messenger...')}
      emptyStateText={t('Select a chat to start messaging.')}
      language={language}
      theme={theme}
      currentUser={currentUser}
      isAuthLoading={isAuthLoading}
      onLogin={handleLogin}
      onRegister={handleRegister}
      chats={chats}
      users={users}
      contacts={contacts}
      activeChatId={activeChatId}
      activeChat={activeChat}
      isMobile={isMobile}
      isInitialChatsLoading={isInitialChatsLoading}
      isChatsRefreshing={isChatsRefreshing}
      onChatSelect={selectChat}
      onStartChat={startDirectChat}
      onCreateGroup={createGroup}
      onToggleTheme={toggleThemeFromSidebar}
      onToggleLanguage={toggleLanguage}
      onTogglePin={chat => updatePreferences(chat, { isPinned: !chat.isPinned })}
      onToggleMute={chat => updatePreferences(chat, { isMuted: !chat.isMuted })}
      onSearchChats={handleSearchChats}
      onLogout={handleLogout}
      onOpenProfileSettings={() => setShowProfileSettings(true)}
      onNotify={notify}
      onUpsertContact={upsertContact}
      onRemoveContact={removeContact}
      onBlockContact={blockContact}
      onUnblockContact={unblockContact}
      onDeleteUser={deleteUser}
      onLookupUserByUserid={lookupUserByUserid}
      onUpdateMediaLimits={setMediaLimits}
      onBack={() => setActiveChatId(null)}
      onSendMessage={sendMessage}
      onSendMedia={sendMedia}
      onEditMessage={editMessage}
      onDeleteMessage={deleteMessage}
      onToggleReaction={toggleReaction}
      onPinMessage={pinMessage}
      onUnpinMessage={unpinMessage}
      pinnedMessagesByChat={pinnedMessagesByChat}
      onTypingStart={handleTypingStart}
      onTypingStop={handleTypingStop}
      onSearchMessages={searchChatMessages}
      onLoadGroupMembers={loadGroupMembers}
      onAddGroupMembers={addGroupMembers}
      onRemoveGroupMember={removeGroupMember}
      onUpdateGroupMemberRole={updateGroupRole}
      onBanGroupMember={banGroupMember}
      onUnbanGroupMember={unbanGroupMember}
      onTransferOwnership={transferOwnership}
      onUpdateGroupDetails={updateGroupDetails}
      onUploadGroupAvatar={uploadGroupAvatar}
      onDeleteGroup={deleteGroup}
      onLeaveGroup={leaveGroup}
      onLoadUserProfile={loadUserProfile}
      mediaLimits={mediaLimits}
      onLoadOlderMessages={loadOlderMessages}
      isLoadingOlder={isLoadingOlder}
      showProfileSettings={showProfileSettings}
      settings={userSettings}
      onCloseProfileSettings={() => setShowProfileSettings(false)}
      onSaveName={updateMyName}
      onUploadAvatar={uploadMyAvatar}
      onLoadSettings={loadMySettings}
      onSaveSettings={saveMySettings}
      onListSessions={listMySessions}
      onTerminateSession={terminateMySession}
      onLogoutCurrentSession={handleLogout}
      toasts={toasts}
    />
  );
}
