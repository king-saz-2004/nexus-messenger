import { io, Socket } from 'socket.io-client';

let chatSocket: Socket | null = null;

const normalizeBase = (apiBase: string) => apiBase.replace(/\/$/, '');

export const connectChatSocket = (apiBase: string) => {
  if (chatSocket) {
    chatSocket.disconnect();
    chatSocket = null;
  }

  chatSocket = io(`${normalizeBase(apiBase)}/chat`, {
    withCredentials: true,
    transports: ['websocket']
  });

  return chatSocket;
};

export const getChatSocket = () => chatSocket;

export const disconnectChatSocket = () => {
  if (!chatSocket) return;
  chatSocket.disconnect();
  chatSocket = null;
};
