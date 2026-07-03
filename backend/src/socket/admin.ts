import { getChatNamespace } from './state.js';

export const broadcastPlatformCleared = async (type: 'messages' | 'media') => {
  const chatNamespace = getChatNamespace();
  if (chatNamespace) {
    chatNamespace.emit('platform:cleared', { type });
  }
};
