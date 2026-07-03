import { Chat, User, AVATAR_COLORS } from '../types';

export const CURRENT_USER: User = {
  id: 'me',
  name: 'You',
  avatarColor: AVATAR_COLORS[3],
  isOnline: true,
};

const users: User[] = [
  { id: 'u1', name: 'Alice', avatarColor: AVATAR_COLORS[0], isOnline: true },
  { id: 'u2', name: 'Bob', avatarColor: AVATAR_COLORS[1], isOnline: false, lastSeen: 'last seen recently' },
  { id: 'u3', name: 'Charlie', avatarColor: AVATAR_COLORS[4], isOnline: false, lastSeen: 'last seen at 3:45 PM' },
  { id: 'u4', name: 'Design Team', avatarColor: AVATAR_COLORS[2], isOnline: true }, // Group avatar placeholder
];

export const INITIAL_CHATS: Chat[] = [
  {
    id: 'saved',
    type: 'private',
    name: 'Saved Messages',
    participants: [CURRENT_USER], // Chat with self
    unreadCount: 0,
    isPinned: true,
    messages: [
      { id: 'm_saved_1', text: 'https://telegram.org/blog/video-calls-and-more', senderId: 'me', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), isRead: true, isDelivered: true, type: 'text' },
      { id: 'm_saved_2', text: 'Passport.pdf', senderId: 'me', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), isRead: true, isDelivered: true, type: 'text' },
      { id: 'm_saved_3', text: 'Remember to buy milk', senderId: 'me', timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(), isRead: true, isDelivered: true, type: 'text' },
    ]
  },
  {
    id: 'c1',
    type: 'private',
    name: 'Alice',
    participants: [users[0]],
    unreadCount: 3,
    messages: [
      { id: 'm1', text: 'Hey! How are you doing today?', senderId: 'u1', timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(), isRead: true, isDelivered: true, type: 'text' },
      { id: 'm2', text: 'I am just checking in about the project.', senderId: 'u1', timestamp: new Date(Date.now() - 1000 * 60 * 59).toISOString(), isRead: true, isDelivered: true, type: 'text' },
      { id: 'm3', text: 'Everything is on track!', senderId: 'me', timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), isRead: true, isDelivered: true, type: 'text' },
      { id: 'm4', text: 'Great to hear! Send me the files when ready.', senderId: 'u1', timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), isRead: false, isDelivered: true, type: 'text' },
    ]
  },
  {
    id: 'c2',
    type: 'group',
    name: 'Project Alpha',
    participants: [users[0], users[1], users[2]],
    unreadCount: 0,
    isPinned: true,
    messages: [
      { id: 'm10', text: 'Meeting starts in 5 minutes.', senderId: 'u2', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), isRead: true, isDelivered: true, type: 'text' },
      { id: 'm11', text: 'I will be there.', senderId: 'me', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 1.9).toISOString(), isRead: true, isDelivered: true, type: 'text' },
      { id: 'm12', text: 'Alice joined the group', senderId: 'system', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString(), isRead: true, isDelivered: true, type: 'system' },
    ]
  },
  {
    id: 'c3',
    type: 'private',
    name: 'Bob',
    participants: [users[1]],
    unreadCount: 0,
    isMuted: true,
    messages: [
      { id: 'm20', text: 'Can you send me the report?', senderId: 'u2', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), isRead: true, isDelivered: true, type: 'text' },
    ]
  },
  {
    id: 'c4',
    type: 'private',
    name: 'Charlie',
    participants: [users[2]],
    unreadCount: 0,
    messages: [
      { id: 'm30', text: 'Thanks!', senderId: 'u3', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), isRead: true, isDelivered: true, type: 'text' },
    ]
  }
];