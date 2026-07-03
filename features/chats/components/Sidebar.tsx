import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Ban,
  Check,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiClient } from '../../../services/apiClient';
import { Chat, Contact, ThemeMode, User, MediaLimits } from '../../../types';
import { useI18n } from '../../../hooks/useI18n';
import AdminPanel from '../../admin/components/AdminPanel';
import ContactsPanel from '../../contacts/components/ContactsPanel';
import CreateGroupModal from '../../groups/components/CreateGroupModal';
import ProfileMenu from '../../profile/components/ProfileMenu';
import ChatList from './ChatList';
import ChatSearch from './ChatSearch';

type SidebarProps = {
  currentUser: User;
  chats: Chat[];
  users: User[];
  contacts: Contact[];
  activeChatId: string | null;
  onChatSelect: (id: string) => void;
  onStartChat: (userId: string) => Promise<void>;
  onCreateGroup: (name: string, participantIds: string[]) => Promise<void>;
  onToggleTheme: () => void;
  language: 'en' | 'fa';
  onToggleLanguage: () => void;
  theme: ThemeMode;
  onTogglePin: (chat: Chat) => Promise<void>;
  onToggleMute: (chat: Chat) => Promise<void>;
  onSearchChats: (query: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onOpenProfileSettings: () => void;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
  onUpsertContact: (userId: string, customName?: string | null, isFavorite?: boolean) => Promise<void>;
  onRemoveContact: (userId: string) => Promise<void>;
  onBlockContact: (userId: string) => Promise<void>;
  onUnblockContact: (userId: string) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  onLookupUserByUserid: (userid: string) => Promise<User>;
  isInitialLoadingChats?: boolean;
  isRefreshingChats?: boolean;
  onUpdateMediaLimits: (limits: MediaLimits) => void;
};

const normalizeUseridInput = (value: string) => value.trim().replace(/^@/, '');

export default function Sidebar({
  currentUser,
  chats,
  users,
  contacts,
  activeChatId,
  onChatSelect,
  onStartChat,
  onCreateGroup,
  onToggleTheme,
  language,
  onToggleLanguage,
  theme,
  onTogglePin,
  onToggleMute,
  onSearchChats,
  onLogout,
  onOpenProfileSettings,
  onNotify,
  onUpsertContact,
  onRemoveContact,
  onBlockContact,
  onUnblockContact,
  onDeleteUser,
  onLookupUserByUserid,
  isInitialLoadingChats,
  isRefreshingChats,
  onUpdateMediaLimits
}: SidebarProps) {
  const { locale, t, localizeApiError, formatDate, formatTime } = useI18n();
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts'>('chats');
  const [searchTerm, setSearchTerm] = useState('');
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMemberSearch, setGroupMemberSearch] = useState('');
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [contactActionKey, setContactActionKey] = useState<string | null>(null);
  const [lookupUserid, setLookupUserid] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<User | null>(null);
  const initialSearchRunSkippedRef = useRef(false);
  const lastSearchValueRef = useRef('');

  // Root admin state
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<'public' | 'private'>('public');
  const [registrationRequiredFields, setRegistrationRequiredFields] = useState<{
    lastName: boolean;
    email: boolean;
    phone: boolean;
  }>({
    lastName: false,
    email: false,
    phone: false
  });
  const [isRegistrationFieldsSaving, setIsRegistrationFieldsSaving] = useState(false);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [isPendingUsersLoading, setIsPendingUsersLoading] = useState(false);
  const [isRegistrationModeSaving, setIsRegistrationModeSaving] = useState(false);
  const [pendingActionUserId, setPendingActionUserId] = useState<string | null>(null);
  const [adminLoadError, setAdminLoadError] = useState<string | null>(null);

  const [mediaLimits, setMediaLimitsState] = useState<MediaLimits>({
    voice: 0.03,
    audio: 0.03,
    photo: 0.03,
    video: 0.03
  });
  const [localVoice, setLocalVoice] = useState('0.03');
  const [localAudio, setLocalAudio] = useState('0.03');
  const [localPhoto, setLocalPhoto] = useState('0.03');
  const [localVideo, setLocalVideo] = useState('0.03');
  const [isMediaLimitsSaving, setIsMediaLimitsSaving] = useState(false);
  const [rootDeleteConfirmText, setRootDeleteConfirmText] = useState('');
  const [isDeletingAllMessages, setIsDeletingAllMessages] = useState(false);
  const [isDeletingAllMedia, setIsDeletingAllMedia] = useState(false);

  const loadAdminData = useCallback(async () => {
    if (!currentUser.isRoot) return;
    setIsPendingUsersLoading(true);
    setAdminLoadError(null);
    try {
      const settingsRes = await apiClient.getAdminSettings();
      setRegistrationMode(settingsRes.registrationMode);
      if (settingsRes.registrationRequiredFields) {
        setRegistrationRequiredFields(settingsRes.registrationRequiredFields);
      }
      if (settingsRes.mediaLimits) {
        setMediaLimitsState(settingsRes.mediaLimits);
        setLocalVoice(String(settingsRes.mediaLimits.voice));
        setLocalAudio(String(settingsRes.mediaLimits.audio));
        setLocalPhoto(String(settingsRes.mediaLimits.photo));
        setLocalVideo(String(settingsRes.mediaLimits.video));
        onUpdateMediaLimits(settingsRes.mediaLimits);
      }
      const pendingRes = await apiClient.getPendingUsers();
      setPendingUsers(pendingRes.users);
    } catch (err) {
      console.error('Failed to load admin settings:', err);
      setAdminLoadError(localizeApiError(err, t('Failed to load admin settings.')));
    } finally {
      setIsPendingUsersLoading(false);
    }
  }, [currentUser.isRoot, localizeApiError, t, onUpdateMediaLimits]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const handleSetRegistrationMode = async (mode: 'public' | 'private') => {
    if (isRegistrationModeSaving || registrationMode === mode) return;
    setIsRegistrationModeSaving(true);
    try {
      const res = await apiClient.updateRegistrationMode(mode);
      setRegistrationMode(res.registrationMode);
      onNotify(t('Registration mode updated successfully'), 'success');
    } catch (err) {
      onNotify(localizeApiError(err, t('Failed to update registration mode')), 'error');
    } finally {
      setIsRegistrationModeSaving(false);
    }
  };

  const handleUpdateRegistrationRequiredFields = async (field: 'lastName' | 'email' | 'phone', val: boolean) => {
    if (isRegistrationFieldsSaving) return;
    const newFields = {
      ...registrationRequiredFields,
      [field]: val
    };
    setIsRegistrationFieldsSaving(true);
    try {
      const res = await apiClient.updateRegistrationRequiredFields(newFields);
      setRegistrationRequiredFields(res.registrationRequiredFields);
      onNotify(t('Registration settings updated successfully'), 'success');
    } catch (err) {
      onNotify(localizeApiError(err, t('Failed to update registration settings')), 'error');
    } finally {
      setIsRegistrationFieldsSaving(false);
    }
  };

  const handleUpdateMediaLimits = async (type: keyof MediaLimits, val: number) => {
    if (isMediaLimitsSaving) return;
    const newLimits = {
      ...mediaLimits,
      [type]: val
    };
    setMediaLimitsState(newLimits);
    setIsMediaLimitsSaving(true);
    try {
      const res = await apiClient.updateMediaLimits(newLimits);
      setMediaLimitsState(res.mediaLimits);
      setLocalVoice(String(res.mediaLimits.voice));
      setLocalAudio(String(res.mediaLimits.audio));
      setLocalPhoto(String(res.mediaLimits.photo));
      setLocalVideo(String(res.mediaLimits.video));
      onUpdateMediaLimits(res.mediaLimits);
      onNotify(t('Media limits updated successfully'), 'success');
    } catch (err) {
      onNotify(localizeApiError(err, t('Failed to update media limits')), 'error');
      void loadAdminData();
    } finally {
      setIsMediaLimitsSaving(false);
    }
  };

  const handleCommitMediaLimit = async (type: keyof MediaLimits, strVal: string) => {
    const val = parseFloat(strVal);
    if (isNaN(val) || !Number.isFinite(val) || val <= 0) {
      if (type === 'voice') setLocalVoice(String(mediaLimits.voice));
      if (type === 'audio') setLocalAudio(String(mediaLimits.audio));
      if (type === 'photo') setLocalPhoto(String(mediaLimits.photo));
      if (type === 'video') setLocalVideo(String(mediaLimits.video));
      return;
    }
    await handleUpdateMediaLimits(type, val);
  };

  const handleApproveUser = async (userId: string) => {
    if (pendingActionUserId) return;
    setPendingActionUserId(userId);
    try {
      await apiClient.approveUser(userId);
      setPendingUsers(prev => prev.filter(u => u.id !== userId));
      onNotify(t('User approved successfully.'), 'success');
    } catch (err) {
      onNotify(localizeApiError(err, t('Failed to approve user')), 'error');
    } finally {
      setPendingActionUserId(null);
    }
  };

  const handleRejectUser = async (userId: string) => {
    if (pendingActionUserId) return;
    const confirmed = window.confirm(t('Are you sure you want to reject this user?'));
    if (!confirmed) return;

    setPendingActionUserId(userId);
    try {
      await apiClient.rejectUser(userId);
      setPendingUsers(prev => prev.filter(u => u.id !== userId));
      onNotify(t('User rejected successfully.'), 'success');
    } catch (err) {
      onNotify(localizeApiError(err, t('Failed to reject user')), 'error');
    } finally {
      setPendingActionUserId(null);
    }
  };

  const contactsByUserId = useMemo(
    () => new Map<string, Contact>(contacts.map(contact => [contact.userId, contact])),
    [contacts]
  );

  const chatDisplayTimeById = useMemo(() => {
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();
    const nowDate = now.getDate();

    const output = new Map<string, string>();
    for (const chat of chats) {
      const sourceTime = chat.lastMessage?.timestamp || chat.lastActivityAt;
      if (!sourceTime) {
        output.set(chat.id, '');
        continue;
      }

      const parsed = new Date(sourceTime);
      if (Number.isNaN(parsed.getTime())) {
        output.set(chat.id, '');
        continue;
      }

      const isToday =
        parsed.getFullYear() === nowYear && parsed.getMonth() === nowMonth && parsed.getDate() === nowDate;
      output.set(
        chat.id,
        isToday
          ? formatTime(parsed, { hour: '2-digit', minute: '2-digit' })
          : formatDate(parsed, { month: 'short', day: 'numeric' })
      );
    }

    return output;
  }, [chats, formatDate, formatTime]);

  useEffect(() => {
    if (activeTab !== 'chats') return;
    if (!initialSearchRunSkippedRef.current) {
      initialSearchRunSkippedRef.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      const nextQuery = searchTerm.trim();
      if (nextQuery === lastSearchValueRef.current) {
        return;
      }
      lastSearchValueRef.current = nextQuery;

      void onSearchChats(nextQuery).catch(error => {
        onNotify(localizeApiError(error, 'Chat search failed'), 'error');
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [activeTab, onNotify, onSearchChats, searchTerm]);

  const filteredContacts = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase();
    const scopedContacts = contacts
      .map(contact => ({
        ...contact,
        user: contact.user
      }))
      .filter(contact => contact.user.id !== currentUser.id);

    if (!lower) {
      return scopedContacts;
    }

    return scopedContacts.filter(contact => {
      const alias = contact.customName?.toLowerCase() ?? '';
      return (
        contact.user.name.toLowerCase().includes(lower) ||
        contact.user.username.toLowerCase().includes(lower) ||
        alias.includes(lower)
      );
    });
  }, [contacts, currentUser.id, searchTerm]);

  const rootDirectoryUsers = useMemo(() => {
    if (!currentUser.isRoot) {
      return [];
    }

    const lower = searchTerm.trim().toLowerCase();
    const sortedUsers = [...users]
      .filter(user => user.id !== currentUser.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!lower) {
      return sortedUsers;
    }

    return sortedUsers.filter(user => {
      const alias = contactsByUserId.get(user.id)?.customName?.toLowerCase() ?? '';
      return user.name.toLowerCase().includes(lower) || user.username.toLowerCase().includes(lower) || alias.includes(lower);
    });
  }, [contactsByUserId, currentUser.id, currentUser.isRoot, searchTerm, users]);

  const groupSelectableContacts = useMemo(() => {
    const lower = groupMemberSearch.trim().toLowerCase();
    const activeContacts = contacts.filter(contact => !contact.isBlocked);
    if (!lower) {
      return activeContacts;
    }

    return activeContacts.filter(contact => {
      const alias = contact.customName?.toLowerCase() ?? '';
      return (
        contact.user.name.toLowerCase().includes(lower) ||
        contact.user.username.toLowerCase().includes(lower) ||
        alias.includes(lower)
      );
    });
  }, [contacts, groupMemberSearch]);

  const closeGroupModal = () => {
    setShowGroupModal(false);
    setGroupName('');
    setGroupMemberSearch('');
    setSelectedGroupMemberIds([]);
  };

  const toggleGroupMember = (userId: string) => {
    setSelectedGroupMemberIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const createGroup = async () => {
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      onNotify(t('Group name is required'), 'error');
      return;
    }
    if (selectedGroupMemberIds.length < 1) {
      onNotify(t('Select at least one contact'), 'error');
      return;
    }

    setIsBusy(true);
    try {
      await onCreateGroup(trimmedName, selectedGroupMemberIds);
      closeGroupModal();
      onNotify(t('Group created with selected contacts.'), 'success');
    } catch (error) {
      onNotify(localizeApiError(error, 'Group creation failed'), 'error');
    } finally {
      setIsBusy(false);
    }
  };

  const startChat = async (userId: string) => {
    setIsBusy(true);
    try {
      await onStartChat(userId);
      setActiveTab('chats');
    } catch (error) {
      onNotify(localizeApiError(error, 'Failed to open chat'), 'error');
    } finally {
      setIsBusy(false);
    }
  };

  const runContactAction = async (actionKey: string, action: () => Promise<void>, successMessage: string) => {
    setContactActionKey(actionKey);
    try {
      await action();
      onNotify(successMessage, 'success');
    } catch (error) {
      onNotify(localizeApiError(error, 'Contact action failed'), 'error');
    } finally {
      setContactActionKey(null);
    }
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

  const confirmRootDelete = (user: User) => {
    const confirmedUsername = window.prompt(t('Type "{username}" to deactivate and anonymize this user account.', { username: user.username }));
    if (confirmedUsername === null) {
      return false;
    }
    if (confirmedUsername.trim() !== user.username) {
      onNotify(t('Confirmation username did not match'), 'error');
      return false;
    }
    return true;
  };

  const renderContactActions = (user: User, contact?: Contact) => {
    const isContact = Boolean(contact);
    const isBlocked = Boolean(contact?.isBlocked);
    const isFavorite = Boolean(contact?.isFavorite);
    const isActionBusy = contactActionKey !== null;

    return (
      <div className="flex flex-wrap gap-1 px-2 pb-2">
        {isContact ? (
          <button
            type="button"
            disabled={isActionBusy}
            onClick={() =>
              void runContactAction(`remove:${user.id}`, () => onRemoveContact(user.id), t('Contact removed'))
            }
            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] text-tg-text-primary hover:bg-rose-500/25 disabled:opacity-60"
          >
            <UserMinus size={12} />
            {t('Remove')}
          </button>
        ) : (
          <button
            type="button"
            disabled={isActionBusy}
            onClick={() => void runContactAction(`add:${user.id}`, () => onUpsertContact(user.id), t('Contact added'))}
            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] text-tg-text-primary hover:bg-emerald-500/25 disabled:opacity-60"
          >
            <UserPlus size={12} />
            {t('Add')}
          </button>
        )}

        {isContact ? (
          <button
            type="button"
            disabled={isActionBusy}
            onClick={() =>
              void runContactAction(
                `${isBlocked ? 'unblock' : 'block'}:${user.id}`,
                () => (isBlocked ? onUnblockContact(user.id) : onBlockContact(user.id)),
                isBlocked ? t('Contact unblocked') : t('Contact blocked')
              )
            }
            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-orange-500/40 bg-orange-500/15 px-2 py-1 text-[11px] text-tg-text-primary hover:bg-orange-500/25 disabled:opacity-60"
          >
            <Ban size={12} />
            {isBlocked ? t('Unblock') : t('Block')}
          </button>
        ) : null}

        {isContact ? (
          <button
            type="button"
            disabled={isActionBusy}
            onClick={() =>
              void runContactAction(
                `favorite:${user.id}`,
                () => onUpsertContact(user.id, contact?.customName ?? null, !isFavorite),
                !isFavorite ? t('Marked as favorite') : t('Removed from favorites')
              )
            }
            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[11px] text-tg-text-primary hover:bg-amber-500/25 disabled:opacity-60"
          >
            {isFavorite ? <Check size={12} /> : <Star size={12} />}
            {isFavorite ? t('Unfavorite') : t('Favorite')}
          </button>
        ) : null}

        {currentUser.isRoot && !user.isRoot ? (
          <button
            type="button"
            disabled={isActionBusy}
            onClick={() => {
              if (!confirmRootDelete(user)) {
                return;
              }
              void runContactAction(
                `delete:${user.id}`,
                () => onDeleteUser(user.id),
                t('User deactivated')
              );
            }}
            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-rose-600/50 bg-rose-600/20 px-2 py-1 text-[11px] text-tg-text-primary hover:bg-rose-600/30 disabled:opacity-60"
          >
            <Trash2 size={12} />
            {t('Deactivate')}
          </button>
        ) : null}
      </div>
    );
  };

  const handleDeleteAllMessages = async () => {
    const confirmed = window.confirm(
      t('CRITICAL WARNING: This will permanently delete ALL messages in all chats, saved messages and groups across the entire platform. This action is irreversible. Proceed?')
    );
    if (!confirmed) return;
    setIsDeletingAllMessages(true);
    try {
      const res = await apiClient.adminDeleteAllMessages();
      onNotify(t('Successfully deleted all messages ({count} deleted).', { count: res.deletedCount }), 'success');
      setRootDeleteConfirmText('');
    } catch (error) {
      onNotify(localizeApiError(error, 'Failed to delete all messages'), 'error');
    } finally {
      setIsDeletingAllMessages(false);
    }
  };

  const handleDeleteAllMedia = async () => {
    const confirmed = window.confirm(
      t('CRITICAL WARNING: This will permanently delete ALL messages containing media (and their physical files on disk) across the entire platform. This action is irreversible. Proceed?')
    );
    if (!confirmed) return;
    setIsDeletingAllMedia(true);
    try {
      const res = await apiClient.adminDeleteAllMedia();
      onNotify(t('Successfully deleted all media messages ({count} deleted).', { count: res.deletedCount }), 'success');
      setRootDeleteConfirmText('');
    } catch (error) {
      onNotify(localizeApiError(error, 'Failed to delete all media'), 'error');
    } finally {
      setIsDeletingAllMedia(false);
    }
  };

  return (
    <aside className="relative flex h-[100dvh] min-h-0 w-full flex-col border-r border-tg-border bg-tg-bg-sidebar">
      <ProfileMenu
        currentUser={currentUser}
        theme={theme}
        language={language}
        onOpenProfileSettings={onOpenProfileSettings}
        onToggleTheme={onToggleTheme}
        onToggleLanguage={onToggleLanguage}
        onLogout={onLogout}
        t={t}
      />

      <div className="flex-1 overflow-y-auto min-h-0 sidebar-scroll flex flex-col">
        {currentUser.isRoot ? (
          <AdminPanel
            showAdminPanel={showAdminPanel}
            setShowAdminPanel={setShowAdminPanel}
            pendingUsers={pendingUsers}
            isPendingUsersLoading={isPendingUsersLoading}
            loadAdminData={loadAdminData}
            registrationMode={registrationMode}
            registrationRequiredFields={registrationRequiredFields}
            isRegistrationModeSaving={isRegistrationModeSaving}
            isRegistrationFieldsSaving={isRegistrationFieldsSaving}
            onSetRegistrationMode={handleSetRegistrationMode}
            onUpdateRegistrationRequiredFields={handleUpdateRegistrationRequiredFields}
            localVoice={localVoice}
            localAudio={localAudio}
            localPhoto={localPhoto}
            localVideo={localVideo}
            setLocalVoice={setLocalVoice}
            setLocalAudio={setLocalAudio}
            setLocalPhoto={setLocalPhoto}
            setLocalVideo={setLocalVideo}
            isMediaLimitsSaving={isMediaLimitsSaving}
            onCommitMediaLimit={handleCommitMediaLimit}
            pendingActionUserId={pendingActionUserId}
            adminLoadError={adminLoadError}
            onApproveUser={handleApproveUser}
            onRejectUser={handleRejectUser}
            rootDeleteConfirmText={rootDeleteConfirmText}
            setRootDeleteConfirmText={setRootDeleteConfirmText}
            isDeletingAllMessages={isDeletingAllMessages}
            isDeletingAllMedia={isDeletingAllMedia}
            onDeleteAllMessages={handleDeleteAllMessages}
            onDeleteAllMedia={handleDeleteAllMedia}
            t={t}
          />
        ) : null}
      <div className="flex items-center gap-2 border-b border-tg-border px-3 py-3 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('chats')}
          className={`focus-ring flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${activeTab === 'chats' ? 'bg-tg-accent text-white' : 'bg-tg-bg-input-field text-tg-text-secondary hover:bg-tg-hover'
            }`}
        >
          {t('Chats')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('contacts')}
          className={`focus-ring flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${activeTab === 'contacts'
              ? 'bg-tg-accent text-white'
              : 'bg-tg-bg-input-field text-tg-text-secondary hover:bg-tg-hover'
            }`}
        >
          {t('Contacts')}
        </button>
      </div>

      <ChatSearch
        activeTab={activeTab}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        t={t}
      />
      <div className="flex items-center gap-2 px-3 pb-3 shrink-0">
        <button
          type="button"
          onClick={() => setShowGroupModal(true)}
          className="focus-ring inline-flex items-center gap-2 rounded-xl border border-tg-border bg-tg-bg-input-field px-3 py-2 text-xs text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
        >
          <Users size={14} />
          {t('New group')}
        </button>
      </div>

      <div className="px-2 pb-4 flex-1">
        {activeTab === 'chats' ? (
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            currentUserId={currentUser.id}
            chatDisplayTimeById={chatDisplayTimeById}
            isInitialLoadingChats={isInitialLoadingChats}
            isRefreshingChats={isRefreshingChats}
            onChatSelect={onChatSelect}
            onTogglePin={onTogglePin}
            onToggleMute={onToggleMute}
            onNotify={onNotify}
            localizeApiError={localizeApiError}
            t={t}
          />
        ) : (
          <ContactsPanel
            currentUser={currentUser}
            filteredContacts={filteredContacts}
            rootDirectoryUsers={rootDirectoryUsers}
            contactsByUserId={contactsByUserId}
            lookupUserid={lookupUserid}
            setLookupUserid={setLookupUserid}
            lookupResult={lookupResult}
            setLookupResult={setLookupResult}
            lookupBusy={lookupBusy}
            isBusy={isBusy}
            lookupUser={lookupUser}
            startChat={startChat}
            renderContactActions={renderContactActions}
            t={t}
          />
        )}
      </div>
    </div>
      {showGroupModal ? (
        <CreateGroupModal
          groupName={groupName}
          setGroupName={setGroupName}
          groupMemberSearch={groupMemberSearch}
          setGroupMemberSearch={setGroupMemberSearch}
          selectedGroupMemberIds={selectedGroupMemberIds}
          groupSelectableContacts={groupSelectableContacts}
          contactsByUserId={contactsByUserId}
          isBusy={isBusy}
          closeGroupModal={closeGroupModal}
          toggleGroupMember={toggleGroupMember}
          createGroup={createGroup}
          t={t}
        />
      ) : null}    </aside>
  );
}
