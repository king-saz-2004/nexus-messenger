import { ApiChat, GroupMember } from '../../types';
import { request } from './baseClient';

export const groupsApi = {
  createGroup: (name: string, participantIds: string[]) =>
    request<{ group: ApiChat; chat: ApiChat }>('/groups', { method: 'POST', body: { name, participantIds } }),
  deleteGroup: (chatId: string) => request<{ message: string }>(`/groups/${chatId}`, { method: 'DELETE' }),
  updateGroup: (chatId: string, payload: { name?: string; avatar?: string; defaultPermissions?: { canPinMessages?: boolean } }) =>
    request<{ group: ApiChat; chat: ApiChat }>(`/groups/${chatId}`, { method: 'PATCH', body: payload }),
  uploadGroupAvatar: (chatId: string, file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    return request<{ group: ApiChat; chat: ApiChat }>(`/groups/${chatId}/avatar`, { method: 'POST', body: form });
  },
  getGroupMembers: (chatId: string) => request<{ members: GroupMember[] }>(`/groups/${chatId}/members`),
  addGroupMembers: (chatId: string, add: string[]) =>
    request<{ group: ApiChat }>(`/groups/${chatId}/members`, { method: 'POST', body: { add } }),
  removeGroupMember: (chatId: string, memberId: string) =>
    request<{ group: ApiChat }>(`/groups/${chatId}/members/${memberId}`, { method: 'DELETE' }),
  updateGroupMemberRole: (chatId: string, userId: string, role: 'ADMIN' | 'MEMBER') =>
    request<{ group: ApiChat }>(`/groups/${chatId}/roles`, { method: 'PATCH', body: { userId, role } }),
  banGroupMember: (chatId: string, userId: string, reason?: string) =>
    request<{ group: ApiChat }>(`/groups/${chatId}/ban`, { method: 'POST', body: { userId, reason } }),
  unbanGroupMember: (chatId: string, userId: string) =>
    request<{ group: ApiChat }>(`/groups/${chatId}/unban`, { method: 'POST', body: { userId } }),
  transferOwnership: (chatId: string, userId: string) =>
    request<{ group: ApiChat }>(`/groups/${chatId}/transfer-ownership`, { method: 'POST', body: { userId } }),
  leaveGroup: (chatId: string) => request<{ success: boolean }>(`/groups/${chatId}/leave`, { method: 'POST' }),
  clearGroupMessages: (groupId: string) =>
    request<{ success: boolean; deletedCount: number }>(`/groups/${groupId}/messages`, { method: 'DELETE' }),
  updateGroupMemberPermissions: (chatId: string, userId: string, permissions: Record<string, boolean>) =>
    request<{ group: ApiChat }>(`/groups/${chatId}/members/${userId}/permissions`, {
      method: 'PATCH',
      body: permissions
    })
};
