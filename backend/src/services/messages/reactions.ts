import { sql } from '../../config/sql.js';
import { runAsUser } from '../../config/dbContext.js';
import { maxReactionEmojiLength, reactionEmojiRegex } from './constants.js';
import { queryVisibleMessage } from './access.js';
import { toMessageDto } from './mappers.js';
import { queryMessageById } from './queries.js';
import type { TxClient } from './types.js';

export const isValidReactionEmoji = (value: string) => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxReactionEmojiLength) {
    return false;
  }

  const matches = normalized.match(reactionEmojiRegex);
  return Array.isArray(matches) && matches.length === 1 && matches[0] === normalized;
};
const addReactionCore = async (tx: TxClient, actorId: string, chatId: string, messageId: string, emoji: string) => {
  const visible = await queryVisibleMessage(tx, actorId, messageId, chatId);
  if (!visible) return null;

  await tx.$executeRaw(
    sql`
      INSERT INTO message_reactions (message_id, user_id, emoji)
      VALUES (${messageId}::uuid, ${actorId}::uuid, ${emoji})
      ON CONFLICT (message_id, user_id, emoji)
      DO NOTHING
    `
  );

  const message = await queryMessageById(tx, actorId, messageId, chatId);
  return message ? toMessageDto(message) : null;
};

const removeReactionCore = async (tx: TxClient, actorId: string, chatId: string, messageId: string, emoji: string) => {
  const visible = await queryVisibleMessage(tx, actorId, messageId, chatId);
  if (!visible) return null;

  await tx.$executeRaw(
    sql`
      DELETE FROM message_reactions
      WHERE message_id = ${messageId}::uuid
        AND user_id = ${actorId}::uuid
        AND emoji = ${emoji}
    `
  );

  const message = await queryMessageById(tx, actorId, messageId, chatId);
  return message ? toMessageDto(message) : null;
};

export const addReaction = async (actorId: string, chatId: string, messageId: string, emoji: string) => {
  return runAsUser(actorId, tx => addReactionCore(tx, actorId, chatId, messageId, emoji));
};

export const addReactionById = async (actorId: string, messageId: string, emoji: string) => {
  return runAsUser(actorId, async tx => {
    const visible = await queryVisibleMessage(tx, actorId, messageId);
    if (!visible) return null;
    return addReactionCore(tx, actorId, visible.chat_id, messageId, emoji);
  });
};

export const removeReaction = async (actorId: string, chatId: string, messageId: string, emoji: string) => {
  return runAsUser(actorId, tx => removeReactionCore(tx, actorId, chatId, messageId, emoji));
};

export const removeReactionById = async (actorId: string, messageId: string, emoji: string) => {
  return runAsUser(actorId, async tx => {
    const visible = await queryVisibleMessage(tx, actorId, messageId);
    if (!visible) return null;
    return removeReactionCore(tx, actorId, visible.chat_id, messageId, emoji);
  });
};
