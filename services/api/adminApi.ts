import { MediaLimits, User } from '../../types';
import { request } from './baseClient';
import { RegistrationRequiredFields, RegistrationSettings } from './types';

export const adminApi = {
  getAdminSettings: () => request<RegistrationSettings>('/admin/settings'),
  updateRegistrationMode: (mode: 'public' | 'private') =>
    request<{ success: boolean; registrationMode: 'public' | 'private' }>('/admin/settings/registration-mode', {
      method: 'PUT',
      body: { mode }
    }),
  updateRegistrationRequiredFields: (fields: RegistrationRequiredFields) =>
    request<{ success: boolean; registrationRequiredFields: RegistrationRequiredFields }>('/admin/settings/registration-required-fields', {
      method: 'PUT',
      body: fields
    }),
  getPendingUsers: () => request<{ users: User[] }>('/admin/users/pending'),
  approveUser: (userId: string) => request<{ success: boolean }>('/admin/users/' + userId + '/approve', { method: 'POST' }),
  rejectUser: (userId: string) => request<{ success: boolean }>('/admin/users/' + userId + '/reject', { method: 'POST' }),
  updateMediaLimits: (limits: MediaLimits) =>
    request<{ success: boolean; mediaLimits: MediaLimits }>('/admin/settings/media-limits', {
      method: 'PUT',
      body: limits
    }),
  adminDeleteAllMessages: () =>
    request<{ success: boolean; deletedCount: number }>('/admin/messages', { method: 'DELETE' }),
  adminDeleteAllMedia: () =>
    request<{ success: boolean; deletedCount: number }>('/admin/media', { method: 'DELETE' })
};
