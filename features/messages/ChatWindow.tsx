import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';
import {
  ArrowLeft,
  Info,
  Mic,
  Paperclip,
  Search,
  Send,
  Smile,
  X,
  Trash2
} from 'lucide-react';
import { Chat, Contact, GroupMember, Message, User, MediaLimits } from '../../types';
import { useI18n } from '../../hooks/useI18n';
import { getAvatarColor } from '../../services/chatAdapter';
import { apiClient } from '../../services/apiClient';
import GroupInfoDrawer from '../../components/GroupInfoDrawer';
import MessageBubble from '../../components/MessageBubble';
import MessageContextMenu from '../../components/MessageContextMenu';
import UserProfileDrawer from '../../components/UserProfileDrawer';
import DateDivider from './components/DateDivider';
import MessageSearchPanel from './components/MessageSearchPanel';
import NewMessageIndicator from './components/NewMessageIndicator';
import PinnedMessagesBar from './components/PinnedMessagesBar';
import { useMessageContextMenu } from './hooks/useMessageContextMenu';
import { createClientMessageId } from './lib/clientMessageId';
import { formatVoiceDuration, isSameDay, typingStatus } from './lib/messageDates';
import { gbToBytes, getMediaKindFromFile, type SendMediaKind } from './lib/mediaKind';

type SendMediaOptions = {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  kind?: SendMediaKind;
  durationMs?: number;
};

