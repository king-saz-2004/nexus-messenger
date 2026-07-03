import { cachePrefixes } from './cacheKeys.js';
import { getCache } from './index.js';

export const invalidateChatsForUsers = async (userIds: string[]) => {
  const cache = getCache();
  await Promise.all(
    [...new Set(userIds)].flatMap(userId => [
      cache.delByPrefix(cachePrefixes.chats(userId)),
      cache.delByPrefix(cachePrefixes.membersForUser(userId))
    ])
  );
};

export const invalidateUsersForUser = async (userId: string) => {
  const cache = getCache();
  await Promise.all([
    cache.delByPrefix(cachePrefixes.users(userId)),
    cache.delByPrefix(cachePrefixes.userLookup(userId))
  ]);
};

export const invalidateContactsForUser = async (userId: string) => {
  const cache = getCache();
  await cache.delByPrefix(cachePrefixes.contacts(userId));
};

export const invalidateMembersForChat = async (chatId: string, viewerIds: string[]) => {
  const cache = getCache();
  await Promise.all(viewerIds.map(userId => cache.delByPrefix(cachePrefixes.members(userId, chatId))));
};

