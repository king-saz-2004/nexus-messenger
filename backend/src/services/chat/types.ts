import type { DbExecutor } from '../../config/dbContext.js';
import type { JsonValue } from '../../config/sql.js';

export type TxClient = DbExecutor;

export type ChatDto = {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  avatar?: string;
  creatorId?: string;
  participants: string[];
  myRole?: string;
  myState?: string;
  capabilities?: {
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
    canDeleteMessages: boolean;
    canPinMessages: boolean;
  };
  unreadCount: number;
  lastMessage?: {
    id: string;
    chatId: string;
    senderId: string;
    content: string;
    type: string;
    replyToId?: string;
    mediaUrl?: string;
    mediaMime?: string;
    mediaName?: string;
    mediaSizeBytes?: number;
    seenBy: string[];
    reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
    isEdited: boolean;
    editedAt?: string;
    isDelivered: boolean;
    isRead: boolean;
    readCount: number;
    readByAll: boolean;
    createdAt?: string;
    updatedAt?: string;
  };
  lastReadMessageId?: string;
  lastReadAt?: string;
  typingUsers: string[];
  lastActivityAt?: string;
  isPinned: boolean;
  pinnedAt?: string;
  isMuted: boolean;
  mutedUntil?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ChatListRow = {
  id: string;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title: string | null;
  description: string | null;
  avatar_url: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  member_count: number | null;
  my_role: string;
  my_status: string;
  my_permissions: JsonValue | null;
  default_permissions: JsonValue | null;
  is_pinned: boolean;
  pin_order: number;
  is_muted: boolean;
  mute_until: Date | string | null;
  last_read_message_id: string | null;
  last_read_at: Date | string | null;
  unread_count: number;
  last_message_id: string | null;
  last_message_chat_id: string | null;
  last_message_sender_id: string | null;
  last_message_type: string | null;
  last_message_content: string | null;
  last_message_media: JsonValue | null;
  last_message_reply_to_id: string | null;
  last_message_is_edited: boolean | null;
  last_message_edited_at: Date | string | null;
  last_message_created_at: Date | string | null;
  last_message_updated_at: Date | string | null;
  last_message_seen_by: string[] | null;
};

export type ParticipantRow = {
  chat_id: string;
  user_id: string;
  avatar_url: string | null;
};

export type UserLookupRow = {
  id: string;
};

export type ExistingChatRow = {
  id: string;
};

export type MembershipCheckRow = {
  id: string;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  role: string;
  permissions: JsonValue | null;
};

export type GroupMemberRow = {
  user_id: string;
  role: string;
  status: string;
  joined_at: Date | string;
  updated_at: Date | string;
  id: string;
  username: string;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  user_status: string;
  last_seen: Date | string | null;
  permissions: JsonValue | null;
};

export type PermissionKey =
  | 'can_change_info'
  | 'can_delete_messages'
  | 'can_ban_users'
  | 'can_invite_users'
  | 'can_pin_messages'
  | 'can_promote_members'
  | 'can_manage_calls'
  | 'can_manage_chat'
  | 'is_anonymous';

export type PermissionSet = Record<PermissionKey, boolean>;

export type GroupCapabilities = {
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
  canDeleteMessages: boolean;
  canPinMessages: boolean;
};

export type GroupActorContext = {
  chat_id: string;
  actor_role: string;
  actor_status: string;
  actor_permissions: JsonValue | null;
};

export type ChatMemberRow = {
  user_id: string;
  role: string;
  status: string;
  permissions: JsonValue | null;
};

export type UuidRow = {
  id: string;
};

export type LoadChatOptions = {
  chatId?: string;
  query?: string;
};

export type CreateGroupPayload = {
  title: string;
  description?: string | null;
  avatarUrl?: string | null;
  participantIds?: string[];
};

export type UpdateChatPayload = {
  title?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  defaultPermissions?: { canPinMessages?: boolean };
};

export type UpdateChatPreferencesPayload = {
  isPinned?: boolean;
  isMuted?: boolean;
  mutedUntil?: string | null;
};

export type UpdateGroupMemberRolePayload = {
  role: 'ADMIN' | 'MEMBER';
};

export type UpdateGroupMemberPermissionsPayload = Partial<
  Record<
    | 'canChangeInfo'
    | 'canDeleteMessages'
    | 'canBanUsers'
    | 'canInviteUsers'
    | 'canPinMessages'
    | 'canPromoteMembers'
    | 'canManageCalls'
    | 'canManageChat'
    | 'isAnonymous',
    boolean
  >
>;

export type DeleteChatResult = {
  mode: 'group_deleted' | 'private_hidden';
};

export type GroupMemberDto = {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  state: 'ACTIVE' | 'KICKED' | 'BANNED' | 'LEFT';
  createdAt?: string;
  updatedAt?: string;
  user: {
    id: string;
    name: string;
    username: string;
    avatar?: string;
    role: 'USER';
    status: string;
    isOnline: boolean;
    lastSeenAt?: string;
    isRoot: false;
  };
};