type ChatWindowProps = {
  chat: Chat;
  currentUser: User;
  users: User[];
  contacts: Contact[];
  isMobile: boolean;
  onBack: () => void;
  onSendMessage: (content: string, replyToId?: string, clientMessageId?: string) => Promise<void>;
  onSendMedia: (
    file: File,
    caption?: string,
    replyToId?: string,
    options?: SendMediaOptions,
    clientMessageId?: string
  ) => Promise<void>;
  onEditMessage: (messageId: string, content: string, replyToId?: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onPinMessage: (chatId: string, messageId: string) => Promise<void>;
  onUnpinMessage: (chatId: string, messageId: string) => Promise<void>;
  pinnedMessages: Message[];
  onTypingStart: (chatId: string) => void;
  onTypingStop: (chatId: string) => void;
  onSearchMessages: (chatId: string, isGroup: boolean, query: string) => Promise<Message[]>;
  onLoadGroupMembers: (chatId: string) => Promise<GroupMember[]>;
  onAddGroupMembers: (chatId: string, userIds: string[]) => Promise<void>;
  onLookupUserByUserid: (userid: string) => Promise<User>;
  onRemoveGroupMember: (chatId: string, userId: string) => Promise<void>;
  onUpdateGroupMemberRole: (chatId: string, userId: string, role: 'ADMIN' | 'MEMBER') => Promise<void>;
  onBanGroupMember: (chatId: string, userId: string) => Promise<void>;
  onUnbanGroupMember: (chatId: string, userId: string) => Promise<void>;
  onTransferOwnership: (chatId: string, userId: string) => Promise<void>;
  onUpdateGroupDetails: (chatId: string, payload: { name?: string }) => Promise<void>;
  onUploadGroupAvatar: (chatId: string, file: File) => Promise<void>;
  onDeleteGroup: (chatId: string) => Promise<void>;
  onLeaveGroup: (chatId: string) => Promise<void>;
  onLoadUserProfile: (userId: string) => Promise<User>;
  onUpsertContact: (userId: string, customName?: string | null, isFavorite?: boolean) => Promise<void>;
  onRemoveContact: (userId: string) => Promise<void>;
  onBlockContact: (userId: string) => Promise<void>;
  onUnblockContact: (userId: string) => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void;
  onLoadOlderMessages?: () => Promise<void>;
  isLoadingOlder?: boolean;
  mediaLimits?: MediaLimits;
};

const shouldLogVoiceDebug = Boolean((import.meta as any).env?.DEV);
const MICROPHONE_TOAST_DEBOUNCE_MS = 2500;

type MicrophonePermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';
type PermissionsQueryFacade = {
  query?: (descriptor: { name: string }) => Promise<{ state?: string }>;
};

export default function ChatWindow({
  chat,
  currentUser,
  users,
  contacts,
  isMobile,
  onBack,
  onSendMessage,
  onSendMedia,
  onEditMessage,
  onDeleteMessage,
  onToggleReaction,
  onPinMessage,
  onUnpinMessage,
  pinnedMessages,
  onTypingStart,
  onTypingStop,
  onSearchMessages,
  onLoadGroupMembers,
  onAddGroupMembers,
  onLookupUserByUserid,
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
  onUpsertContact,
  onRemoveContact,
  onBlockContact,
  onUnblockContact,
  onNotify,
  onLoadOlderMessages,
  isLoadingOlder,
  mediaLimits
}: ChatWindowProps) {
  const { t, localizeApiError, formatDateTime, formatDate, formatLastSeen } = useI18n();
  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [isLoadingUserProfile, setIsLoadingUserProfile] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceDurationSec, setVoiceDurationSec] = useState(0);
  const [pinnedBarIndex, setPinnedBarIndex] = useState(0);
  const {
    contextMenu,
    setContextMenu,
    reactionPicker,
    setReactionPicker,
    closeTransientMenus
  } = useMessageContextMenu();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const isNearBottomRef = useRef(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const recordTickerRef = useRef<number | null>(null);
  const shouldSendVoiceRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordSessionIdRef = useRef(0);
  const isFinalizingRecordingRef = useRef(false);
  const micToastRef = useRef<{ message: string; at: number }>({ message: '', at: 0 });
  const submitInFlightRef = useRef(false);
  const jumpHighlightTimeoutRef = useRef<number | null>(null);
  const pendingScrollRestoreHeightRef = useRef<number | null>(null);

  const usersById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const sortedMessages = useMemo(
    () => [...chat.messages]
      .filter(m => m.type !== 'system')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [chat.messages]
  );

  const pinnedKey = useMemo(() => pinnedMessages.map(m => m.id).join(','), [pinnedMessages]);
  useEffect(() => {
    setPinnedBarIndex(0);
  }, [pinnedKey, chat.id]);

  const reactionPickerStyle = useMemo(() => {
    if (!reactionPicker) return null;

    const pickerWidth = 300;
    const pickerHeight = 340;

    const left = Math.max(8, Math.min(reactionPicker.x - pickerWidth / 2, window.innerWidth - pickerWidth - 8));
    const top = Math.max(8, Math.min(reactionPicker.y - pickerHeight - 8, window.innerHeight - pickerHeight - 8));

    return { left, top };
  }, [reactionPicker]);

  const isSaved = chat.type === 'saved';
  const partner = chat.participants[0];
  const partnerContact = useMemo(
    () => (partner ? contacts.find(contact => contact.userId === partner.id) : undefined),
    [contacts, partner]
  );
  const statusText = isSaved
    ? t('Private notes')
    : chat.type === 'group'
      ? t('{count} members', { count: chat.participants.length })
      : partner?.isOnline
        ? t('online')
        : formatLastSeen(partner?.lastSeenAt);

  const openPrivateProfile = async () => {
    if (chat.type !== 'private' || !partner?.id) {
      return;
    }

    setShowUserProfile(true);
    setIsLoadingUserProfile(true);
    try {
      const loaded = await onLoadUserProfile(partner.id);
      setProfileUser(loaded);
    } catch (error) {
      setProfileUser(partner ?? null);
      onNotify(localizeApiError(error, 'Failed to load profile'), 'error');
    } finally {
      setIsLoadingUserProfile(false);
    }
  };

  const clearRecordTicker = useCallback(() => {
    if (recordTickerRef.current) {
      window.clearInterval(recordTickerRef.current);
      recordTickerRef.current = null;
    }
  }, []);

  const stopVoiceStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const notifyMicrophoneError = useCallback(
    (message: string) => {
      const now = Date.now();
      const last = micToastRef.current;
      if (last.message === message && now - last.at < MICROPHONE_TOAST_DEBOUNCE_MS) {
        return;
      }
      micToastRef.current = { message, at: now };
      onNotify(message, 'error');
    },
    [onNotify]
  );

  const getMicrophonePermissionState = useCallback(async (): Promise<MicrophonePermissionState> => {
    const permissions = (navigator as Navigator & { permissions?: PermissionsQueryFacade }).permissions;
    if (!permissions?.query) {
      return 'unknown';
    }

    try {
      const result = await permissions.query({ name: 'microphone' });
      const state = result?.state;
      if (state === 'granted' || state === 'denied' || state === 'prompt') {
        return state;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }, []);

  const finalizeVoiceRecording = useCallback(
    async (send: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;

      if (isFinalizingRecordingRef.current) {
        return;
      }
      isFinalizingRecordingRef.current = true;
      shouldSendVoiceRef.current = send;

      if (recorder.state === 'inactive') {
        isFinalizingRecordingRef.current = false;
      } else {
        recorder.stop();
      }
      setIsRecordingVoice(false);
      clearRecordTicker();
    },
    [clearRecordTicker]
  );

  const startVoiceRecording = useCallback(async () => {
    const RecorderCtor = (window as any).MediaRecorder as typeof MediaRecorder | undefined;
    if (!RecorderCtor || !navigator.mediaDevices?.getUserMedia) {
      onNotify(t('Voice recording is not supported in this browser.'), 'error');
      return;
    }

    if (isRecordingVoice || isSubmitting || selectedFile || uploadProgress !== null) {
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      return;
    }

    try {
      const permissionState = await getMicrophonePermissionState();
      if (permissionState === 'denied') {
        notifyMicrophoneError(t('Microphone is blocked. Allow it in browser site settings, then try again.'));
        return;
      }

      setShowEmojiPicker(false);
      closeTransientMenus();
      const replyToIdAtStart = replyTo?.id;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = preferredTypes.find(type => RecorderCtor.isTypeSupported?.(type)) ?? undefined;
      const recorder = new RecorderCtor(stream, mimeType ? { mimeType } : undefined);
      const currentSessionId = recordSessionIdRef.current + 1;
      recordSessionIdRef.current = currentSessionId;

      voiceChunksRef.current = [];
      shouldSendVoiceRef.current = true;
      isFinalizingRecordingRef.current = false;
      recordingStartedAtRef.current = Date.now();
      setVoiceDurationSec(0);
      setIsRecordingVoice(true);

      recorder.ondataavailable = event => {
        if (currentSessionId !== recordSessionIdRef.current) {
          return;
        }
        if (event.data && event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        if (currentSessionId !== recordSessionIdRef.current) {
          return;
        }
        isFinalizingRecordingRef.current = false;
        mediaRecorderRef.current = null;
        stopVoiceStream();
        clearRecordTicker();
        setIsRecordingVoice(false);
        onNotify(t('Voice recording failed.'), 'error');
      };

      recorder.onstop = () => {
        if (currentSessionId !== recordSessionIdRef.current) {
          return;
        }
        const send = shouldSendVoiceRef.current;
        const chunks = [...voiceChunksRef.current];
        voiceChunksRef.current = [];
        mediaRecorderRef.current = null;
        isFinalizingRecordingRef.current = false;
        const startedAt = recordingStartedAtRef.current;
        recordingStartedAtRef.current = null;
        stopVoiceStream();

        const elapsedMs = startedAt ? Date.now() - startedAt : 0;

        if (shouldLogVoiceDebug) {
          console.debug('[voice] stop', {
            send,
            elapsedMs,
            chunks: chunks.length,
            mimeType: recorder.mimeType || mimeType || 'audio/webm'
          });
        }

        if (!send || chunks.length === 0) {
          return;
        }

        if (elapsedMs < 300) {
          onNotify(t('Recording too short.'), 'info');
          return;
        }

        const blobType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: blobType });
        const ext = blobType.includes('ogg') ? 'ogg' : blobType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blobType });

        const gbLimit = mediaLimits?.voice ?? 0.03;
        const maxBytes = gbToBytes(gbLimit);
        if (file.size > maxBytes) {
          const maxMb = Math.round(gbLimit * 1000);
          onNotify(t('Voice message exceeds the {maxMb}MB limit.', { maxMb }), 'error');
          return;
        }

        if (shouldLogVoiceDebug) {
          console.debug('[voice] upload', {
            durationMs: elapsedMs,
            blobType,
            sizeBytes: file.size
          });
        }

        const clientMessageId = createClientMessageId();
        void onSendMedia(
          file,
          '',
          replyToIdAtStart,
          {
            kind: 'voice',
            durationMs: elapsedMs
          },
          clientMessageId
        )
          .then(() => onNotify(t('Voice message sent'), 'success'))
          .catch(error => {
            onNotify(localizeApiError(error, 'Voice send failed'), 'error');
          });
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      clearRecordTicker();
      recordTickerRef.current = window.setInterval(() => {
        setVoiceDurationSec(prev => prev + 1);
      }, 1000);
    } catch (error) {
      isFinalizingRecordingRef.current = false;
      mediaRecorderRef.current = null;
      stopVoiceStream();
      setIsRecordingVoice(false);
      clearRecordTicker();

      const errorName = typeof error === 'object' && error && 'name' in error ? String((error as { name?: string }).name) : '';
      if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        notifyMicrophoneError(
          window.isSecureContext
            ? t('Microphone access was denied. Allow microphone access in the browser prompt or site settings.')
            : t('Microphone recording requires HTTPS. Open this chat over HTTPS and try again.')
        );
        return;
      }

      if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        notifyMicrophoneError(t('No microphone was found on this device.'));
        return;
      }

      if (errorName === 'NotReadableError' || errorName === 'AbortError' || errorName === 'TrackStartError') {
        notifyMicrophoneError(t('Microphone is busy or unavailable. Close other apps using it and try again.'));
        return;
      }

      notifyMicrophoneError(t('Unable to start microphone recording. Please try again.'));
    }
  }, [
    clearRecordTicker,
    getMicrophonePermissionState,
    isRecordingVoice,
    notifyMicrophoneError,
    onNotify,
    onSendMedia,
    replyTo?.id,
    selectedFile,
    isSubmitting,
    stopVoiceStream,
    uploadProgress
  ]);

  useEffect(() => {
    setInputText('');
    setReplyTo(null);
    setEditingMessage(null);
    setSelectedFile(null);
    setShowEmojiPicker(false);
    setShowGroupInfo(false);
    setShowUserProfile(false);
    setProfileUser(null);
    setIsLoadingUserProfile(false);
    setShowSearchPanel(false);
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setPinnedBarIndex(0);
    pendingScrollRestoreHeightRef.current = null;
    submitInFlightRef.current = false;
    setIsSubmitting(false);
    closeTransientMenus();

    const rafId = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      isNearBottomRef.current = true;
      setShowScrollBottom(false);
      setShowNewMessageIndicator(false);
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [chat.id]);

  useLayoutEffect(() => {
    const previousHeight = pendingScrollRestoreHeightRef.current;
    if (previousHeight === null) return;

    const node = messagesContainerRef.current;
    if (!node) return;

    requestAnimationFrame(() => {
      const currentNode = messagesContainerRef.current;
      if (!currentNode) return;
      currentNode.scrollTop = Math.max(0, currentNode.scrollHeight - previousHeight);
      pendingScrollRestoreHeightRef.current = null;
    });
  }, [sortedMessages.length]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setShowNewMessageIndicator(false);
      return;
    }
    if (sortedMessages.length > 0) {
      setShowNewMessageIndicator(true);
    }
  }, [sortedMessages.length]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('[data-emoji-root]') ||
        target.closest('[data-message-context-menu]') ||
        target.closest('[data-message-reaction-picker]')
      ) {
        return;
      }

      setShowEmojiPicker(false);
      closeTransientMenus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowEmojiPicker(false);
        closeTransientMenus();
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isRecordingVoice) {
      return;
    }

    const onPointerUp = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-voice-cancel]')) {
        void finalizeVoiceRecording(false);
        return;
      }
      void finalizeVoiceRecording(true);
    };
    const onPointerCancel = () => {
      void finalizeVoiceRecording(false);
    };

    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerCancel, { once: true });

    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [finalizeVoiceRecording, isRecordingVoice]);

  useEffect(() => {
    return () => {
      clearRecordTicker();
      recordSessionIdRef.current += 1;
      isFinalizingRecordingRef.current = false;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        shouldSendVoiceRef.current = false;
        mediaRecorderRef.current.stop();
      }
      stopVoiceStream();
      if (jumpHighlightTimeoutRef.current) window.clearTimeout(jumpHighlightTimeoutRef.current);
    };
  }, [clearRecordTicker, stopVoiceStream]);

  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);

  const firstMessageId = sortedMessages[0]?.id;
  const prevFirstMessageIdRef = useRef<string | undefined>(firstMessageId);

  React.useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (firstMessageId !== prevFirstMessageIdRef.current) {
      if (prevFirstMessageIdRef.current && sortedMessages.some(m => m.id === prevFirstMessageIdRef.current)) {
        const newScrollHeight = container.scrollHeight;
        const heightDifference = newScrollHeight - prevScrollHeightRef.current;
        container.scrollTop = prevScrollTopRef.current + heightDifference;
      }
      prevFirstMessageIdRef.current = firstMessageId;
    }

    prevScrollHeightRef.current = container.scrollHeight;
    prevScrollTopRef.current = container.scrollTop;
  });

  const handleScroll = () => {
    const node = messagesContainerRef.current;
    if (!node) return;

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const isNearBottom = distanceFromBottom < 80;
    isNearBottomRef.current = isNearBottom;
    setShowScrollBottom(!isNearBottom);
    if (isNearBottom) {
      setShowNewMessageIndicator(false);
    }

    if (contextMenu || reactionPicker) {
      closeTransientMenus();
    }

    if (node.scrollTop < 80 && chat.hasMore && !isLoadingOlder && onLoadOlderMessages) {
      prevScrollHeightRef.current = node.scrollHeight;
      prevScrollTopRef.current = node.scrollTop;
      void onLoadOlderMessages();
    }
  };

  const triggerTyping = () => {
    onTypingStart(chat.id);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      onTypingStop(chat.id);
      typingTimeoutRef.current = null;
    }, 1400);
  };

  const resetComposer = () => {
    setInputText('');
    setReplyTo(null);
    setEditingMessage(null);
    setSelectedFile(null);
    setUploadProgress(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.focus();
    }
  };

  const submit = async () => {
    const trimmed = inputText.trim();
    if (!trimmed && !selectedFile) {
      return;
    }
    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    const clientMessageId = createClientMessageId();

    try {
      if (editingMessage) {
        await onEditMessage(editingMessage.id, trimmed, replyTo?.id || editingMessage.replyToId);
        resetComposer();
        onTypingStop(chat.id);
        submitInFlightRef.current = false;
        setIsSubmitting(false);
      } else if (selectedFile) {
        const fileToSend = selectedFile;
        const replyId = replyTo?.id;

        try {
          await onSendMedia(
            fileToSend,
            trimmed,
            replyId,
            {
              onProgress: percent => setUploadProgress(percent),
              kind: getMediaKindFromFile(fileToSend)
            },
            clientMessageId
          );
          resetComposer();
        } catch (error) {
          onNotify(localizeApiError(error, t('Unable to send media file')), 'error');
        } finally {
          onTypingStop(chat.id);
          submitInFlightRef.current = false;
          setIsSubmitting(false);
          setUploadProgress(null);
        }
      } else {
        const replyId = replyTo?.id;

        resetComposer();
        onTypingStop(chat.id);

        onSendMessage(trimmed, replyId, clientMessageId)
          .then(() => {
            submitInFlightRef.current = false;
            setIsSubmitting(false);
          })
          .catch(error => {
            submitInFlightRef.current = false;
            setIsSubmitting(false);
            onNotify(localizeApiError(error, t('Unable to send message')), 'error');
          });
      }
    } catch (error) {
      onNotify(localizeApiError(error, t('Unable to send message')), 'error');
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const deleteMessage = async (message: Message) => {
    const confirmDelete = window.confirm(
      t('This permanently deletes the message for everyone and removes attached media when possible.')
    );
    if (!confirmDelete) return;
    try {
      await onDeleteMessage(message.id);
      onNotify(t('Message deleted'), 'success');
    } catch (error) {
      onNotify(localizeApiError(error, 'Delete failed'), 'error');
    }
  };

  const handlePinMessage = async (message: Message) => {
    try {
      await onPinMessage(chat.id, message.id);
      onNotify(t('Message pinned'), 'success');
    } catch (error) {
      onNotify(localizeApiError(error, 'Failed to pin message'), 'error');
    }
  };

  const handleUnpinMessage = async (message: Message) => {
    try {
      await onUnpinMessage(chat.id, message.id);
      onNotify(t('Message unpinned'), 'success');
    } catch (error) {
      onNotify(localizeApiError(error, 'Failed to unpin message'), 'error');
    }
  };

  const canPinInChat =
    chat.type === 'saved' ||
    (chat.type === 'group' && (chat.capabilities?.canPinMessages ?? true)) ||
    (chat.type === 'private' && currentUser != null);

  const editMessage = (message: Message) => {
    setEditingMessage(message);
    setReplyTo(
      message.replyTo
        ? ({
          id: message.replyTo.id,
          senderId: message.replyTo.senderId,
          text: message.replyTo.content,
          timestamp: message.timestamp,
          isRead: false,
          isDelivered: false,
          type: message.replyTo.type,
          seenBy: [],
          mediaName: message.replyTo.mediaName
        } as Message)
        : null
    );
    setInputText(message.text);
    textareaRef.current?.focus();
  };

  const jumpToMessage = (messageId: string) => {
    const target = messagesContainerRef.current?.querySelector(`[data-message-id='${messageId}']`) as HTMLElement | null;
    if (!target) {
      onNotify(t('Message is outside the current loaded window.'), 'info');
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('ring-2', 'ring-tg-accent');
    if (jumpHighlightTimeoutRef.current) window.clearTimeout(jumpHighlightTimeoutRef.current);
    jumpHighlightTimeoutRef.current = window.setTimeout(() => target.classList.remove('ring-2', 'ring-tg-accent'), 900);
  };

  const runMessageSearch = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const matches = await onSearchMessages(chat.id, chat.type === 'group', trimmed);
      setSearchResults(matches);
    } catch (error) {
      onNotify(localizeApiError(error, 'Message search failed'), 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const loadMembers = async () => {
    if (chat.type !== 'group') return;
    setIsLoadingMembers(true);
    try {
      const members = await onLoadGroupMembers(chat.id);
      setGroupMembers(members);
    } catch (error) {
      onNotify(localizeApiError(error, 'Failed to load members'), 'error');
    } finally {
      setIsLoadingMembers(false);
    }
  };

  useEffect(() => {
    if (!showGroupInfo || chat.type !== 'group') return;
    void loadMembers();
  }, [showGroupInfo, chat.id, chat.type]);

  const openContextMenuForMessage = (message: Message, anchor: { x: number; y: number; isOwn: boolean }) => {
    setContextMenu({ message, x: anchor.x, y: anchor.y, isOwn: anchor.isOwn });
    setReactionPicker(null);
  };

  const onCopyMessage = async () => {
    if (!contextMenu) return;
    try {
      await navigator.clipboard.writeText(contextMenu.message.text || contextMenu.message.mediaUrl || '');
      onNotify(t('Message copied'), 'success');
    } catch {
      onNotify(t('Copy failed'), 'error');
    }
    setContextMenu(null);
  };

  const onReactFromContext = () => {
    if (!contextMenu) return;
    setReactionPicker({ message: contextMenu.message, x: contextMenu.x, y: contextMenu.y });
    setContextMenu(null);
  };

  const onDownloadMedia = async () => {
    if (!contextMenu?.message?.mediaUrl) return;
    const { mediaUrl, mediaName } = contextMenu.message;
    setContextMenu(null);
    let url: string | undefined;
    try {
      const blob = await apiClient.fetchMediaBlob(mediaUrl);
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mediaName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      onNotify(t('Unable to load media'), 'error');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };

  return (
    <section className="relative flex h-[100dvh] min-h-0 min-w-0 flex-1 flex-col bg-tg-bg-chat chat-wallpaper">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-tg-border bg-tg-bg-header px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          {isMobile ? (
            <button
              type="button"
              onClick={onBack}
              className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover"
              aria-label={t('Back')}
            >
              <ArrowLeft size={20} />
            </button>
          ) : null}

          <div
            className="relative h-10 w-10 rounded-full text-center text-sm font-semibold leading-10 text-white"
            style={{ background: chat.avatarUrl ? undefined : getAvatarColor(chat.id) }}
          >
            {chat.avatarUrl ? (
              <img src={chat.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              chat.name.slice(0, 2).toUpperCase()
            )}
            {chat.type === 'private' && partner?.isOnline ? (
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-tg-bg-header bg-emerald-500" />
            ) : null}
          </div>

          <div className="min-w-0">
            <h2 dir="auto" className="bidi-text truncate text-[0.98rem] font-semibold text-tg-text-primary">
              {chat.name}
            </h2>
            <p dir="auto" className="bidi-text truncate text-xs text-tg-text-secondary">
              {typingStatus(chat, currentUser.id, t) || statusText}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover"
            aria-label={t('Search')}
            onClick={() => {
              setShowSearchPanel(prev => !prev);
              if (showSearchPanel) {
                setSearchQuery('');
                setSearchResults([]);
              }
            }}
          >
            <Search size={18} />
          </button>

          {chat.type === 'group' || chat.type === 'private' ? (
            <button
              type="button"
              className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover"
              aria-label={chat.type === 'group' ? t('Group info') : t('User profile')}
              onClick={() => {
                if (chat.type === 'group') {
                  setShowGroupInfo(true);
                  return;
                }
                void openPrivateProfile();
              }}
            >
              <Info size={18} />
            </button>
          ) : null}

          {chat.type === 'saved' ? (
            <button
              type="button"
              className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-rose-500"
              aria-label={t('Clear saved messages')}
              onClick={async () => {
                const confirmed = window.confirm(
                  t('Are you sure you want to clear all your saved messages? This cannot be undone.')
                );
                if (!confirmed) return;
                try {
                  await apiClient.clearChatMessages(chat.id);
                  onNotify(t('Saved messages cleared.'), 'success');
                } catch (error) {
                  onNotify(localizeApiError(error, t('Failed to clear saved messages')), 'error');
                }
              }}
            >
              <Trash2 size={18} />
            </button>
          ) : null}
        </div>
      </header>

      <PinnedMessagesBar
        pinnedMessages={pinnedMessages}
        pinnedBarIndex={pinnedBarIndex}
        setPinnedBarIndex={setPinnedBarIndex}
        jumpToMessage={jumpToMessage}
        t={t}
      />

      {showSearchPanel ? (
        <MessageSearchPanel
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          runMessageSearch={runMessageSearch}
          isSearching={isSearching}
          searchResults={searchResults}
          jumpToMessage={jumpToMessage}
          setShowSearchPanel={setShowSearchPanel}
          t={t}
          formatDateTime={formatDateTime}
        />
      ) : null}

      <div ref={messagesContainerRef} onScroll={handleScroll} className="message-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 sm:px-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-1 pb-4">
          {isLoadingOlder ? (
            <div className="flex justify-center py-2">
              <span className="text-xs text-tg-text-secondary">{t('Loading older messages...')}</span>
            </div>
          ) : null}
          {sortedMessages.map((message, index) => {
            const prev = sortedMessages[index - 1];
            const next = sortedMessages[index + 1];
            const showDate = !prev || !isSameDay(prev.timestamp, message.timestamp);
            const showAvatar = !next || next.senderId !== message.senderId;
            const sender = usersById.get(message.senderId) || chat.participants.find(user => user.id === message.senderId);
            const replySender = message.replyTo ? usersById.get(message.replyTo.senderId) : null;

            return (
              <React.Fragment key={message.id}>
                {showDate ? <DateDivider timestamp={message.timestamp} t={t} formatDate={formatDate} /> : null}

                <MessageBubble
                  message={message}
                  isOwn={message.senderId === currentUser.id}
                  isGroup={chat.type === 'group'}
                  showAvatar={chat.type === 'group' && message.senderId !== currentUser.id && showAvatar}
                  senderName={sender?.name}
                  senderAvatar={sender?.avatar}
                  avatarColor={sender?.avatarColor || getAvatarColor(message.senderId)}
                  replySenderName={replySender?.name}
                  onToggleReaction={(messageId, emoji) =>
                    void onToggleReaction(messageId, emoji).catch(error => {
                      onNotify(localizeApiError(error, 'Reaction failed'), 'error');
                    })
                  }
                  onJumpToRepliedMessage={jumpToMessage}
                  onOpenContextMenu={openContextMenuForMessage}
                />
              </React.Fragment>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <NewMessageIndicator
        showScrollBottom={showScrollBottom}
        showNewMessageIndicator={showNewMessageIndicator}
        messagesEndRef={messagesEndRef}
        setShowNewMessageIndicator={setShowNewMessageIndicator}
        t={t}
      />

      {(replyTo || editingMessage || selectedFile) ? (
        <div className="border-t border-tg-border bg-tg-bg-input-area px-2 py-2 text-xs text-tg-text-secondary sm:px-4">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-2 rounded-xl border border-tg-border bg-tg-bg-input-field px-3 py-2">
            <div className="h-8 w-1 rounded-full bg-tg-accent/80" />
            <div className="min-w-0 flex-1">
              {editingMessage ? (
                <p dir="auto" className="bidi-text truncate text-tg-text-primary">
                  {t('Editing message')}
                </p>
              ) : null}
              {replyTo ? (
                <p dir="auto" className="bidi-text truncate">
                  {t('Replying to')}{' '}
                  <span dir="auto" className="bidi-text font-semibold text-tg-text-primary">
                    {usersById.get(replyTo.senderId)?.name || t('message')}
                  </span>
                  : {replyTo.text || replyTo.mediaName || replyTo.type}
                </p>
              ) : null}
              {selectedFile ? (
                <p dir="auto" className="bidi-text truncate">
                  {t('Selected file:')} {selectedFile.name}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
                setEditingMessage(null);
                setSelectedFile(null);
                setUploadProgress(null);
              }}
              disabled={isSubmitting}
              className="focus-ring rounded-full p-1.5 hover:bg-tg-hover disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={t('Clear reply or edit')}
            >
              <X size={14} />
            </button>
          </div>
          {uploadProgress !== null ? (
            <div className="mx-auto mt-2 h-1.5 w-full max-w-4xl overflow-hidden rounded-full bg-black/20">
              <div className="h-full bg-tg-accent" style={{ width: `${uploadProgress}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="border-t border-tg-border bg-tg-bg-input px-2 py-2 sm:px-4">
        {isRecordingVoice ? (
          <div className="mx-auto mb-2 flex w-full max-w-4xl items-center justify-between rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
              {t('Recording...')} {formatVoiceDuration(voiceDurationSec)}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-red-200/90">{t('Release to send')}</span>
              <button
                type="button"
                data-voice-cancel
                className="focus-ring rounded-lg border border-red-300/40 px-2 py-1 text-[11px] text-red-100 hover:bg-red-500/20"
                onClick={() => void finalizeVoiceRecording(false)}
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mx-auto flex w-full max-w-4xl items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0] || null;
              if (file) {
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (ext === 'svg' || file.type === 'image/svg+xml') {
                  onNotify(t('SVG images are not supported for security reasons.'), 'error');
                  event.currentTarget.value = '';
                  return;
                }
                let limitKey: keyof MediaLimits = 'video';
                if (file.type.startsWith('image/')) {
                  limitKey = 'photo';
                } else if (file.type.startsWith('audio/')) {
                  limitKey = 'audio';
                }
                const gbLimit = mediaLimits?.[limitKey] ?? 0.03;
                const maxBytes = gbToBytes(gbLimit);
                if (file.size > maxBytes) {
                  const maxMb = Math.round(gbLimit * 1000);
                  onNotify(t('File size exceeds the {maxMb}MB limit.', { maxMb }), 'error');
                  event.currentTarget.value = '';
                  return;
                }
              }
              setSelectedFile(file);
              event.currentTarget.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRecordingVoice || isSubmitting}
            className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
            aria-label={t('Attach file')}
          >
            <Paperclip size={20} />
          </button>

          <div className="relative flex-1" data-emoji-root>
            <textarea
              ref={textareaRef}
              dir="auto"
              value={inputText}
              placeholder={isRecordingVoice ? t('Recording voice...') : editingMessage ? t('Edit message') : t('Type a message')}
              disabled={isRecordingVoice || isSubmitting}
              onChange={event => {
                setInputText(event.target.value);
                triggerTyping();
                const node = event.target;
                node.style.height = 'auto';
                node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  setShowEmojiPicker(false);
                  setReplyTo(null);
                  setEditingMessage(null);
                  closeTransientMenus();
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              className="focus-ring bidi-text max-h-40 min-h-[2.75rem] w-full resize-none rounded-2xl border border-tg-border bg-[var(--tg-bg-input-field)] px-4 py-2 text-sm text-[color:var(--tg-text-primary)] placeholder:text-[color:var(--tg-text-tertiary)]"
            />

            {showEmojiPicker ? (
              <div className="absolute bottom-[calc(100%+0.5rem)] right-0 z-30 overflow-hidden rounded-xl border border-tg-border shadow-2xl">
                <EmojiPicker
                  onEmojiClick={emoji => {
                    setInputText(prev => `${prev}${emoji.emoji}`);
                    textareaRef.current?.focus();
                  }}
                  autoFocusSearch={false}
                  lazyLoadEmojis
                  emojiStyle={EmojiStyle.NATIVE}
                  width={320}
                  height={380}
                  theme={document.documentElement.getAttribute('data-theme') === 'light' ? Theme.LIGHT : Theme.DARK}
                />
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setShowEmojiPicker(prev => !prev)}
            disabled={isRecordingVoice || isSubmitting}
            className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
            aria-label={t('Open emoji picker')}
          >
            <Smile size={20} />
          </button>

          {inputText.trim() || selectedFile ? (
            <button
              type="button"
              disabled={isRecordingVoice || isSubmitting}
              onClick={() => void submit()}
              className="focus-ring rounded-full bg-tg-accent p-2 text-white transition hover:bg-tg-accent-hover disabled:cursor-not-allowed disabled:opacity-55"
              aria-label={t('Send message')}
            >
              <Send size={20} />
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onPointerDown={event => {
                event.preventDefault();
                void startVoiceRecording();
              }}
              onContextMenu={event => event.preventDefault()}
              className={`focus-ring rounded-full p-2 text-white transition disabled:cursor-not-allowed disabled:opacity-55 ${isRecordingVoice ? 'bg-red-500 hover:bg-red-600' : 'bg-tg-accent hover:bg-tg-accent-hover'
                }`}
              aria-label={t('Hold to record voice')}
            >
              <Mic size={20} />
            </button>
          )}
        </div>
      </footer>

      {contextMenu ? (() => {
        const ctxMsg = chat.messages.find(m => m.id === contextMenu.message.id) ?? contextMenu.message;
        return (
        <MessageContextMenu
          open={Boolean(contextMenu)}
          x={contextMenu.x}
          y={contextMenu.y}
          isOwn={contextMenu.isOwn}
          onReply={() => {
            setReplyTo(contextMenu.message);
            setContextMenu(null);
            textareaRef.current?.focus();
          }}
          onCopy={() => {
            void onCopyMessage();
          }}
          onReact={onReactFromContext}
          onDownload={ctxMsg.mediaUrl ? onDownloadMedia : undefined}
          onPin={
            canPinInChat && !ctxMsg.isPinned && ctxMsg.type !== 'system'
              ? () => {
                void handlePinMessage(ctxMsg);
                setContextMenu(null);
              }
              : undefined
          }
          onUnpin={
            canPinInChat && ctxMsg.isPinned
              ? () => {
                void handleUnpinMessage(ctxMsg);
                setContextMenu(null);
              }
              : undefined
          }
          onEdit={
            ctxMsg.senderId === currentUser.id
              ? () => {
                editMessage(ctxMsg);
                setContextMenu(null);
              }
              : undefined
          }
          onDelete={
            (ctxMsg.senderId === currentUser.id ||
              (chat.type === 'group' && (chat.myRole === 'OWNER' || (chat.myRole === 'ADMIN' && chat.capabilities?.canDeleteMessages))))
              ? () => {
                void deleteMessage(ctxMsg);
                setContextMenu(null);
              }
              : undefined
          }
        />
        );
      })() : null}

      {reactionPicker && reactionPickerStyle ? (
        <div
          data-message-reaction-picker
          className="fixed z-[121] overflow-hidden rounded-xl border border-tg-border shadow-2xl"
          style={reactionPickerStyle}
        >
          <EmojiPicker
            onEmojiClick={emoji => {
              void onToggleReaction(reactionPicker.message.id, emoji.emoji).catch(error => {
                onNotify(localizeApiError(error, 'Reaction failed'), 'error');
              });
              setReactionPicker(null);
            }}
            autoFocusSearch={false}
            lazyLoadEmojis
            emojiStyle={EmojiStyle.NATIVE}
            width={300}
            height={340}
            theme={document.documentElement.getAttribute('data-theme') === 'light' ? Theme.LIGHT : Theme.DARK}
          />
        </div>
      ) : null}

      {chat.type === 'group' ? (
        <GroupInfoDrawer
          open={showGroupInfo}
          chat={chat}
          currentUser={currentUser}
          members={groupMembers}
          isLoading={isLoadingMembers}
          onClose={() => setShowGroupInfo(false)}
          onRefresh={loadMembers}
          onAddMembers={onAddGroupMembers}
          onLookupUserByUserid={onLookupUserByUserid}
          onRemoveMember={onRemoveGroupMember}
          onUpdateRole={onUpdateGroupMemberRole}
          onBanMember={onBanGroupMember}
          onUnbanMember={onUnbanGroupMember}
          onTransferOwnership={onTransferOwnership}
          onUpdateGroupDetails={onUpdateGroupDetails}
          onUploadGroupAvatar={onUploadGroupAvatar}
          onDeleteGroup={onDeleteGroup}
          onLeaveGroup={onLeaveGroup}
          onNotify={onNotify}
        />
      ) : null}

      {chat.type === 'private' ? (
        <UserProfileDrawer
          open={showUserProfile}
          user={profileUser ?? partner ?? null}
          contact={(profileUser ? contacts.find(contact => contact.userId === profileUser.id) : partnerContact) ?? undefined}
          isLoading={isLoadingUserProfile}
          onClose={() => setShowUserProfile(false)}
          onAddContact={onUpsertContact}
          onRemoveContact={onRemoveContact}
          onBlockContact={onBlockContact}
          onUnblockContact={onUnblockContact}
          onNotify={onNotify}
        />
      ) : null}
    </section>
  );
}
