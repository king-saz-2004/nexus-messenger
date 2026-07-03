import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Camera, Crown, Save, Shield, ShieldOff, Trash2, UserMinus, UserPlus, UserRoundCheck, X, Eraser } from 'lucide-react';
import { Chat, GroupMember, User } from '../types';
import { useI18n } from '../hooks/useI18n';
import { getAvatarColor } from '../services/chatAdapter';
import { apiClient } from '../services/apiClient';

type GroupInfoDrawerProps = {
  open: boolean;
  chat: Chat;
  currentUser: User;
  members: GroupMember[];
  isLoading: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onAddMembers: (chatId: string, userIds: string[]) => Promise<void>;
  onLookupUserByUserid: (userid: string) => Promise<User>;
  onRemoveMember: (chatId: string, userId: string) => Promise<void>;
  onUpdateRole: (chatId: string, userId: string, role: 'ADMIN' | 'MEMBER') => Promise<void>;
  onBanMember: (chatId: string, userId: string) => Promise<void>;
  onUnbanMember: (chatId: string, userId: string) => Promise<void>;
  onTransferOwnership: (chatId: string, userId: string) => Promise<void>;
  onUpdateGroupDetails: (chatId: string, payload: { name?: string }) => Promise<void>;
  onUploadGroupAvatar: (chatId: string, file: File) => Promise<void>;
  onDeleteGroup: (chatId: string) => Promise<void>;
  onLeaveGroup: (chatId: string) => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
};

const roleLabel = (role: string, t: (key: string) => string) => {
  if (role === 'OWNER') return t('Owner');
  if (role === 'ADMIN') return t('Admin');
  return t('Member');
};

const stateLabel = (state: string, t: (key: string) => string) => {
  if (state === 'ACTIVE') return t('Active');
  if (state === 'BANNED') return t('Banned');
  if (state === 'KICKED') return t('Kicked');
  return t('Left');
};

const normalizeUseridInput = (value: string) => value.trim().replace(/^@/, '');

