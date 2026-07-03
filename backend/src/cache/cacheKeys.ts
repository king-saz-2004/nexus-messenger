import { createHash } from 'node:crypto';

const normalize = (value: string) => value.trim().toLowerCase();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const cachePrefixes = {
  chats: (actorId: string) => `chats:${actorId}:`,
  users: (actorId: string) => `users:${actorId}:`,
  userLookup: (actorId: string) => `lookup:${actorId}:`,
  contacts: (actorId: string) => `contacts:${actorId}:`,
  members: (actorId: string, chatId: string) => `members:${actorId}:${chatId}:`,
  membersForUser: (actorId: string) => `members:${actorId}:`,
  linkPreviewMetadata: 'link-preview:metadata:v2:',
  linkPreviewNegative: 'link-preview:negative:v2:'
} as const;

export const cacheKeys = {
  chats: (actorId: string, query: string, cursor: string | null, limit: number) =>
    `${cachePrefixes.chats(actorId)}q=${encodeURIComponent(normalize(query))}:cursor=${cursor ?? ''}:limit=${limit}`,
  usersList: (actorId: string, query: string, cursor: string | null, limit: number) =>
    `${cachePrefixes.users(actorId)}q=${encodeURIComponent(normalize(query))}:cursor=${cursor ?? ''}:limit=${limit}`,
  userLookup: (actorId: string, userid: string) =>
    `${cachePrefixes.userLookup(actorId)}userid=${encodeURIComponent(normalize(userid))}`,
  contacts: (actorId: string, cursor: string | null, limit: number) =>
    `${cachePrefixes.contacts(actorId)}cursor=${cursor ?? ''}:limit=${limit}`,
  members: (actorId: string, chatId: string, cursor: string | null, limit: number) =>
    `${cachePrefixes.members(actorId, chatId)}cursor=${cursor ?? ''}:limit=${limit}`,
  linkPreviewMetadata: (url: string) => `${cachePrefixes.linkPreviewMetadata}${sha256(url)}`,
  linkPreviewNegative: (url: string) => `${cachePrefixes.linkPreviewNegative}${sha256(url)}`
} as const;
