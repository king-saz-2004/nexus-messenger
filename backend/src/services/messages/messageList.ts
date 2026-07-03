import { runAsUser } from '../../config/dbContext.js';
import { encodeCursor } from '../../utils/pagination.js';
import { loadChatVisible } from './access.js';
import { toMessageDto } from './mappers.js';
import { listRows, parseMessageCursor } from './queries.js';
import type { MessageListQuery } from './types.js';

export const listMessages = async (actorId: string, chatId: string, query: MessageListQuery, groupOnly = false) => {
  return runAsUser(actorId, async tx => {
    const chat = await loadChatVisible(tx, actorId, chatId, groupOnly);
    if (!chat) return null;

    const direction = query.direction ?? 'backward';
    const cursor = await parseMessageCursor(tx, actorId, chatId, query.cursor, direction);

    const rows = await listRows(tx, actorId, chatId, query.limit + 1, direction, cursor);
    const hasMore = rows.length > query.limit;
    const sliced = hasMore ? rows.slice(0, query.limit) : rows;
    const normalized = direction === 'forward' ? sliced : [...sliced].reverse();

    const lastRow = sliced[sliced.length - 1];
    let nextCursor: string | undefined = undefined;
    if (hasMore && lastRow) {
      nextCursor = encodeCursor({
        createdAt: new Date(lastRow.created_at).toISOString(),
        id: lastRow.id
      });
    }

    return {
      messages: normalized.map(toMessageDto),
      hasMore,
      nextCursor
    };
  });
};
