import { User } from '../../types';
import { request } from './baseClient';
import { UpdateMySettingsPayload, UserSettings } from './types';

export const usersApi = {
  getMe: () => request<{ user: User }>('/users/me'),
  getUserById: (userId: string) => request<{ user: User }>(`/users/${userId}`),
  deleteUser: (userId: string) => request<{ success: boolean; deletedUserId: string }>(`/users/${userId}`, { method: 'DELETE' }),
  getMySettings: () => request<{ settings: UserSettings }>('/users/me/settings'),
  updateMySettings: (payload: UpdateMySettingsPayload) =>
    request<{ settings: UserSettings }>('/users/me/settings', { method: 'PUT', body: payload }),
  updateMe: (payload: { name?: string; password?: string }) =>
    request<{ user: User }>('/users/me', { method: 'PATCH', body: payload }),
  uploadMyAvatar: (file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    return request<{ user: User }>('/users/me/avatar', { method: 'POST', body: form });
  },
  getUsers: (limit?: number) => request<{ users: User[] }>(`/users${limit ? `?limit=${limit}` : ''}`),
  lookupUserByUserid: (userid: string) =>
    request<{ user: User }>(`/users/lookup?userid=${encodeURIComponent(userid.trim())}`)
};
