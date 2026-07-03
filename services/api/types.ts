import { MediaLimits, User } from '../../types';

export type RegistrationRequiredFields = {
  lastName: boolean;
  email: boolean;
  phone: boolean;
};

export type RegistrationSettings = {
  registrationMode: 'public' | 'private';
  registrationRequiredFields: RegistrationRequiredFields;
  mediaLimits?: MediaLimits;
};

export type RegisterResponse =
  | { user: User; csrfToken?: string }
  | { status: 'pending_approval'; message: string };

export type UserSettings = {
  userId: string;
  theme: 'light' | 'dark' | 'system';
  chatWallpaper?: string;
  fontSize: number;
  messageCorner: number;
  showStickersTab: boolean;
  autoDownloadPhoto: boolean;
  autoDownloadVideo: boolean;
  autoDownloadDoc: boolean;
  autoPlayGif: boolean;
  notificationEnabled: boolean;
  notificationSound: boolean;
  notificationPreview: boolean;
  notificationCountBadge: boolean;
  language: string;
  timeFormat: '12h' | '24h';
  updatedAt: string;
};

export type UpdateMySettingsPayload = {
  theme?: 'light' | 'dark' | 'system';
  chatWallpaper?: string | null;
  fontSize?: 14 | 16 | 18 | 20;
  messageCorner?: number;
  showStickersTab?: boolean;
  autoDownloadPhoto?: boolean;
  autoDownloadVideo?: boolean;
  autoDownloadDoc?: boolean;
  autoPlayGif?: boolean;
  notificationEnabled?: boolean;
  notificationSound?: boolean;
  notificationPreview?: boolean;
  notificationCountBadge?: boolean;
  language?: string;
  timeFormat?: '12h' | '24h';
};

export type SessionDto = {
  id: string;
  deviceName?: string;
  deviceType?: string;
  ipAddress?: string;
  userAgent?: string;
  isActive: boolean;
  lastActivity: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};
