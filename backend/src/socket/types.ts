import type { Server } from 'socket.io';

export type ChatNamespace = ReturnType<Server['of']>;

export type ChatEventPayload = Record<string, unknown>;

export type AckPayload = { ok: boolean; message?: string; code?: string };

export type Ack = (payload: AckPayload) => void;

export type AuthResult = {
  userId: string;
  username: string;
};

export type SocketAuthRow = {
  user_id: string;
  username: string;
};

export type ChatIdRow = {
  chat_id: string;
};

export type PresenceUpdateRow = {
  last_seen: Date | string | null;
};

export type ReadPayload = {
  chatId?: string;
  messageId?: string;
};

export type SocketMessage = {
  id?: string;
  chatId?: string;
  [key: string]: unknown;
};

export type RateCounter = { count: number; resetAt: number };
