import { Contact } from '../../types';
import { request } from './baseClient';

export const contactsApi = {
  listContacts: () => request<{ contacts: Contact[] }>('/contacts'),
  upsertContact: (userId: string, customName?: string | null, isFavorite?: boolean) =>
    request<{ contact: Contact }>('/contacts', {
      method: 'POST',
      body: {
        userId,
        ...(customName !== undefined ? { customName } : {}),
        ...(isFavorite !== undefined ? { isFavorite } : {})
      }
    }),
  removeContact: (userId: string) => request<{ success: boolean }>(`/contacts/${userId}`, { method: 'DELETE' }),
  blockContact: (userId: string) => request<{ contact: Contact }>(`/contacts/${userId}/block`, { method: 'PUT' }),
  unblockContact: (userId: string) =>
    request<{ contact: Contact }>(`/contacts/${userId}/unblock`, { method: 'PUT' })
};
