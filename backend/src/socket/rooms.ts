import type { Socket } from 'socket.io';
import { sql } from '../config/sql.js';
import { runAsUser } from '../config/dbContext.js';
import { logger } from '../config/logger.js';
import { getChatNamespace, socketUsers, userSockets } from './state.js';
import type { ChatEventPayload, ChatIdRow } from './types.js';

export const chatRoom = (chatId: string) => `chat:${chatId}`;
export const userRoom = (userId: string) => `user:${userId}`;

export const addUserSocket = (userId: string, socketId: string) => {
  const set = userSockets.get(userId) ?? new Set<string>();
  set.add(socketId);
  userSockets.set(userId, set);
  socketUsers.set(socketId, userId);
};

export const removeUserSocket = (socketId: string) => {
  const userId = socketUsers.get(socketId);
  if (!userId) {
    return { userId: null, remaining: 0 };
  }

  socketUsers.delete(socketId);
  const set = userSockets.get(userId);
  if (!set) {
    return { userId, remaining: 0 };
  }

  set.delete(socketId);
  if (set.size === 0) {
    userSockets.delete(userId);
    return { userId, remaining: 0 };
  }

  return { userId, remaining: set.size };
};

export const getSocketsForUser = (userId: string) => {
  const chatNamespace = getChatNamespace();
  if (!chatNamespace) return [] as Socket[];
  const ids = userSockets.get(userId);
  if (!ids || ids.size === 0) return [] as Socket[];

  const sockets: Socket[] = [];
  for (const socketId of ids) {
    const socket = chatNamespace.sockets.get(socketId);
    if (socket) sockets.push(socket);
  }
  return sockets;
};

const emitToRoom = (room: string, event: string, payload: ChatEventPayload) => {
  const chatNamespace = getChatNamespace();
  if (!chatNamespace) return;
  chatNamespace.to(room).emit(event, payload);
};

export const emitToChat = (chatId: string, event: string, payload: ChatEventPayload) => {
  emitToRoom(chatRoom(chatId), event, payload);
};

export const emitToUser = (userId: string, event: string, payload: ChatEventPayload) => {
  emitToRoom(userRoom(userId), event, payload);
};

export const ensureActiveMembership = async (userId: string, chatId: string) => {
  const rows = await runAsUser(userId, tx =>
    tx.$queryRaw<ChatIdRow[]>(
      sql`
        SELECT cm.chat_id
        FROM chat_members cm
        JOIN chats c
          ON c.id = cm.chat_id
        WHERE cm.user_id = ${userId}::uuid
          AND cm.chat_id = ${chatId}::uuid
          AND cm.status = 'active'
          AND c.is_active = true
          AND c.is_deleted = false
        LIMIT 1
      `
    )
  );

  return rows.length > 0;
};

export const listActiveChatIds = async (userId: string) => {
  const rows = await runAsUser(userId, tx =>
    tx.$queryRaw<ChatIdRow[]>(
      sql`
        SELECT cm.chat_id
        FROM chat_members cm
        JOIN chats c
          ON c.id = cm.chat_id
        WHERE cm.user_id = ${userId}::uuid
          AND cm.status = 'active'
          AND c.is_active = true
          AND c.is_deleted = false
      `
    )
  );
  return rows.map(row => row.chat_id);
};

export const joinUserChatRoom = async (userId: string, chatId: string) => {
  const chatNamespace = getChatNamespace();
  if (!chatNamespace) return;
  const canJoin = await ensureActiveMembership(userId, chatId);
  if (!canJoin) return;

  for (const socket of getSocketsForUser(userId)) {
    socket.join(chatRoom(chatId));
  }
};

export const ensureAllMembersJoined = async (chatId: string, actorId: string) => {
  try {
    const rows = await runAsUser(actorId, tx =>
      tx.$queryRaw<Array<{ user_id: string }>>(
        sql`
          SELECT user_id
          FROM chat_members
          WHERE chat_id = ${chatId}::uuid
            AND status = 'active'
        `
      )
    );
    for (const r of rows) {
      await joinUserChatRoom(r.user_id, chatId);
    }
  } catch (err) {
    logger.error('Failed to ensure members joined chat room', { error: err });
  }
};
