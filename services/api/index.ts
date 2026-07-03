import { adminApi } from './adminApi';
import { authApi } from './authApi';
import { getApiBase, getCsrfToken } from './baseClient';
import { chatsApi } from './chatsApi';
import { contactsApi } from './contactsApi';
import { groupsApi } from './groupsApi';
import { linkPreviewApi } from './linkPreviewApi';
import { mediaApi } from './mediaApi';
import { messagesApi } from './messagesApi';
import { usersApi } from './usersApi';

export type { ApiClientError } from './baseClient';
export type { RegisterResponse, RegistrationRequiredFields, RegistrationSettings } from './types';

export const apiClient = {
  getApiBase,
  getCsrfToken,
  ...authApi,
  ...usersApi,
  ...contactsApi,
  ...mediaApi,
  ...chatsApi,
  ...groupsApi,
  ...messagesApi,
  ...adminApi,
  ...linkPreviewApi
};
