import { AVATAR_COLORS, ApiChat, ApiMessage, Chat, Message, User } from '../types';

import { API_BASE } from './config';

export type SystemChatLabels = {
  savedMessages: string;
  unknownUser: string;
  untitledGroup: string;
};

const defaultSystemChatLabels: SystemChatLabels = {
  savedMessages: 'Saved Messages',
  unknownUser: 'Unknown user',
  untitledGroup: 'Untitled Group'
};

const toBackendAbsoluteUrl = (value?: string) => {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith('/')) return value;
  return `${API_BASE}${value}`;
};

const resolveSystemLabels = (labels?: Partial<SystemChatLabels>): SystemChatLabels => ({
  ...defaultSystemChatLabels,
  ...labels
});

const buildPlaceholderUser = (userId: string, labels: SystemChatLabels): User =>
  normalizeUser({
    id: userId,
    name: labels.unknownUser,
    username: 'unknown',
    email: '',
    role: 'USER',
    status: 'offline',
    isOnline: false,
    isRoot: false
  });

export const getAvatarColor = (id: string) => {
  const sum = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
};

export const normalizeUser = (user: User): User => ({
  ...user,
  avatar: toBackendAbsoluteUrl(user.avatar) || undefined,
  avatarColor: user.avatarColor || getAvatarColor(user.id),
  isOnline: Boolean(user.isOnline)
});

export const normalizeUsers = (users: User[]) => users.map(normalizeUser);

export const mergeUsersById = (baseUsers: User[], incomingUsers: User[]) => {
  const map = new Map<string, User>();
  for (const user of baseUsers) {
    map.set(user.id, normalizeUser(user));
  }
  for (const user of incomingUsers) {
    map.set(user.id, normalizeUser(user));
  }
  return [...map.values()];
};

export const toUiMessage = (apiMessage: ApiMessage): Message => {
  if (!apiMessage) {
    return {
      id: '',
      text: '',
      senderId: '',
      timestamp: new Date().toISOString(),
      isRead: false,
      isDelivered: false,
      type: 'system',
      seenBy: []
    };
  }
  return {
    id: apiMessage.id || '',
    text: apiMessage.content ?? '',
    senderId: apiMessage.senderId || '',
    timestamp: apiMessage.createdAt || new Date().toISOString(),
    isRead: Boolean(apiMessage.isRead ?? apiMessage.isDelivered),
    isDelivered: Boolean(apiMessage.isDelivered),
    replyToId: apiMessage.replyToId,
    type: apiMessage.type || 'text',
    mediaUrl: toBackendAbsoluteUrl(apiMessage.mediaUrl),
    mediaMime: apiMessage.mediaMime,
    mediaName: apiMessage.mediaName,
    mediaSizeBytes: apiMessage.mediaSizeBytes,
    isVoice: apiMessage.isVoice,
    voiceDurationMs: apiMessage.voiceDurationMs,
    seenBy: apiMessage.seenBy ?? [],
    readCount: apiMessage.readCount,
    readByAll: apiMessage.readByAll,
    reactions: apiMessage.reactions ?? [],
    isEdited: apiMessage.isEdited,
    editedAt: apiMessage.editedAt,
    replyTo: apiMessage.replyTo,
    clientMessageId: apiMessage.clientMessageId,
    isPinned: apiMessage.isPinned,
    pinnedAt: apiMessage.pinnedAt,
    pinnedBy: apiMessage.pinnedBy
  };
};

const resolveDirectPartner = (
  chat: ApiChat,
  usersById: Map<string, User>,
  currentUser: User,
  labels: SystemChatLabels
) => {
  const partnerId = chat.participants.find(userId => userId !== currentUser.id);
  if (partnerId) {
    return usersById.get(partnerId) ?? buildPlaceholderUser(partnerId, labels);
  }
  return buildPlaceholderUser(`unknown-${chat.id}`, labels);
};

const resolveChatName = (
  chat: ApiChat,
  usersById: Map<string, User>,
  currentUser: User,
  uiType: Chat['type'],
  labels: SystemChatLabels
) => {
  if (uiType === 'saved') {
    return labels.savedMessages;
  }
  if (chat.type === 'group') {
    return chat.name ?? labels.untitledGroup;
  }
  const partner = resolveDirectPartner(chat, usersById, currentUser, labels);
  return partner.name;
};

