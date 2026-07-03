import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { RefreshCw, Shield } from 'lucide-react';
import type { MediaLimits, User } from '../../../types';
import MediaLimitsPanel from './MediaLimitsPanel';
import PendingUsersPanel from './PendingUsersPanel';
import RegistrationSettingsPanel from './RegistrationSettingsPanel';
import RootDangerZone from './RootDangerZone';

type RegistrationRequiredFields = {
  lastName: boolean;
  email: boolean;
  phone: boolean;
};

type AdminPanelProps = {
  showAdminPanel: boolean;
  setShowAdminPanel: Dispatch<SetStateAction<boolean>>;
  pendingUsers: User[];
  isPendingUsersLoading: boolean;
  loadAdminData: () => Promise<void>;
  registrationMode: 'public' | 'private';
  registrationRequiredFields: RegistrationRequiredFields;
  isRegistrationModeSaving: boolean;
  isRegistrationFieldsSaving: boolean;
  onSetRegistrationMode: (mode: 'public' | 'private') => Promise<void>;
  onUpdateRegistrationRequiredFields: (field: 'lastName' | 'email' | 'phone', value: boolean) => Promise<void>;
  localVoice: string;
  localAudio: string;
  localPhoto: string;
  localVideo: string;
  setLocalVoice: Dispatch<SetStateAction<string>>;
  setLocalAudio: Dispatch<SetStateAction<string>>;
  setLocalPhoto: Dispatch<SetStateAction<string>>;
  setLocalVideo: Dispatch<SetStateAction<string>>;
  isMediaLimitsSaving: boolean;
  onCommitMediaLimit: (type: keyof MediaLimits, value: string) => Promise<void>;
  pendingActionUserId: string | null;
  adminLoadError: string | null;
  onApproveUser: (userId: string) => Promise<void>;
  onRejectUser: (userId: string) => Promise<void>;
  rootDeleteConfirmText: string;
  setRootDeleteConfirmText: Dispatch<SetStateAction<string>>;
  isDeletingAllMessages: boolean;
  isDeletingAllMedia: boolean;
  onDeleteAllMessages: () => Promise<void>;
  onDeleteAllMedia: () => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function AdminPanel({
  showAdminPanel,
  setShowAdminPanel,
  pendingUsers,
  isPendingUsersLoading,
  loadAdminData,
  registrationMode,
  registrationRequiredFields,
  isRegistrationModeSaving,
  isRegistrationFieldsSaving,
  onSetRegistrationMode,
  onUpdateRegistrationRequiredFields,
  localVoice,
  localAudio,
  localPhoto,
  localVideo,
  setLocalVoice,
  setLocalAudio,
  setLocalPhoto,
  setLocalVideo,
  isMediaLimitsSaving,
  onCommitMediaLimit,
  pendingActionUserId,
  adminLoadError,
  onApproveUser,
  onRejectUser,
  rootDeleteConfirmText,
  setRootDeleteConfirmText,
  isDeletingAllMessages,
  isDeletingAllMedia,
  onDeleteAllMessages,
  onDeleteAllMedia,
  t
}: AdminPanelProps) {
  return (
    <div className="border-b border-tg-border bg-tg-bg-surface/30 px-4 py-2.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowAdminPanel(prev => !prev)}
          className="focus-ring flex items-center gap-1.5 rounded-xl bg-tg-bg-input-field px-3 py-2 text-xs font-semibold text-tg-text-primary hover:bg-tg-hover"
        >
          <Shield size={14} className="text-tg-accent" />
          {t('Root Administration')}
          {pendingUsers.length > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
              {pendingUsers.length}
            </span>
          ) : null}
        </button>

        {showAdminPanel ? (
          <button
            type="button"
            disabled={isPendingUsersLoading}
            onClick={() => void loadAdminData()}
            className="focus-ring rounded-lg bg-tg-bg-input-field p-1.5 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
            title={t('Refresh pending users')}
          >
            <RefreshCw size={13} className={isPendingUsersLoading ? 'animate-spin' : ''} />
          </button>
        ) : null}
      </div>

      {showAdminPanel ? (
        <div className="mt-3 space-y-3 border-t border-tg-border/40 pt-3">
          <RegistrationSettingsPanel
            registrationMode={registrationMode}
            registrationRequiredFields={registrationRequiredFields}
            isRegistrationModeSaving={isRegistrationModeSaving}
            isRegistrationFieldsSaving={isRegistrationFieldsSaving}
            onSetRegistrationMode={onSetRegistrationMode}
            onUpdateRegistrationRequiredFields={onUpdateRegistrationRequiredFields}
            t={t}
          />

          <MediaLimitsPanel
            localVoice={localVoice}
            localAudio={localAudio}
            localPhoto={localPhoto}
            localVideo={localVideo}
            setLocalVoice={setLocalVoice}
            setLocalAudio={setLocalAudio}
            setLocalPhoto={setLocalPhoto}
            setLocalVideo={setLocalVideo}
            isMediaLimitsSaving={isMediaLimitsSaving}
            onCommitMediaLimit={onCommitMediaLimit}
            t={t}
          />

          <PendingUsersPanel
            pendingUsers={pendingUsers}
            pendingActionUserId={pendingActionUserId}
            adminLoadError={adminLoadError}
            onApproveUser={onApproveUser}
            onRejectUser={onRejectUser}
            t={t}
          />

          <RootDangerZone
            rootDeleteConfirmText={rootDeleteConfirmText}
            setRootDeleteConfirmText={setRootDeleteConfirmText}
            isDeletingAllMessages={isDeletingAllMessages}
            isDeletingAllMedia={isDeletingAllMedia}
            onDeleteAllMessages={onDeleteAllMessages}
            onDeleteAllMedia={onDeleteAllMedia}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}
