import AuthScreen from '../../components/AuthScreen';
import ChatWindow from '../../components/ChatWindow';
import ProfileSettingsPage from '../../components/ProfileSettingsPage';
import Sidebar from '../../components/Sidebar';
import { I18nProvider } from '../../hooks/useI18n';
import PwaInstallPrompt from '../pwa/PwaInstallPrompt';
import type { AppLocale, Chat, Contact, MediaLimits, Message, ThemeMode, ToastMessage, User } from '../../types';
import ToastHost from '../../shared/ui/ToastHost';
import type { UserSettingsDto } from '../settings/useThemeLanguage';

type AuthScreenProps = Parameters<typeof AuthScreen>[0];
type SidebarProps = Parameters<typeof Sidebar>[0];
type ChatWindowProps = Parameters<typeof ChatWindow>[0];
type ProfileSettingsPageProps = Parameters<typeof ProfileSettingsPage>[0];

type AppShellProps = {
  isBootstrapping: boolean;
  loadingText: string;
  emptyStateText: string;
  language: AppLocale;
  theme: ThemeMode;
  currentUser: User | null;
  isAuthLoading: boolean;
  onLogin: AuthScreenProps['onLogin'];
  onRegister: AuthScreenProps['onRegister'];
  chats: Chat[];
  users: User[];
  contacts: Contact[];
  activeChatId: string | null;
  activeChat: Chat | null;
  isMobile: boolean;
  isInitialChatsLoading: boolean;
  isChatsRefreshing: boolean;
  onChatSelect: SidebarProps['onChatSelect'];
  onStartChat: SidebarProps['onStartChat'];
  onCreateGroup: SidebarProps['onCreateGroup'];
  onToggleTheme: SidebarProps['onToggleTheme'];
  onToggleLanguage: SidebarProps['onToggleLanguage'];
  onTogglePin: SidebarProps['onTogglePin'];
  onToggleMute: SidebarProps['onToggleMute'];
  onSearchChats: SidebarProps['onSearchChats'];
  onLogout: SidebarProps['onLogout'];
  onOpenProfileSettings: () => void;
  onNotify: SidebarProps['onNotify'];
  onUpsertContact: SidebarProps['onUpsertContact'];
  onRemoveContact: SidebarProps['onRemoveContact'];
  onBlockContact: SidebarProps['onBlockContact'];
  onUnblockContact: SidebarProps['onUnblockContact'];
  onDeleteUser: SidebarProps['onDeleteUser'];
  onLookupUserByUserid: SidebarProps['onLookupUserByUserid'];
  onUpdateMediaLimits: SidebarProps['onUpdateMediaLimits'];
  onBack: ChatWindowProps['onBack'];
  onSendMessage: ChatWindowProps['onSendMessage'];
  onSendMedia: ChatWindowProps['onSendMedia'];
  onEditMessage: ChatWindowProps['onEditMessage'];
  onDeleteMessage: ChatWindowProps['onDeleteMessage'];
  onToggleReaction: ChatWindowProps['onToggleReaction'];
  onPinMessage: ChatWindowProps['onPinMessage'];
  onUnpinMessage: ChatWindowProps['onUnpinMessage'];
  pinnedMessagesByChat: Map<string, Message[]>;
  onTypingStart: ChatWindowProps['onTypingStart'];
  onTypingStop: ChatWindowProps['onTypingStop'];
  onSearchMessages: ChatWindowProps['onSearchMessages'];
  onLoadGroupMembers: ChatWindowProps['onLoadGroupMembers'];
  onAddGroupMembers: ChatWindowProps['onAddGroupMembers'];
  onRemoveGroupMember: ChatWindowProps['onRemoveGroupMember'];
  onUpdateGroupMemberRole: ChatWindowProps['onUpdateGroupMemberRole'];
  onBanGroupMember: ChatWindowProps['onBanGroupMember'];
  onUnbanGroupMember: ChatWindowProps['onUnbanGroupMember'];
  onTransferOwnership: ChatWindowProps['onTransferOwnership'];
  onUpdateGroupDetails: ChatWindowProps['onUpdateGroupDetails'];
  onUploadGroupAvatar: ChatWindowProps['onUploadGroupAvatar'];
  onDeleteGroup: ChatWindowProps['onDeleteGroup'];
  onLeaveGroup: ChatWindowProps['onLeaveGroup'];
  onLoadUserProfile: ChatWindowProps['onLoadUserProfile'];
  mediaLimits: MediaLimits;
  onLoadOlderMessages: (chatId: string) => Promise<void>;
  isLoadingOlder: Record<string, boolean>;
  showProfileSettings: boolean;
  settings: UserSettingsDto | null;
  onCloseProfileSettings: () => void;
  onSaveName: ProfileSettingsPageProps['onSaveName'];
  onUploadAvatar: ProfileSettingsPageProps['onUploadAvatar'];
  onLoadSettings: ProfileSettingsPageProps['onLoadSettings'];
  onSaveSettings: ProfileSettingsPageProps['onSaveSettings'];
  onListSessions: ProfileSettingsPageProps['onListSessions'];
  onTerminateSession: ProfileSettingsPageProps['onTerminateSession'];
  onLogoutCurrentSession: ProfileSettingsPageProps['onLogoutCurrentSession'];
  toasts: ToastMessage[];
};

