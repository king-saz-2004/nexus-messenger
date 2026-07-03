import { sql } from '../config/sql.js';
import { runAsUser } from '../config/dbContext.js';
import { emitToUser } from './rooms.js';
import type { PresenceUpdateRow } from './types.js';

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const listPresenceAudience = async (userId: string) => {
  const rows = await runAsUser(userId, tx =>
    tx.$queryRaw<Array<{ user_id: string }>>(
      sql`
        SELECT DISTINCT peer.user_id
        FROM chat_members self_member
        JOIN chat_members peer
          ON peer.chat_id = self_member.chat_id
        JOIN chats c
          ON c.id = self_member.chat_id
        WHERE self_member.user_id = ${userId}::uuid
          AND self_member.status = 'active'
          AND peer.status = 'active'
          AND peer.user_id <> ${userId}::uuid
          AND c.is_active = true
          AND c.is_deleted = false
      `
    )
  );
  return rows.map(row => row.user_id);
};

export const setPresenceState = async (userId: string, isOnline: boolean) => {
  const rows = await runAsUser(userId, tx =>
    tx.$queryRaw<PresenceUpdateRow[]>(
      sql`
        UPDATE users
        SET
          status = ${isOnline ? 'online' : 'offline'},
          last_seen = CASE WHEN ${isOnline} THEN last_seen ELSE NOW() END
        WHERE id = ${userId}::uuid
          AND is_active = true
          AND is_deleted = false
        RETURNING last_seen
      `
    )
  );
  return toIso(rows[0]?.last_seen);
};

export const broadcastPresence = async (userId: string, isOnline: boolean, lastSeenAt?: string | null) => {
  const audience = await listPresenceAudience(userId);
  const event = isOnline ? 'user_online' : 'user_offline';
  const payload = isOnline ? { userId } : { userId, lastSeenAt: lastSeenAt ?? null };

  for (const peerUserId of audience) {
    emitToUser(peerUserId, event, payload);
  }
};
