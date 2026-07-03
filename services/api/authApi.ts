import { User } from '../../types';
import { ApiClientError, request } from './baseClient';
import { RegisterResponse, RegistrationSettings, SessionDto } from './types';

export const authApi = {
  register: async (payload: {
    username: string;
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    password: string;
  }) =>
    request<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: payload,
      retryOnUnauthorized: false
    }),

  login: async (username: string, password: string) =>
    request<{ user: User; csrfToken?: string }>('/auth/login', {
      method: 'POST',
      body: { username, password },
      retryOnUnauthorized: false
    }),

  logout: async () => {
    await request('/auth/logout', {
      method: 'POST',
      retryOnUnauthorized: false
    }).catch(() => undefined);
  },

  restoreSession: async () => {
    try {
      return await request<{ user: User }>('/users/me');
    } catch (error) {
      const status = (error as ApiClientError)?.status;
      if (status === 401) return null;
      throw error;
    }
  },

  listSessions: (cursor?: string, limit = 25) =>
    request<{
      sessions: SessionDto[];
      limit: number;
      nextCursor?: string;
      hasMore: boolean;
    }>(`/auth/sessions?limit=${encodeURIComponent(String(limit))}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),

  terminateSession: (sessionId: string) => request<{ success: boolean }>(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),

  getRegistrationSettings: () => request<RegistrationSettings>('/auth/registration-settings')
};
