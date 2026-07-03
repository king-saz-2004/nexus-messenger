import React, { useEffect, useState } from 'react';
import { Camera, MonitorSmartphone, Save, UserRound, X } from 'lucide-react';
import { User } from '../types';
import { useI18n } from '../hooks/useI18n';
import { getAvatarColor } from '../services/chatAdapter';
import SessionsDrawer from './SessionsDrawer';

type UserSettingsDto = {
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

type SessionDto = {
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

type ProfileSettingsPageProps = {
  open: boolean;
  currentUser: User;
  settings: UserSettingsDto | null;
  onClose: () => void;
  onSaveName: (name: string) => Promise<void>;
  onUploadAvatar: (file: File) => Promise<void>;
  onLoadSettings: () => Promise<UserSettingsDto>;
  onSaveSettings: (payload: {
    theme?: 'light' | 'dark' | 'system';
    timeFormat?: '12h' | '24h';
    notificationEnabled?: boolean;
    notificationPreview?: boolean;
    notificationSound?: boolean;
    notificationCountBadge?: boolean;
  }) => Promise<UserSettingsDto>;
  onListSessions: (cursor?: string, limit?: number) => Promise<{
    sessions: SessionDto[];
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  }>;
  onTerminateSession: (sessionId: string) => Promise<void>;
  onLogoutCurrentSession: () => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
};

export default function ProfileSettingsPage({
  open,
  currentUser,
  settings,
  onClose,
  onSaveName,
  onUploadAvatar,
  onLoadSettings,
  onSaveSettings,
  onListSessions,
  onTerminateSession,
  onLogoutCurrentSession,
  onNotify
}: ProfileSettingsPageProps) {
  const { t, localizeApiError } = useI18n();
  const [name, setName] = useState(currentUser.name);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system');
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('12h');
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [notificationPreview, setNotificationPreview] = useState(true);
  const [notificationSound, setNotificationSound] = useState(true);
  const [notificationBadge, setNotificationBadge] = useState(true);

  const applySettings = (value: UserSettingsDto) => {
    setThemeMode(value.theme);
    setTimeFormat(value.timeFormat);
    setNotificationEnabled(value.notificationEnabled);
    setNotificationPreview(value.notificationPreview);
    setNotificationSound(value.notificationSound);
    setNotificationBadge(value.notificationCountBadge);
  };

  useEffect(() => {
    if (!open) return;
    setName(currentUser.name);
    if (settings) {
      applySettings(settings);
    }
  }, [open, currentUser.name, settings]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    setIsLoadingSettings(true);
    void onLoadSettings()
      .then(loaded => {
        if (!active) return;
        applySettings(loaded);
      })
      .catch(error => {
        if (!active) return;
        onNotify(localizeApiError(error, 'Failed to load settings'), 'error');
      })
      .finally(() => {
        if (!active) return;
        setIsLoadingSettings(false);
      });

    return () => {
      active = false;
    };
  }, [onLoadSettings, onNotify, open, localizeApiError]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-md border-l border-tg-border bg-tg-bg-modal"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-tg-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-tg-text-primary">{t('Profile settings')}</h2>
              <p className="text-start text-xs text-tg-text-secondary"><span dir="ltr">@{currentUser.username}</span></p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring rounded-lg p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
              aria-label={t('Close profile settings')}
            >
              <X size={16} />
            </button>
          </header>

          <div className="message-scroll flex-1 space-y-4 overflow-y-auto p-4">
            <section className="rounded-2xl border border-tg-border bg-white/5 p-4">
              <p className="mb-3 text-xs font-semibold text-tg-text-primary">{t('Avatar')}</p>
              <div className="flex items-center gap-3">
                {currentUser.avatar ? (
                  <img
                    src={currentUser.avatar}
                    alt={`${currentUser.name} avatar`}
                    className="h-14 w-14 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="h-14 w-14 rounded-full text-center text-base font-semibold leading-[3.5rem] text-white"
                    style={{ background: currentUser.avatarColor || getAvatarColor(currentUser.id) }}
                  >
                    {currentUser.name.slice(0, 2).toUpperCase()}
                  </div>
                )}

                <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-xl border border-tg-border bg-tg-bg-input-field px-3 py-2 text-xs text-tg-text-primary hover:bg-tg-hover">
                  <Camera size={14} />
                  {isUploadingAvatar ? t('Uploading...') : t('Upload avatar')}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={isUploadingAvatar}
                    onChange={event => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (!file) return;
                      setIsUploadingAvatar(true);
                      void onUploadAvatar(file)
                        .then(() => onNotify(t('Avatar updated'), 'success'))
                        .catch(error => {
                          onNotify(localizeApiError(error, 'Avatar upload failed'), 'error');
                        })
                        .finally(() => setIsUploadingAvatar(false));
                    }}
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-tg-border bg-white/5 p-4">
              <p className="mb-3 text-xs font-semibold text-tg-text-primary">{t('Display name')}</p>
              <div className="space-y-3">
                <label className="block text-xs text-tg-text-secondary">
                  {t('Name')}
                  <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    maxLength={80}
                    className="focus-ring mt-1 h-10 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-3 text-sm text-tg-text-primary"
                    placeholder={t('Your name')}
                  />
                </label>
                <button
                  type="button"
                  disabled={isSavingName || name.trim().length < 2}
                  onClick={() => {
                    const nextName = name.trim();
                    if (nextName.length < 2) {
                      onNotify(t('Name must be at least 2 characters'), 'error');
                      return;
                    }
                    setIsSavingName(true);
                    void onSaveName(nextName)
                      .then(() => onNotify(t('Name updated'), 'success'))
                      .catch(error => {
                        onNotify(localizeApiError(error, 'Failed to update name'), 'error');
                      })
                      .finally(() => setIsSavingName(false));
                  }}
                  className="focus-ring inline-flex items-center gap-2 rounded-xl bg-tg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
                >
                  <Save size={14} />
                  {isSavingName ? t('Saving...') : t('Save name')}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-tg-border bg-white/5 p-4">
              <p className="mb-1 text-xs font-semibold text-tg-text-primary">{t('Account')}</p>
              {currentUser.email && <p className="text-xs text-tg-text-secondary">{currentUser.email}</p>}
              {currentUser.phone && <p className="text-xs text-tg-text-secondary mt-0.5">{currentUser.phone}</p>}
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-tg-border bg-tg-bg-input-field px-2 py-1 text-[11px] text-tg-text-secondary">
                <UserRound size={12} />
                {t('Role: {role}', { role: currentUser.role })}
              </div>
            </section>

            <section className="rounded-2xl border border-tg-border bg-white/5 p-4">
              <p className="mb-3 text-xs font-semibold text-tg-text-primary">{t('Preferences')}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-tg-text-secondary">
                  {t('Theme')}
                  <select
                    value={themeMode}
                    onChange={event => setThemeMode(event.target.value as 'light' | 'dark' | 'system')}
                    disabled={isLoadingSettings || isSavingSettings}
                    className="focus-ring mt-1 h-10 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-2 text-sm text-tg-text-primary"
                  >
                    <option value="system">{t('System')}</option>
                    <option value="light">{t('Light')}</option>
                    <option value="dark">{t('Dark')}</option>
                  </select>
                </label>
                <label className="block text-xs text-tg-text-secondary">
                  {t('Time format')}
                  <select
                    value={timeFormat}
                    onChange={event => setTimeFormat(event.target.value as '12h' | '24h')}
                    disabled={isLoadingSettings || isSavingSettings}
                    className="focus-ring mt-1 h-10 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-2 text-sm text-tg-text-primary"
                  >
                    <option value="12h">12h</option>
                    <option value="24h">24h</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 space-y-2 text-xs text-tg-text-secondary">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notificationEnabled}
                    onChange={event => setNotificationEnabled(event.target.checked)}
                    disabled={isLoadingSettings || isSavingSettings}
                  />
                  {t('Notifications enabled')}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notificationPreview}
                    onChange={event => setNotificationPreview(event.target.checked)}
                    disabled={isLoadingSettings || isSavingSettings}
                  />
                  {t('Notification preview')}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notificationSound}
                    onChange={event => setNotificationSound(event.target.checked)}
                    disabled={isLoadingSettings || isSavingSettings}
                  />
                  {t('Notification sound')}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notificationBadge}
                    onChange={event => setNotificationBadge(event.target.checked)}
                    disabled={isLoadingSettings || isSavingSettings}
                  />
                  {t('Notification badge count')}
                </label>
              </div>

              <button
                type="button"
                disabled={isLoadingSettings || isSavingSettings}
                onClick={() => {
                  setIsSavingSettings(true);
                  void onSaveSettings({
                    theme: themeMode,
                    timeFormat,
                    notificationEnabled,
                    notificationPreview,
                    notificationSound,
                    notificationCountBadge: notificationBadge
                  })
                    .then(next => {
                      applySettings(next);
                      onNotify(t('Settings saved'), 'success');
                    })
                    .catch(error => {
                      onNotify(localizeApiError(error, 'Failed to save settings'), 'error');
                    })
                    .finally(() => setIsSavingSettings(false));
                }}
                className="focus-ring mt-3 inline-flex items-center gap-2 rounded-xl bg-tg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
              >
                <Save size={14} />
                {isSavingSettings ? t('Saving settings...') : t('Save preferences')}
              </button>
            </section>

            <section className="rounded-2xl border border-tg-border bg-white/5 p-4">
              <p className="mb-3 text-xs font-semibold text-tg-text-primary">{t('Sessions')}</p>
              <button
                type="button"
                onClick={() => setShowSessions(true)}
                className="focus-ring inline-flex items-center gap-2 rounded-xl border border-tg-border bg-tg-bg-input-field px-3 py-2 text-xs text-tg-text-primary hover:bg-tg-hover"
              >
                <MonitorSmartphone size={14} />
                {t('Manage active sessions')}
              </button>
            </section>
          </div>
        </div>
      </aside>

      <SessionsDrawer
        open={showSessions}
        onClose={() => setShowSessions(false)}
        onListSessions={onListSessions}
        onTerminateSession={onTerminateSession}
        onLogoutCurrentSession={onLogoutCurrentSession}
        onNotify={onNotify}
      />
    </div>
  );
}