const ActionButton = ({
  onClick,
  disabled,
  icon,
  text,
  tone
}: {
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  text: string;
  tone: 'blue' | 'violet' | 'amber' | 'rose' | 'orange' | 'green';
}) => {
  const toneClass =
    tone === 'blue'
      ? 'border-blue-500/40 bg-blue-500/15 text-tg-text-primary hover:bg-blue-500/25'
      : tone === 'violet'
        ? 'border-violet-500/40 bg-violet-500/15 text-tg-text-primary hover:bg-violet-500/25'
        : tone === 'amber'
          ? 'border-amber-500/40 bg-amber-500/15 text-tg-text-primary hover:bg-amber-500/25'
          : tone === 'rose'
            ? 'border-rose-500/40 bg-rose-500/15 text-tg-text-primary hover:bg-rose-500/25'
            : tone === 'orange'
              ? 'border-orange-500/40 bg-orange-500/15 text-tg-text-primary hover:bg-orange-500/25'
              : 'border-emerald-500/40 bg-emerald-500/15 text-tg-text-primary hover:bg-emerald-500/25';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`focus-ring inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {icon}
      {text}
    </button>
  );
};

export default function GroupInfoDrawer({
  open,
  chat,
  currentUser,
  members,
  isLoading,
  onClose,
  onRefresh,
  onAddMembers,
  onLookupUserByUserid,
  onRemoveMember,
  onUpdateRole,
  onBanMember,
  onUnbanMember,
  onTransferOwnership,
  onUpdateGroupDetails,
  onUploadGroupAvatar,
  onDeleteGroup,
  onLeaveGroup,
  onNotify
}: GroupInfoDrawerProps) {
  const { t, localizeApiError } = useI18n();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState(chat.name);
  const [isSavingGroupDetails, setIsSavingGroupDetails] = useState(false);
  const [isUploadingGroupAvatar, setIsUploadingGroupAvatar] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);
  const [lookupUserid, setLookupUserid] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<User | null>(null);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [isClearingGroup, setIsClearingGroup] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGroupNameDraft(chat.name);
    setDeleteConfirmName('');
    setClearConfirmText('');
  }, [open, chat.name]);

  useEffect(() => {
    if (!open) {
      setLookupUserid('');
      setLookupResult(null);
    }
  }, [open]);

  const visibleMembers = useMemo(() => members.filter(member => member.state !== 'KICKED'), [members]);
  const activeMemberCount = useMemo(() => members.filter(member => member.state === 'ACTIVE').length, [members]);
  const canManageInvites = Boolean(chat.capabilities?.canInviteMembers);

  const existingLookupMember = useMemo(() => {
    if (!lookupResult) return null;
    return members.find(member => member.userId === lookupResult.id) ?? null;
  }, [lookupResult, members]);

  const runAction = async (key: string, action: () => Promise<void>, successText: string) => {
    setPendingAction(key);
    try {
      await action();
      await onRefresh();
      onNotify(successText, 'success');
    } catch (error) {
      onNotify(localizeApiError(error, 'Action failed'), 'error');
    } finally {
      setPendingAction(null);
    }
  };

  const canManageTarget = (member: GroupMember) => {
    if (member.userId === currentUser.id) return false;
    if (chat.myRole === 'OWNER') return member.role !== 'OWNER';
    if (chat.myRole === 'ADMIN') return member.role === 'MEMBER';
    return false;
  };

  const lookupUser = async () => {
    const normalized = normalizeUseridInput(lookupUserid);
    if (!normalized) {
      onNotify(t('Enter a userid like @charlie'), 'error');
      return;
    }

    setLookupBusy(true);
    try {
      const user = await onLookupUserByUserid(normalized);
      setLookupResult(user);
    } catch (error) {
      setLookupResult(null);
      onNotify(localizeApiError(error, 'User not found'), 'error');
    } finally {
      setLookupBusy(false);
    }
  };

  const canAddLookupUser = Boolean(
    lookupResult &&
      (!existingLookupMember ||
        existingLookupMember.state === 'LEFT' ||
        existingLookupMember.state === 'KICKED')
  );

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
              <h2 className="text-start text-base font-semibold text-tg-text-primary">{t('Group info')}</h2>
              <p className="text-start text-xs text-tg-text-secondary">{chat.name}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring rounded-lg p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
              aria-label={t('Close group info')}
            >
              <X size={16} />
            </button>
          </header>

          <div className="message-scroll flex-1 space-y-4 overflow-y-auto p-4">
            <section className="rounded-2xl border border-tg-border bg-white/5 p-3">
              <p className="text-start text-xs text-tg-text-secondary">{t('Active members: {count}', { count: activeMemberCount })}</p>
              <p className="text-start text-xs text-tg-text-secondary">{t('Your role: {role}', { role: chat.myRole ?? '-' })}</p>
            </section>

            {chat.myRole === 'OWNER' ? (
              <>
                <section className="rounded-2xl border border-tg-border bg-white/5 p-3">
                  <p className="text-start mb-2 text-xs font-semibold text-tg-text-primary">{t('Group settings')}</p>

                  <div className="flex items-center gap-3">
                    {chat.avatarUrl ? (
                      <img src={chat.avatarUrl} alt={`${chat.name} avatar`} className="h-12 w-12 rounded-full object-cover" />
                    ) : (
                      <div
                        className="h-12 w-12 rounded-full text-center text-sm font-semibold leading-[3rem] text-white"
                        style={{ background: getAvatarColor(chat.id) }}
                      >
                        {chat.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}

                    <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-xl border border-tg-border bg-tg-bg-input-field px-3 py-2 text-xs text-tg-text-primary hover:bg-tg-hover">
                      <Camera size={14} />
                      {isUploadingGroupAvatar ? t('Uploading...') : t('Upload group avatar')}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={isUploadingGroupAvatar}
                        onChange={event => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = '';
                          if (!file) return;
                          setIsUploadingGroupAvatar(true);
                          void onUploadGroupAvatar(chat.id, file)
                            .then(() => {
                              onNotify(t('Group avatar updated.'), 'success');
                              void onRefresh();
                            })
                            .catch(error => {
                              onNotify(localizeApiError(error, 'Avatar upload failed'), 'error');
                            })
                            .finally(() => setIsUploadingGroupAvatar(false));
                        }}
                      />
                    </label>
                  </div>

                  <label className="mt-3 block text-xs text-tg-text-secondary">
                    {t('Group name')}
                    <input
                      value={groupNameDraft}
                      onChange={event => setGroupNameDraft(event.target.value)}
                      maxLength={80}
                      className="focus-ring mt-1 h-10 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-3 text-sm text-tg-text-primary"
                      placeholder={t('Group name')}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={
                      isSavingGroupDetails || groupNameDraft.trim().length < 2 || groupNameDraft.trim() === chat.name
                    }
                    onClick={() => {
                      const nextName = groupNameDraft.trim();
                      if (nextName.length < 2) {
                        onNotify(t('Group name must be at least 2 characters'), 'error');
                        return;
                      }
                      setIsSavingGroupDetails(true);
                      void onUpdateGroupDetails(chat.id, { name: nextName })
                        .then(() => {
                          onNotify(t('Group updated.'), 'success');
                          void onRefresh();
                        })
                        .catch(error => {
                          onNotify(localizeApiError(error, 'Failed to update group'), 'error');
                        })
                        .finally(() => setIsSavingGroupDetails(false));
                    }}
                    className="focus-ring mt-3 inline-flex items-center gap-2 rounded-xl bg-tg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
                  >
                    <Save size={14} />
                    {isSavingGroupDetails ? t('Saving...') : t('Save group name')}
                  </button>

                  <div className="mt-3 flex items-center justify-between border-t border-tg-border/50 pt-3">
                    <div>
                      <span className="text-xs text-tg-text-primary">{t('Members can pin messages')}</span>
                      <p className="text-[10px] text-tg-text-secondary">{t('When disabled, only owner/admin can pin messages.')}</p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={chat.defaultPermissions?.canPinMessages !== false}
                        disabled={pendingAction !== null}
                        onChange={async event => {
                          const checked = event.target.checked;
                          const key = 'toggle-pin-perms';
                          setPendingAction(key);
                          try {
                            await apiClient.updateGroup(chat.id, { defaultPermissions: { canPinMessages: checked } });
                            onNotify(t('Group default permissions updated.'), 'success');
                            void onRefresh();
                          } catch (error) {
                            onNotify(localizeApiError(error, 'Failed to update group permissions'), 'error');
                          } finally {
                            setPendingAction(null);
                          }
                        }}
                        className="peer sr-only"
                      />
                      <div className="peer h-5 w-9 rounded-full bg-tg-border after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-tg-accent peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:after:border-gray-600"></div>
                    </label>
                  </div>
                </section>

                <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
                  <p className="text-xs font-semibold text-tg-text-primary">{t('Delete group (owner only)')}</p>
                  <p className="mt-1 text-xs text-tg-text-secondary">
                    {t('Type the exact group name to permanently delete this group for all members.')}
                  </p>
                  <label className="mt-2 block text-xs text-tg-text-primary">
                    {t('Confirm group name')}
                    <input
                      value={deleteConfirmName}
                      onChange={event => setDeleteConfirmName(event.target.value)}
                      className="focus-ring mt-1 h-10 w-full rounded-xl border border-rose-500/40 bg-tg-bg-input-field px-3 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary"
                      placeholder={chat.name}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={isDeletingGroup || deleteConfirmName.trim() !== chat.name}
                    onClick={() => {
                      setIsDeletingGroup(true);
                      void onDeleteGroup(chat.id)
                        .then(() => {
                          onNotify(t('Group deleted.'), 'success');
                          onClose();
                        })
                        .catch(error => {
                          onNotify(localizeApiError(error, 'Failed to delete group'), 'error');
                        })
                        .finally(() => setIsDeletingGroup(false));
                    }}
                    className="focus-ring mt-3 inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-tg-text-primary hover:bg-rose-500/25 disabled:opacity-60"
                  >
                    <Trash2 size={14} />
                    {isDeletingGroup ? t('Deleting...') : t('Delete group')}
                  </button>
                </section>
              </>
            ) : null}

            {chat.myRole === 'OWNER' || (chat.myRole === 'ADMIN' && chat.capabilities?.canDeleteMessages) ? (
              <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
                <p className="text-start text-xs font-semibold text-tg-text-primary">{t('Clear group history')}</p>
                <p className="text-start mt-1 text-xs text-tg-text-secondary">
                  {t('Type DELETE to permanently clear all messages in this group for all members.')}
                </p>
                <label className="mt-2 block text-start text-xs text-tg-text-primary">
                  {t('Confirm clear')}
                  <input
                    value={clearConfirmText}
                    onChange={event => setClearConfirmText(event.target.value)}
                    className="focus-ring mt-1 h-10 w-full rounded-xl border border-rose-500/40 bg-tg-bg-input-field px-3 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary"
                    placeholder="DELETE"
                  />
                </label>
                <button
                  type="button"
                  disabled={isClearingGroup || clearConfirmText.trim() !== 'DELETE'}
                  onClick={() => {
                    setIsClearingGroup(true);
                    void apiClient.clearGroupMessages(chat.id)
                      .then(() => {
                        onNotify(t('Group history cleared.'), 'success');
                        setClearConfirmText('');
                        void onRefresh();
                      })
                      .catch(error => {
                        onNotify(localizeApiError(error, 'Failed to clear history'), 'error');
                      })
                      .finally(() => setIsClearingGroup(false));
                  }}
                  className="focus-ring mt-3 inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-tg-text-primary hover:bg-rose-500/25 disabled:opacity-60"
                >
                  <Eraser size={14} />
                  {isClearingGroup ? t('Clearing...') : t('Clear history')}
                </button>
              </section>
            ) : null}

            {chat.myRole !== 'OWNER' && chat.capabilities?.canLeaveGroup ? (
              <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-start text-xs font-semibold text-tg-text-primary">{t('Leave group')}</p>
                <p className="text-start mt-1 text-xs text-tg-text-secondary">
                  {t('You will stop receiving new messages and lose active membership.')}
                </p>
                <button
                  type="button"
                  disabled={isLeavingGroup}
                  onClick={() => {
                    setIsLeavingGroup(true);
                    void onLeaveGroup(chat.id)
                      .then(() => {
                        onNotify(t('You left the group.'), 'success');
                        onClose();
                      })
                      .catch(error => {
                        onNotify(localizeApiError(error, 'Failed to leave group'), 'error');
                      })
                      .finally(() => setIsLeavingGroup(false));
                  }}
                  className="focus-ring mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-tg-text-primary hover:bg-amber-500/25 disabled:opacity-60"
                >
                  <UserMinus size={14} />
                  {isLeavingGroup ? t('Leaving...') : t('Leave group')}
                </button>
              </section>
            ) : null}

            {canManageInvites ? (
              <section className="rounded-2xl border border-tg-border bg-white/5 p-3">
                <p className="text-start mb-2 text-xs font-semibold text-tg-text-primary">{t('Add member by userid')}</p>
                <div className="flex gap-2">
                  <input
                    value={lookupUserid}
                    onChange={event => {
                      setLookupUserid(event.target.value);
                      setLookupResult(null);
                    }}
                    placeholder="@username"
                    className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-tg-border bg-tg-bg-input-field px-2 text-xs text-tg-text-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void lookupUser()}
                    disabled={lookupBusy}
                    className="focus-ring rounded-lg bg-tg-accent px-3 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
                  >
                    {lookupBusy ? '...' : t('Find')}
                  </button>
                </div>

                {lookupResult ? (
                  <div className="mt-3 rounded-xl border border-tg-border bg-tg-bg-surface p-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="relative h-9 w-9 overflow-hidden rounded-full text-center text-xs font-semibold leading-9 text-white"
                        style={{ background: lookupResult.avatarColor || getAvatarColor(lookupResult.id) }}
                      >
                        {lookupResult.name.slice(0, 2).toUpperCase()}
                        {lookupResult.avatar ? (
                          <img
                            src={lookupResult.avatar}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            onError={event => {
                              event.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-tg-text-primary">{lookupResult.name}</p>
                        <p className="text-start truncate text-xs text-tg-text-secondary"><span dir="ltr">@{lookupResult.username}</span></p>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-tg-text-secondary">
                      {existingLookupMember?.state === 'ACTIVE' ? t('Already an active member') : null}
                      {existingLookupMember?.state === 'BANNED'
                        ? t('User is banned. Unban first before re-adding.')
                        : null}
                      {existingLookupMember?.state === 'LEFT' ? t('User left the group and can be re-added.') : null}
                      {existingLookupMember?.state === 'KICKED' ? t('User was removed and can be re-added.') : null}
                    </div>

                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        disabled={!canAddLookupUser || pendingAction === 'lookup-add'}
                        onClick={() =>
                          void runAction(
                            'lookup-add',
                            async () => {
                              await onAddMembers(chat.id, [lookupResult.id]);
                              setLookupUserid('');
                              setLookupResult(null);
                            },
                            t('Member added.')
                          )
                        }
                        className="focus-ring inline-flex items-center gap-1 rounded-lg bg-tg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
                      >
                        <UserPlus size={12} />
                        {existingLookupMember?.state === 'LEFT' || existingLookupMember?.state === 'KICKED'
                          ? t('Re-add')
                          : t('Add')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-2">
              <p className="text-xs font-semibold text-tg-text-primary">{t('Members')}</p>
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(item => (
                    <div key={item} className="h-14 animate-pulse rounded-xl bg-white/10" />
                  ))}
                </div>
              ) : (
                visibleMembers.map(member => {
                  const manageTarget = canManageTarget(member);
                  const isActive = member.state === 'ACTIVE';
                  const canPromote = chat.myRole === 'OWNER' && isActive && member.role === 'MEMBER' && manageTarget;
                  const canDemote = chat.myRole === 'OWNER' && isActive && member.role === 'ADMIN' && manageTarget;
                  const canTransfer = chat.myRole === 'OWNER' && isActive && member.role !== 'OWNER' && member.userId !== currentUser.id;
                  const canRemove = Boolean(chat.capabilities?.canRemoveMembers) && isActive && manageTarget;
                  const canBan = Boolean(chat.capabilities?.canBanMembers) && isActive && manageTarget;
                  const canUnban = Boolean(chat.capabilities?.canBanMembers) && member.state === 'BANNED';

                  return (
                    <article key={`${member.userId}:${member.state}`} className="rounded-xl border border-tg-border bg-tg-bg-surface p-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="relative h-10 w-10 overflow-hidden rounded-full text-center text-xs font-semibold leading-10 text-white"
                          style={{ background: member.user.avatarColor || getAvatarColor(member.user.id) }}
                        >
                          {member.user.name.slice(0, 2).toUpperCase()}
                          {member.user.avatar ? (
                            <img
                              src={member.user.avatar}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                              onError={event => {
                                event.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-tg-text-primary">{member.user.name}</p>
                          <p className="text-start truncate text-xs text-tg-text-secondary"><span dir="ltr">@{member.user.username}</span></p>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-tg-text-secondary">
                        <span className="rounded-full border border-tg-border px-2 py-0.5">{roleLabel(member.role, t)}</span>
                        <span className="rounded-full border border-tg-border px-2 py-0.5">{stateLabel(member.state, t)}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {canPromote ? (
                          <ActionButton
                            onClick={() =>
                              void runAction(
                                `promote:${member.userId}`,
                                () => onUpdateRole(chat.id, member.userId, 'ADMIN'),
                                t('Member promoted to admin.')
                              )
                            }
                            disabled={pendingAction !== null}
                            icon={<Shield size={12} />}
                            text={t('Promote')}
                            tone="blue"
                          />
                        ) : null}

                        {canDemote ? (
                          <ActionButton
                            onClick={() =>
                              void runAction(
                                `demote:${member.userId}`,
                                () => onUpdateRole(chat.id, member.userId, 'MEMBER'),
                                t('Admin demoted to member.')
                              )
                            }
                            disabled={pendingAction !== null}
                            icon={<ShieldOff size={12} />}
                            text={t('Demote')}
                            tone="violet"
                          />
                        ) : null}

                        {canTransfer ? (
                          <ActionButton
                            onClick={() =>
                              void runAction(
                                `transfer:${member.userId}`,
                                () => onTransferOwnership(chat.id, member.userId),
                                t('Ownership transferred.')
                              )
                            }
                            disabled={pendingAction !== null}
                            icon={<Crown size={12} />}
                            text={t('Transfer owner')}
                            tone="amber"
                          />
                        ) : null}

                        {canRemove ? (
                          <ActionButton
                            onClick={() =>
                              void runAction(
                                `remove:${member.userId}`,
                                () => onRemoveMember(chat.id, member.userId),
                                t('Member removed from group.')
                              )
                            }
                            disabled={pendingAction !== null}
                            icon={<UserMinus size={12} />}
                            text={t('Remove')}
                            tone="rose"
                          />
                        ) : null}

                        {canBan ? (
                          <ActionButton
                            onClick={() =>
                              void runAction(
                                `ban:${member.userId}`,
                                () => onBanMember(chat.id, member.userId),
                                t('Member banned.')
                              )
                            }
                            disabled={pendingAction !== null}
                            icon={<Ban size={12} />}
                            text={t('Ban')}
                            tone="orange"
                          />
                        ) : null}

                        {canUnban ? (
                          <ActionButton
                            onClick={() =>
                              void runAction(
                                `unban:${member.userId}`,
                                () => onUnbanMember(chat.id, member.userId),
                                t('Member unbanned.')
                              )
                            }
                            disabled={pendingAction !== null}
                            icon={<UserRoundCheck size={12} />}
                            text={t('Unban')}
                            tone="green"
                          />
                        ) : null}
                      </div>

                      {chat.myRole === 'OWNER' && member.role === 'ADMIN' && member.state === 'ACTIVE' ? (
                        <div className="mt-3 flex items-center justify-between border-t border-tg-border/50 pt-2">
                          <span className="text-[11px] text-tg-text-secondary">{t('Can delete messages')}</span>
                          <label className="relative inline-flex cursor-pointer items-center">
                            <input
                              type="checkbox"
                              checked={member.permissions?.canDeleteMessages ?? false}
                              disabled={pendingAction !== null}
                              onChange={async event => {
                                const checked = event.target.checked;
                                const key = `toggle-perm:${member.userId}`;
                                setPendingAction(key);
                                try {
                                  await apiClient.updateGroupMemberPermissions(chat.id, member.userId, {
                                    canDeleteMessages: checked
                                  });
                                  onNotify(t('Admin permissions updated.'), 'success');
                                  void onRefresh();
                                } catch (error) {
                                  onNotify(localizeApiError(error, 'Failed to update permissions'), 'error');
                                } finally {
                                  setPendingAction(null);
                                }
                              }}
                              className="peer sr-only"
                            />
                            <div className="peer h-5 w-9 rounded-full bg-tg-border after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-tg-accent peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:after:border-gray-600"></div>
                          </label>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}
