export type ThemeMode = 'light' | 'dark';
export type AppLocale = 'en' | 'fa';

export type GroupMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type GroupMemberState = 'ACTIVE' | 'KICKED' | 'BANNED' | 'LEFT';

export interface User {
  id: string;
  name: string;
  username: string;
  email?: string;
  phone?: string;
  avatar?: string;
  avatarColor?: string;
  role: string;
  status: string;
  isOnline: boolean;
  lastSeenAt?: string;
  isRoot: boolean;
  registrationStatus?: 'pending' | 'active' | 'rejected';
}

export interface Contact {
  id: string;
  userId: string;
  customName?: string;
  isBlocked: boolean;
  isFavorite: boolean;
  blockedAt?: string;
  createdAt: string;
  user: User;
}

export interface GroupCapabilities {
  canEditGroup: boolean;
  canDeleteGroup: boolean;
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canBanMembers: boolean;
  canPromoteAdmins: boolean;
  canDemoteAdmins: boolean;
  canTransferOwnership: boolean;
  canLeaveGroup: boolean;
  canReadMessages: boolean;
  canSendMessages: boolean;
  canDeleteMessages?: boolean;
  canPinMessages?: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface MessageReplyPreview {
  id: string;
  senderId: string;
  content: string;
  type: 'text' | 'system' | 'image' | 'video' | 'audio';
  mediaName?: string;
}

export interface Message {
  id: string;
  text: string;
  senderId: string;
  timestamp: string;
  isRead: boolean;
  isDelivered: boolean;
  replyToId?: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'system';
  mediaUrl?: string;
  mediaName?: string;
  mediaMime?: string;
  mediaSizeBytes?: number;
  isVoice?: boolean;
  voiceDurationMs?: number;
  seenBy: string[];
  readCount?: number;
  readByAll?: boolean;
  reactions?: Reaction[];
  isEdited?: boolean;
  editedAt?: string;
  replyTo?: MessageReplyPreview;
  clientMessageId?: string;
  isPinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
}

export interface Chat {
  id: string;
  type: 'private' | 'group' | 'saved';
  name: string;
  participants: User[];
  messages: Message[];
  unreadCount: number;
  lastMessage?: Message;
  isTyping?: boolean;
  typingUsers?: string[];
  isPinned?: boolean;
  pinnedAt?: string;
  isMuted?: boolean;
  mutedUntil?: string;
  avatarUrl?: string;
  myRole?: GroupMemberRole;
  myState?: GroupMemberState;
  capabilities?: GroupCapabilities;
  defaultPermissions?: { canPinMessages?: boolean };
  lastActivityAt?: string;
  nextCursor?: string;
  hasMore?: boolean;
}

export interface GroupMember {
  userId: string;
  role: GroupMemberRole;
  state: GroupMemberState;
  createdAt: string;
  updatedAt: string;
  user: User;
  permissions?: Record<string, boolean>;
}

export interface ApiMessage {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  type: 'text' | 'system' | 'image' | 'video' | 'audio';
  replyToId?: string;
  replyTo?: MessageReplyPreview;
  mediaUrl?: string;
  mediaMime?: string;
  mediaName?: string;
  mediaSizeBytes?: number;
  isVoice?: boolean;
  voiceDurationMs?: number;
  seenBy: string[];
  readCount?: number;
  readByAll?: boolean;
  reactions?: Reaction[];
  isEdited?: boolean;
  editedAt?: string;
  isRead?: boolean;
  isDelivered?: boolean;
  clientMessageId?: string;
  isPinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiChat {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  avatar?: string;
  creatorId?: string;
  participants: string[];
  myRole?: GroupMemberRole;
  myState?: GroupMemberState;
  capabilities?: GroupCapabilities;
  defaultPermissions?: { canPinMessages?: boolean };
  messages?: ApiMessage[];
  unreadCount: number;
  lastMessage?: ApiMessage;
  lastReadMessageId?: string;
  lastReadAt?: string;
  typingUsers?: string[];
  lastActivityAt?: string;
  isPinned?: boolean;
  pinnedAt?: string;
  isMuted?: boolean;
  mutedUntil?: string;
}

export interface ToastMessage {
  id: string;
  text: string;
  kind: 'success' | 'error' | 'info';
}

export interface MediaLimits {
  voice: number;
  audio: number;
  photo: number;
  video: number;
}

export const AVATAR_COLORS = ['#4fa0ff', '#f28a30', '#8f7dfa', '#45c6a7', '#f56d8f', '#7ecb63', '#5ca7f7'];

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}


