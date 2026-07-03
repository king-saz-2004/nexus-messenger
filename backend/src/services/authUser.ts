import { db } from '../config/db.js';
import type { DbExecutor } from '../config/dbContext.js';

const AVATAR_COLORS = ['#4fa0ff', '#f28a30', '#8f7dfa', '#45c6a7', '#f56d8f', '#7ecb63', '#5ca7f7'];

export type AuthUserRow = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  avatar_color: number | null;
  status: 'online' | 'offline' | 'recently' | 'away';
  last_seen: Date | string | null;
  is_root: boolean;
  is_active: boolean;
  is_deleted: boolean;
  registration_status?: 'pending' | 'active' | 'rejected';
  created_at: Date;
  updated_at: Date;
};

export type PublicUserRow = Omit<AuthUserRow, 'password_hash'>;

export type AuthUserDto = {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  name: string;
  firstName: string;
  lastName?: string;
  avatar?: string;
  avatarColor: string;
  status: string;
  isOnline: boolean;
  lastSeenAt?: string;
  role: 'USER';
  isRoot: boolean;
  registrationStatus?: 'pending' | 'active' | 'rejected';
};

export const getAvatarColorIndex = (userId: string) => {
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return hash % AVATAR_COLORS.length;
};

const getAvatarColorHex = (avatarColor: number | null, userId: string) => {
  const index = avatarColor ?? getAvatarColorIndex(userId);
  return AVATAR_COLORS[Math.abs(index) % AVATAR_COLORS.length];
};

const toIsoDateOrUndefined = (value: Date | string | null | undefined) => {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
};

export const toPublicUserDto = (user: PublicUserRow): AuthUserDto => {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return {
    id: user.id,
    username: user.username,
    name: fullName || user.first_name,
    firstName: user.first_name,
    lastName: user.last_name ?? undefined,
    avatar: user.avatar_url ?? undefined,
    avatarColor: getAvatarColorHex(user.avatar_color, user.id),
    status: user.status,
    isOnline: user.status === 'online',
    lastSeenAt: toIsoDateOrUndefined(user.last_seen),
    role: 'USER',
    isRoot: Boolean(user.is_root),
    registrationStatus: user.registration_status
  };
};

export const toAuthUserDto = (user: AuthUserRow): AuthUserDto => {
  const dto = toPublicUserDto(user);
  return {
    ...dto,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined
  };
};

export const getUserById = async (userId: string) => {
  return getUserByIdWithClient(db, userId);
};

export const getUserByIdWithClient = async (client: DbExecutor, userId: string) => {
  const rows = await client.$queryRaw<AuthUserRow[]>`
    SELECT
      id,
      username,
      email,
      phone,
      password_hash,
      first_name,
      last_name,
      avatar_url,
      avatar_color,
      status,
      last_seen,
      is_root,
      is_active,
      is_deleted,
      registration_status,
      created_at,
      updated_at
    FROM users
    WHERE id = ${userId}::uuid
    LIMIT 1
  `;

  return rows[0] ?? null;
};

export const getActiveUserById = async (userId: string) => {
  return getActiveUserByIdWithClient(db, userId);
};

export const getActiveUserByIdWithClient = async (client: DbExecutor, userId: string) => {
  const rows = await client.$queryRaw<AuthUserRow[]>`
    SELECT
      id,
      username,
      email,
      phone,
      password_hash,
      first_name,
      last_name,
      avatar_url,
      avatar_color,
      status,
      last_seen,
      is_root,
      is_active,
      is_deleted,
      registration_status,
      created_at,
      updated_at
    FROM users
    WHERE id = ${userId}::uuid
      AND is_active = true
      AND is_deleted = false
      AND registration_status = 'active'
    LIMIT 1
  `;

  return rows[0] ?? null;
};

export const getUserByUsername = async (username: string) => {
  return getUserByUsernameWithClient(db, username);
};

export const getUserByUsernameWithClient = async (client: DbExecutor, username: string) => {
  const normalized = username.trim().toLowerCase();
  const rows = await client.$queryRaw<AuthUserRow[]>`
    SELECT
      id,
      username,
      email,
      phone,
      password_hash,
      first_name,
      last_name,
      avatar_url,
      avatar_color,
      status,
      last_seen,
      is_root,
      is_active,
      is_deleted,
      registration_status,
      created_at,
      updated_at
    FROM users
    WHERE LOWER(username) = ${normalized}
      AND is_deleted = false
      AND is_active = true
      AND registration_status = 'active'
    LIMIT 1
  `;


  return rows[0] ?? null;
};

// Backward-compatible alias used by older scripts/routes.
export const getUserByIdentifier = async (identifier: string) => getUserByUsername(identifier);
export const getUserByIdentifierWithClient = async (client: DbExecutor, identifier: string) =>
  getUserByUsernameWithClient(client, identifier);
