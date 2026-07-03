import type { Socket } from 'socket.io';
import { logger } from '../config/logger.js';
import { markChatRead } from '../services/messageSystem.js';
import { userSockets } from './state.js';
import {
  addUserSocket,
  chatRoom,
  ensureActiveMembership,
  listActiveChatIds,
  removeUserSocket,
  userRoom
} from './rooms.js';
import { broadcastPresence, setPresenceState } from './presence.js';
import { clearTypingEntry, clearTypingForUser, setTypingActive } from './typing.js';
import { broadcastMessageRead, broadcastUnreadForChat } from './messages.js';
import {
  clearSocketRateCounters,
  isSocketEventRateLimited,
  respondRateLimited
} from './rateLimits.js';
import type { Ack, ReadPayload } from './types.js';

const normalizeChatId = (payload: { chatId?: string } | undefined) =>
  typeof payload?.chatId === 'string' && payload.chatId.trim().length > 0 ? payload.chatId : '';

const normalizeChatIdFromUnknown = (payload: unknown) => {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim();
  }
  return normalizeChatId(payload as { chatId?: string } | undefined);
};

const resolveAck = (...args: unknown[]): Ack | undefined => {
  for (const arg of args) {
    if (typeof arg === 'function') {
      return arg as Ack;
    }
  }
  return undefined;
};

const handleSocketError = (socket: Socket, ack: Ack | undefined, message: string) => {
  ack?.({ ok: false, message });
  socket.emit('error', { message });
};

export const registerHandlers = (socket: Socket) => {
  const userId = socket.data.userId as string;
  const username = socket.data.username as string;

  addUserSocket(userId, socket.id);
  socket.join(userRoom(userId));

  const initializeRealtimeState = async () => {
    try {
      const activeChatIds = await listActiveChatIds(userId);
      for (const id of activeChatIds) {
        socket.join(chatRoom(id));
      }

      if ((userSockets.get(userId)?.size ?? 0) === 1) {
        await setPresenceState(userId, true);
        await broadcastPresence(userId, true);
      }
    } catch {
      socket.emit('error', { message: 'Failed to initialize realtime session' });
      socket.disconnect(true);
    }
  };

  const handleJoin = async (payload: unknown, ack?: Ack) => {
    try {
      if (isSocketEventRateLimited(socket.id, userId, 'joinLeave')) {
        respondRateLimited(socket, ack);
        return;
      }

      const chatId = normalizeChatIdFromUnknown(payload);
      if (!chatId) {
        ack?.({ ok: false, message: 'Missing chatId' });
        return;
      }

      const isMember = await ensureActiveMembership(userId, chatId);
      if (!isMember) {
        ack?.({ ok: false, message: 'Chat not found' });
        return;
      }

      socket.join(chatRoom(chatId));
      ack?.({ ok: true });
    } catch {
      handleSocketError(socket, ack, 'Failed to join chat');
    }
  };

  const handleLeave = (payload: unknown, ack?: Ack) => {
    try {
      if (isSocketEventRateLimited(socket.id, userId, 'joinLeave')) {
        respondRateLimited(socket, ack);
        return;
      }

      const chatId = normalizeChatIdFromUnknown(payload);
      if (!chatId) {
        ack?.({ ok: false, message: 'Missing chatId' });
        return;
      }

      socket.leave(chatRoom(chatId));
      clearTypingEntry(chatId, userId, true);
      ack?.({ ok: true });
    } catch {
      handleSocketError(socket, ack, 'Failed to leave chat');
    }
  };

  socket.on('join_chat', handleJoin);
  socket.on('leave_chat', handleLeave);
  socket.on('join', handleJoin);
  socket.on('leave', handleLeave);

  socket.on('typing_start', async (payload: { chatId?: string }, ack?: Ack) => {
    try {
      if (isSocketEventRateLimited(socket.id, userId, 'typing')) {
        respondRateLimited(socket, ack);
        return;
      }

      const chatId = normalizeChatId(payload);
      if (!chatId) {
        ack?.({ ok: false, message: 'Missing chatId' });
        return;
      }

      const isMember = await ensureActiveMembership(userId, chatId);
      if (!isMember) {
        ack?.({ ok: false, message: 'Chat not found' });
        return;
      }

      setTypingActive(chatId, userId, username);
      ack?.({ ok: true });
    } catch {
      handleSocketError(socket, ack, 'Failed to start typing');
    }
  });

  socket.on('typing_stop', (payload: { chatId?: string }, ack?: Ack) => {
    try {
      if (isSocketEventRateLimited(socket.id, userId, 'typing')) {
        respondRateLimited(socket, ack);
        return;
      }

      const chatId = normalizeChatId(payload);
      if (!chatId) {
        ack?.({ ok: false, message: 'Missing chatId' });
        return;
      }

      clearTypingEntry(chatId, userId, true);
      ack?.({ ok: true });
    } catch {
      handleSocketError(socket, ack, 'Failed to stop typing');
    }
  });

  socket.on('mark_read', async (payload: ReadPayload, ack?: Ack) => {
    try {
      if (isSocketEventRateLimited(socket.id, userId, 'markRead')) {
        respondRateLimited(socket, ack);
        return;
      }

      const chatId = normalizeChatId(payload);
      if (!chatId) {
        ack?.({ ok: false, message: 'Missing chatId' });
        return;
      }

      const result = await markChatRead(userId, chatId, { messageId: payload?.messageId });
      if (!result) {
        ack?.({ ok: false, message: 'Chat not found' });
        return;
      }

      if (result.lastReadMessageId) {
        broadcastMessageRead(chatId, result.lastReadMessageId, userId);
      }
      await broadcastUnreadForChat(userId, chatId);
      ack?.({ ok: true });
    } catch {
      handleSocketError(socket, ack, 'Failed to mark read');
    }
  });

  socket.on('go_online', async (payloadOrAck?: unknown, maybeAck?: unknown) => {
    const ack = resolveAck(payloadOrAck, maybeAck);
    try {
      if (isSocketEventRateLimited(socket.id, userId, 'presence')) {
        respondRateLimited(socket, ack);
        return;
      }

      await setPresenceState(userId, true);
      await broadcastPresence(userId, true);
      ack?.({ ok: true });
    } catch {
      handleSocketError(socket, ack, 'Failed to update online status');
    }
  });

  socket.on('go_offline', async (payloadOrAck?: unknown, maybeAck?: unknown) => {
    const ack = resolveAck(payloadOrAck, maybeAck);
    try {
      if (isSocketEventRateLimited(socket.id, userId, 'presence')) {
        respondRateLimited(socket, ack);
        return;
      }

      const lastSeenAt = await setPresenceState(userId, false);
      await broadcastPresence(userId, false, lastSeenAt);
      ack?.({ ok: true });
    } catch {
      handleSocketError(socket, ack, 'Failed to update offline status');
    }
  });

  socket.on('disconnect', async () => {
    try {
      clearTypingForUser(userId);
      clearSocketRateCounters(socket.id);
      const { remaining } = removeUserSocket(socket.id);
      if (remaining === 0) {
        const lastSeenAt = await setPresenceState(userId, false);
        await broadcastPresence(userId, false, lastSeenAt);
      }
    } catch (err) {
      logger.error('Socket disconnect handler error', { error: err });
    }
  });

  void initializeRealtimeState();
};
