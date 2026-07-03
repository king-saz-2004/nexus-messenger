import type { RateCounter, ChatNamespace } from './types.js';

export const userSockets = new Map<string, Set<string>>();
export const socketUsers = new Map<string, string>();
export const typingByChat = new Map<string, Map<string, NodeJS.Timeout>>();
export const socketEventCounters = new Map<string, RateCounter>();
export const userEventCounters = new Map<string, RateCounter>();

let chatNamespace: ChatNamespace | null = null;

export const setChatNamespace = (namespace: ChatNamespace) => {
  chatNamespace = namespace;
};

export const getChatNamespace = () => chatNamespace;