export const toUiChat = (
  chat: ApiChat,
  usersById: Map<string, User>,
  currentUser: User,
  labels?: Partial<SystemChatLabels>
): Chat => {
  const resolvedLabels = resolveSystemLabels(labels);
  const isSavedChat =
    chat.name === defaultSystemChatLabels.savedMessages ||
    chat.name === resolvedLabels.savedMessages ||
    (chat.type === 'direct' && chat.participants.length === 1 && chat.participants[0] === currentUser.id);

  const type: Chat['type'] = isSavedChat ? 'saved' : chat.type === 'group' ? 'group' : 'private';

  const participants =
    chat.type === 'group'
      ? chat.participants.map(userId =>
        usersById.get(userId) ?? buildPlaceholderUser(userId, resolvedLabels)
      )
      : [resolveDirectPartner(chat, usersById, currentUser, resolvedLabels)];

  const messages = (chat.messages ?? []).map(toUiMessage);

  return {
    id: chat.id,
    type,
    name: resolveChatName(chat, usersById, currentUser, type, resolvedLabels),
    participants,
    messages,
    unreadCount: chat.unreadCount ?? 0,
    lastMessage: chat.lastMessage ? toUiMessage(chat.lastMessage) : undefined,
    isTyping: (chat.typingUsers ?? []).some(userId => userId !== currentUser.id),
    typingUsers: chat.typingUsers ?? [],
    isPinned: Boolean(chat.isPinned),
    pinnedAt: chat.pinnedAt,
    isMuted: Boolean(chat.isMuted),
    mutedUntil: chat.mutedUntil,
    avatarUrl: toBackendAbsoluteUrl(chat.avatar) ||
      (type === 'private' ? participants[0]?.avatar : undefined),
    myRole: chat.myRole,
    myState: chat.myState,
    capabilities: chat.capabilities,
    defaultPermissions: chat.defaultPermissions,
    lastActivityAt: chat.lastActivityAt ?? chat.lastMessage?.createdAt
  };
};

export const toUiChats = (
  apiChats: ApiChat[],
  users: User[],
  currentUser: User,
  labels?: Partial<SystemChatLabels>
) => {
  const usersById = new Map<string, User>(users.map(user => [user.id, normalizeUser(user)]));
  usersById.set(currentUser.id, normalizeUser(currentUser));
  return apiChats.map(chat => toUiChat(chat, usersById, currentUser, labels));
};

export const sortChats = (chats: Chat[]) => {
  return [...chats].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    const aTime = a.lastActivityAt
      ? new Date(a.lastActivityAt).getTime()
      : a.lastMessage
        ? new Date(a.lastMessage.timestamp).getTime()
        : 0;
    const bTime = b.lastActivityAt
      ? new Date(b.lastActivityAt).getTime()
      : b.lastMessage
        ? new Date(b.lastMessage.timestamp).getTime()
        : 0;

    return bTime - aTime;
  });
};

export const upsertChat = (chats: Chat[], nextChat: Chat) => {
  const withoutCurrent = chats.filter(chat => chat.id !== nextChat.id);
  return sortChats([nextChat, ...withoutCurrent]);
};

export const applyUsersToChats = (chats: Chat[], users: User[]) => {
  const usersById = new Map(users.map(user => [user.id, user]));
  return chats.map(chat => ({
    ...chat,
    participants: chat.participants.map(user => usersById.get(user.id) ?? user)
  }));
};

export const relabelSystemChats = (
  chats: Chat[],
  currentUser: User,
  labels?: Partial<SystemChatLabels>
) => {
  const resolvedLabels = resolveSystemLabels(labels);
  return chats.map(chat => {
    if (chat.type === 'saved') {
      return { ...chat, name: resolvedLabels.savedMessages };
    }

    if (chat.type === 'group') {
      const isUntitled =
        !chat.name ||
        chat.name === defaultSystemChatLabels.untitledGroup ||
        chat.name === resolvedLabels.untitledGroup;
      return isUntitled ? { ...chat, name: resolvedLabels.untitledGroup } : chat;
    }

    const participants = chat.participants.map(participant => {
      const isPlaceholder =
        participant.username === 'unknown' ||
        participant.id.startsWith('unknown-') ||
        participant.name === defaultSystemChatLabels.unknownUser ||
        participant.name === resolvedLabels.unknownUser;
      return isPlaceholder ? { ...participant, name: resolvedLabels.unknownUser } : participant;
    });

    const partner = participants.find(participant => participant.id !== currentUser.id);
    return {
      ...chat,
      participants,
      name: partner?.name ?? resolvedLabels.unknownUser
    };
  });
};
