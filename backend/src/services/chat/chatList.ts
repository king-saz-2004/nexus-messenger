import { runAsUser } from '../../config/dbContext.js';
import { loadChatRows, loadSingleChat } from './queries.js';

export const listChats = async (userId: string, query?: string) => {
  return runAsUser(userId, tx => loadChatRows(tx, userId, { query }));
};

export const getChatById = async (userId: string, chatId: string) => {
  return runAsUser(userId, tx => loadSingleChat(tx, userId, chatId));
};
