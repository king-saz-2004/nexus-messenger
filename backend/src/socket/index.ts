import type { Server } from 'socket.io';
import { registerSocketAuthMiddleware } from './auth.js';
import { registerHandlers } from './registerHandlers.js';
import { cleanupRateCounters } from './rateLimits.js';
import { setChatNamespace } from './state.js';

export {
  emitToChat,
  emitToUser,
  ensureAllMembersJoined,
  joinUserChatRoom
} from './rooms.js';
export { broadcastPresence } from './presence.js';
export {
  ejectUserFromChatRoom,
  broadcastMemberAdded,
  broadcastMemberRemoved,
  broadcastMemberRoleChanged,
  broadcastMemberBanned,
  broadcastChatUpdated,
  broadcastChatDeleted,
  broadcastChatCleared
} from './chats.js';
export {
  broadcastNewMessage,
  broadcastMessageEdited,
  broadcastMessageDeleted,
  broadcastMessageReacted,
  broadcastMessageRead,
  broadcastUnreadUpdated,
  broadcastUnreadForChat
} from './messages.js';
export { broadcastPlatformCleared } from './admin.js';

export const registerSocketHandlers = (io: Server) => {
  const namespace = io.of('/chat');
  setChatNamespace(namespace);

  registerSocketAuthMiddleware(namespace);

  namespace.on('connection', socket => {
    registerHandlers(socket);
  });
};

setInterval(() => {
  cleanupRateCounters();
}, 60_000);
