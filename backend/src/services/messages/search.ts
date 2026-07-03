import { sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { loadChatVisible } from './access.js';
import { toMessageDto } from './mappers.js';
import type { MessageRow } from './types.js';

/**
 * Escape LIKE/ILIKE special characters so that user-supplied search
 * strings are treated as literals, not patterns.
 * Characters escaped: % (match-any), _ (match-one), \ (escape char)
 */
const escapeLikePattern = (input: string): string =>
  input.replace(/[%_\\]/g, char => `\\${char}`);

export const searchMessages = async (
  actorId: string,
  chatId: string,
  q: string,
  limit: number,
  groupOnly = false
) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId, groupOnly);
    if (!chat) return null;

    const rows = await tx.$queryRaw<MessageRow[]>(
      sql`
        SELECT
          m.id,
          m.chat_id,
          m.sender_id,
          m.type,
          m.content,
          m.media,
          m.reply_to_id,
          m.is_edited,
          m.edited_at,
          m.created_at,
          m.updated_at,
          m.client_message_id,
          m.is_pinned,
          m.pinned_at,
          m.pinned_by,
          c.type AS chat_type,
          (SELECT COUNT(*)::int FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.status = 'active') AS chat_member_count,
          rm.id AS reply_id,
          rm.sender_id AS reply_sender_id,
          rm.content AS reply_content,
          rm.type AS reply_type,
          rm.media AS reply_media,
          COALESCE(
            (
              SELECT array_agg(mr.user_id::text ORDER BY mr.read_at)
              FROM message_reads mr
              WHERE mr.message_id = m.id
            ),
            ARRAY[]::text[]
          ) AS seen_by,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'emoji', grouped.emoji,
                  'count', grouped.reaction_count,
                  'userIds', grouped.user_ids
                )
                ORDER BY grouped.emoji
              )
              FROM (
                SELECT
                  mr.emoji,
                  COUNT(*)::int AS reaction_count,
                  array_agg(mr.user_id::text ORDER BY mr.created_at) AS user_ids
                FROM message_reactions mr
                WHERE mr.message_id = m.id
                GROUP BY mr.emoji
              ) grouped
            ),
            '[]'::jsonb
          ) AS reactions
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        LEFT JOIN messages rm ON rm.id = m.reply_to_id
        WHERE m.chat_id = ${chatId}::uuid
          AND m.is_deleted_for_all = false
          AND NOT (m.deleted_for ? ${actorId})
          AND m.content ILIKE ${`%${escapeLikePattern(q)}%`} ESCAPE '\\'
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${limit}
      `
    );
    return {
      messages: [...rows].reverse().map(toMessageDto)
    };
  });
};
