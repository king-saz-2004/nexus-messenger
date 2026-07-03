import emojiRegex from 'emoji-regex';

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const reactionEmojiRegex = emojiRegex();
export const maxReactionEmojiLength = 64;

export const MESSAGE_LIMITS = {
  maxMessageLength: 4000,
  maxListLimit: 100,
  defaultListLimit: 50,
  maxSearchLimit: 100,
  defaultSearchLimit: 30
} as const;

export const VOICE_LIMITS = {
  minDurationMs: 300,
  maxDurationMs: 15 * 60 * 1000
} as const;
