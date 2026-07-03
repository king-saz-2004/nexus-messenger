import { joinSql, sql, type SqlFragment } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { loadSingleChat } from './queries.js';
import type { UpdateChatPreferencesPayload } from './types.js';

export const updateChatPreferences = async (actorId: string, chatId: string, payload: UpdateChatPreferencesPayload) => {
  return runAsUser(actorId, async tx => {
    const membershipRows = await tx.$queryRaw<{ chat_id: string }[]>`
      SELECT chat_id
      FROM chat_members
      WHERE chat_id = ${chatId}::uuid
        AND user_id = ${actorId}::uuid
        AND status = 'active'
      LIMIT 1
    `;

    if (membershipRows.length === 0) {
      return null;
    }

    const updates: SqlFragment[] = [];
    if (payload.isPinned !== undefined) {
      updates.push(sql`is_pinned = ${payload.isPinned}`);
      if (payload.isPinned) {
        const maxOrder = await tx.$queryRaw<[{ max: number }]>`
          SELECT COALESCE(MAX(pin_order), 0) + 1 AS max
          FROM chat_members
          WHERE user_id = ${actorId}::uuid AND is_pinned = true
        `;
        updates.push(sql`pin_order = ${maxOrder[0]?.max ?? 1}`);
      } else {
        updates.push(sql`pin_order = 0`);
      }
    }
    if (payload.isMuted !== undefined) {
      updates.push(sql`is_muted = ${payload.isMuted}`);
      if (payload.isMuted === false && payload.mutedUntil === undefined) {
        updates.push(sql`mute_until = NULL`);
      }
    }
    if (payload.mutedUntil !== undefined) {
      updates.push(sql`mute_until = ${payload.mutedUntil ? new Date(payload.mutedUntil) : null}`);
    }

    if (updates.length > 0) {
      await tx.$executeRaw(
        sql`
          UPDATE chat_members
          SET ${joinSql(updates, ', ')}
          WHERE chat_id = ${chatId}::uuid
            AND user_id = ${actorId}::uuid
        `
      );
    }

    return loadSingleChat(tx, actorId, chatId);
  });
};
