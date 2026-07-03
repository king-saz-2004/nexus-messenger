import type { JsonObject, JsonValue } from '../../config/sql.js';
import type { GroupActorContext, GroupCapabilities, PermissionKey, PermissionSet } from './types.js';

const permissionKeys: PermissionKey[] = [
  'can_change_info',
  'can_delete_messages',
  'can_ban_users',
  'can_invite_users',
  'can_pin_messages',
  'can_promote_members',
  'can_manage_calls',
  'can_manage_chat',
  'is_anonymous'
];

export const defaultAdminPermissions: PermissionSet = {
  can_change_info: false,
  can_delete_messages: true,
  can_ban_users: true,
  can_invite_users: true,
  can_pin_messages: false,
  can_promote_members: false,
  can_manage_calls: false,
  can_manage_chat: false,
  is_anonymous: false
};

export const defaultMemberPermissions: PermissionSet = {
  can_change_info: false,
  can_delete_messages: false,
  can_ban_users: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_promote_members: false,
  can_manage_calls: false,
  can_manage_chat: false,
  is_anonymous: false
};



const isPermissionMap = (value: JsonValue | null | undefined): value is JsonObject => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const toPermissionSet = (value: JsonValue | null | undefined): PermissionSet => {
  const normalized: PermissionSet = { ...defaultMemberPermissions };
  if (!isPermissionMap(value)) {
    return normalized;
  }

  for (const key of permissionKeys) {
    const raw = value[key];
    if (typeof raw === 'boolean') {
      normalized[key] = raw;
    }
  }

  return normalized;
};

export const canActorManageTargetRole = (actorRole: string, targetRole: string) => {
  if (actorRole === 'owner') {
    return targetRole !== 'owner';
  }
  if (actorRole === 'admin') {
    return targetRole === 'member' || targetRole === 'restricted' || targetRole === 'banned' || targetRole === 'left';
  }
  return false;
};

export const buildGroupCapabilities = (role: string, status: string, permissions: PermissionSet, defaultPermissions?: JsonValue | null): GroupCapabilities => {
  const active = status === 'active';
  const owner = active && role === 'owner';
  const admin = active && role === 'admin';
  const dp = defaultPermissions && typeof defaultPermissions === 'object' && !Array.isArray(defaultPermissions)
    ? defaultPermissions as Record<string, unknown>
    : undefined;

  return {
    canEditGroup: owner || (admin && (permissions.can_change_info || permissions.can_manage_chat)),
    canDeleteGroup: owner,
    canInviteMembers: owner || (admin && permissions.can_invite_users),
    canRemoveMembers: owner || (admin && permissions.can_ban_users),
    canBanMembers: owner || (admin && permissions.can_ban_users),
    canPromoteAdmins: owner || (admin && permissions.can_promote_members),
    canDemoteAdmins: owner || (admin && permissions.can_promote_members),
    canTransferOwnership: owner,
    canLeaveGroup: active && !owner,
    canReadMessages: active,
    canSendMessages: active,
    canDeleteMessages: owner || (admin && permissions.can_delete_messages),
    canPinMessages: owner || admin || (active && dp?.can_pin_messages !== false)
  };
};

export const canActorInviteMembers = (context: GroupActorContext) => {
  if (context.actor_role === 'owner') {
    return true;
  }
  if (context.actor_role !== 'admin') {
    return false;
  }
  return toPermissionSet(context.actor_permissions).can_invite_users;
};

export const canActorBanMembers = (context: GroupActorContext) => {
  if (context.actor_role === 'owner') {
    return true;
  }
  if (context.actor_role !== 'admin') {
    return false;
  }
  return toPermissionSet(context.actor_permissions).can_ban_users;
};

export const canActorPromoteMembers = (context: GroupActorContext) => {
  if (context.actor_role === 'owner') {
    return true;
  }
  if (context.actor_role !== 'admin') {
    return false;
  }
  return toPermissionSet(context.actor_permissions).can_promote_members;
};