export default function AppShell({
  isBootstrapping,
  loadingText,
  emptyStateText,
  language,
  theme,
  currentUser,
  isAuthLoading,
  onLogin,
  onRegister,
  chats,
  users,
  contacts,
  activeChatId,
  activeChat,
  isMobile,
  isInitialChatsLoading,
  isChatsRefreshing,
  onChatSelect,
  onStartChat,
  onCreateGroup,
  onToggleTheme,
  onToggleLanguage,
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
  onUpdateMediaLimits,
  onBack,
  onSendMessage,
  onSendMedia,
  onEditMessage,
  onDeleteMessage,
  onToggleReaction,
  onPinMessage,
  onUnpinMessage,
  pinnedMessagesByChat,
  onTypingStart,
  onTypingStop,
  onSearchMessages,
  onLoadGroupMembers,
  onAddGroupMembers,
  onRemoveGroupMember,
  onUpdateGroupMemberRole,
  onBanGroupMember,
  onUnbanGroupMember,
  onTransferOwnership,
  onUpdateGroupDetails,
  onUploadGroupAvatar,
  onDeleteGroup,
  onLeaveGroup,
  onLoadUserProfile,
  mediaLimits,
  onLoadOlderMessages,
  isLoadingOlder,
  showProfileSettings,
  settings,
  onCloseProfileSettings,
  onSaveName,
  onUploadAvatar,
  onLoadSettings,
  onSaveSettings,
  onListSessions,
  onTerminateSession,
  onLogoutCurrentSession,
  toasts
}: AppShellProps) {
  if (isBootstrapping) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-tg-bg-page text-tg-text-primary">
        {loadingText}
      </div>
    );
  }

  return (
    <I18nProvider locale={language}>
      {!currentUser ? (
        <AuthScreen isLoading={isAuthLoading} onLogin={onLogin} onRegister={onRegister} />
      ) : (
        <div className="flex h-[100dvh] w-full overflow-hidden bg-tg-bg-page text-tg-text-primary">
          <div className={`${isMobile && activeChatId ? 'hidden' : 'flex'} h-[100dvh] w-full md:w-[23rem] md:shrink-0`}>
            <Sidebar
              currentUser={currentUser}
              chats={chats}
              users={users}
              contacts={contacts}
              activeChatId={activeChatId}
              onChatSelect={onChatSelect}
              onStartChat={onStartChat}
              onCreateGroup={onCreateGroup}
              onToggleTheme={onToggleTheme}
              language={language}
              onToggleLanguage={onToggleLanguage}
              theme={theme}
              onTogglePin={onTogglePin}
              onToggleMute={onToggleMute}
              onSearchChats={onSearchChats}
              onLogout={onLogout}
              onOpenProfileSettings={onOpenProfileSettings}
              onNotify={onNotify}
              onUpsertContact={onUpsertContact}
              onRemoveContact={onRemoveContact}
              onBlockContact={onBlockContact}
              onUnblockContact={onUnblockContact}
              onDeleteUser={onDeleteUser}
              onLookupUserByUserid={onLookupUserByUserid}
              isInitialLoadingChats={isInitialChatsLoading}
              isRefreshingChats={isChatsRefreshing}
              onUpdateMediaLimits={onUpdateMediaLimits}
            />
          </div>

          <div className={`${isMobile && !activeChatId ? 'hidden' : 'flex'} min-w-0 flex-1`}>
            {activeChat ? (
              <ChatWindow
                chat={activeChat}
                currentUser={currentUser}
                users={users}
                contacts={contacts}
                isMobile={isMobile}
                onBack={onBack}
                onSendMessage={onSendMessage}
                onSendMedia={onSendMedia}
                onEditMessage={onEditMessage}
                onDeleteMessage={onDeleteMessage}
                onToggleReaction={onToggleReaction}
                onPinMessage={onPinMessage}
                onUnpinMessage={onUnpinMessage}
                pinnedMessages={pinnedMessagesByChat.get(activeChat.id) ?? []}
                onTypingStart={onTypingStart}
                onTypingStop={onTypingStop}
                onSearchMessages={onSearchMessages}
                onLoadGroupMembers={onLoadGroupMembers}
                onAddGroupMembers={onAddGroupMembers}
                onLookupUserByUserid={onLookupUserByUserid}
                onRemoveGroupMember={onRemoveGroupMember}
                onUpdateGroupMemberRole={onUpdateGroupMemberRole}
                onBanGroupMember={onBanGroupMember}
                onUnbanGroupMember={onUnbanGroupMember}
                onTransferOwnership={onTransferOwnership}
                onUpdateGroupDetails={onUpdateGroupDetails}
                onUploadGroupAvatar={onUploadGroupAvatar}
                onDeleteGroup={onDeleteGroup}
                onLeaveGroup={onLeaveGroup}
                onLoadUserProfile={onLoadUserProfile}
                onUpsertContact={onUpsertContact}
                onRemoveContact={onRemoveContact}
                onBlockContact={onBlockContact}
                onUnblockContact={onUnblockContact}
                onNotify={onNotify}
                mediaLimits={mediaLimits}
                onLoadOlderMessages={() => onLoadOlderMessages(activeChat.id)}
                isLoadingOlder={Boolean(isLoadingOlder[activeChat.id])}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center bg-tg-bg-chat chat-wallpaper p-8 text-center text-tg-text-secondary">
                {emptyStateText}
              </div>
            )}
          </div>
        </div>
      )}

      {showProfileSettings && currentUser ? (
        <ProfileSettingsPage
          open={showProfileSettings}
          currentUser={currentUser}
          settings={settings}
          onClose={onCloseProfileSettings}
          onSaveName={onSaveName}
          onUploadAvatar={onUploadAvatar}
          onLoadSettings={onLoadSettings}
          onSaveSettings={onSaveSettings}
          onListSessions={onListSessions}
          onTerminateSession={onTerminateSession}
          onLogoutCurrentSession={onLogoutCurrentSession}
          onNotify={onNotify}
        />
      ) : null}

      <PwaInstallPrompt />
      <ToastHost toasts={toasts} language={language} theme={theme} />
    </I18nProvider>
  );
}
