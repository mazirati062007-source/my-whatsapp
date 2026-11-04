import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  Download,
  Film,
  Image as ImageIcon,
  Lock,
  LogIn,
  MessageSquare,
  Mic,
  Moon,
  MoreVertical,
  Paperclip,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Sun,
  Trash2,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { auth } from './firebase';
import {
  AppSettings,
  CallDirection,
  CallLog,
  CallType,
  Chat,
  Message,
  MessageType,
  PublicUserProfile,
} from './types';
import {
  clearChatMessages,
  deleteChatAndMessages,
  deleteMessageById,
  getCalls,
  getChats,
  getMessagesByChat,
  loadChatsSnapshotFromLocalStorage,
  loadSettingsFromLocalStorage,
  resetToDemoData,
  saveCallLog,
  saveChat,
  saveMediaBlob,
  saveMessage,
  saveSettingsToLocalStorage,
  seedInitialDataIfEmpty,
  wipeAllStorageData,
} from './services/storage';
import {
  createCompactRemoteThumbnail,
  deleteCloudChatMessage,
  encodeCompactVoiceDataUrl,
  openOrCreateFriendChat,
  registerOrSyncGoogleUser,
  searchUsersInDatabase,
  sendCloudChatMessage,
  signInWithGoogleAndRegister,
  signOutFromGoogle,
  subscribeToCloudConversations,
  subscribeToCloudMessages,
  updateCloudCallSignaling,
} from './services/firebaseMessenger';
import {
  executeEmergencySecurityLogout,
  guardAgainstSuspiciousBurst,
  startActiveSessionMonitor,
} from './services/sessionSecurity';
import {
  compressImageBlob,
  formatBytes,
  formatDuration,
  generateCompactVoiceWav,
  processVideoBlob,
} from './services/compression';
import { Avatar } from './components/Avatar';
import {
  StoredImageView,
  StoredVideoView,
  VoiceMessagePlayer,
} from './components/MediaElements';
import { CallOverlay } from './components/CallOverlay';
import { VideoRecorderModal } from './components/VideoRecorderModal';
import { SettingsPanel } from './components/SettingsPanel';
import { AuthScreen } from './components/AuthScreen';
import { SafetyNumberModal } from './components/SafetyNumberModal';
import {
  OfflineConnectivityBanner,
  PWAInstallButton,
} from './components/PWAInstallPrompt';

type NavTab = 'chats' | 'calls' | 'settings';
type ChatFilter = 'all' | 'unread' | 'groups';

const QUICK_EMOJIS = [
  '👍', '❤️', '😂', '🔥', '🙌', '✨', '🎉', '🤝',
  '😊', '🚀', '📷', '🎧', '☕', '🏔️', '✅', '💡',
];

const AUTO_REPLIES = [
  'Принял, отлично! Всё сохранилось мгновенно.',
  'Супер, качество картинки отличное даже после сжатия в WebP.',
  'Давай созвонимся чуть позже через кнопку звонка сверху!',
  'Проверил — данные на месте даже после перезагрузки вкладки.',
  'Отличная идея! Сделаю бэкап в настройках вечером.',
];

function formatMessageTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatChatTimestamp(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const isToday =
    now.getFullYear() === d.getFullYear() &&
    now.getMonth() === d.getMonth() &&
    now.getDate() === d.getDate();

  if (isToday) {
    return formatMessageTime(ts);
  }
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  });
}

export default function App() {
  // Настройки и тема (LocalStorage)
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadSettingsFromLocalStorage()
  );

  // Состояние авторизации Google (Firebase Auth + Firestore профиль + защита сессии)
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [googleProfile, setGoogleProfile] = useState<PublicUserProfile | null>(
    null
  );
  const [bypassAuthGate, setBypassAuthGate] = useState<boolean>(false);
  const [securityAlertReason, setSecurityAlertReason] = useState<string | null>(
    null
  );
  const [safetyModalChat, setSafetyModalChat] = useState<Chat | null>(null);
  const [pwaBannerDismissed, setPwaBannerDismissed] = useState<boolean>(false);

  // Чаты: локальные (IndexedDB) + облачные диалоги с друзьями (Firestore)
  const [activeTab, setActiveTab] = useState<NavTab>('chats');
  const [localChats, setLocalChats] = useState<Chat[]>(() =>
    loadChatsSnapshotFromLocalStorage()
  );
  const [cloudChats, setCloudChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Живой поиск по чатам и зарегистрированным аккаунтам друзей в базе
  const [sidebarSearch, setSidebarSearch] = useState<string>('');
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [foundDbUsers, setFoundDbUsers] = useState<PublicUserProfile[]>([]);
  const [isSearchingDbUsers, setIsSearchingDbUsers] = useState<boolean>(false);
  const [openingFriendUid, setOpeningFriendUid] = useState<string | null>(null);

  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [chatMessageSearch, setChatMessageSearch] = useState<string>('');
  const [isChatSearchOpen, setIsChatSearchOpen] = useState<boolean>(false);

  // Ввод сообщения, ответ, вложения, эмодзи
  const [draftText, setDraftText] = useState<string>('');
  const [replyToMsg, setReplyToMsg] = useState<Message | null>(null);
  const [sendAsContact, setSendAsContact] = useState<boolean>(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [showAttachMenu, setShowAttachMenu] = useState<boolean>(false);
  const [showChatMenu, setShowChatMenu] = useState<boolean>(false);
  const [typingChatId, setTypingChatId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Предпросмотр перед отправкой медиафайла
  const [pendingMediaFile, setPendingMediaFile] = useState<{
    file: File;
    kind: 'image' | 'video';
    previewUrl: string;
    caption: string;
  } | null>(null);
  const [isCompressingMedia, setIsCompressingMedia] = useState<boolean>(false);

  // Запись голосового сообщения
  const [isRecordingVoice, setIsRecordingVoice] = useState<boolean>(false);
  const [voiceSeconds, setVoiceSeconds] = useState<number>(0);
  const [voiceBars, setVoiceBars] = useState<number[]>(
    Array.from({ length: 24 }, () => 0.25)
  );
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceAudioCtxRef = useRef<AudioContext | null>(null);
  const voiceAnimRef = useRef<number | null>(null);
  const voiceCancelledRef = useRef<boolean>(false);

  // Модальные окна
  const [activeCall, setActiveCall] = useState<{
    chat: Chat;
    type: CallType;
  } | null>(null);
  const [showVideoRecorder, setShowVideoRecorder] = useState<boolean>(false);
  const [showNewChatModal, setShowNewChatModal] = useState<boolean>(false);
  const [newChatName, setNewChatName] = useState<string>('');
  const [newChatPhone, setNewChatPhone] = useState<string>('');
  const [newChatIsGroup, setNewChatIsGroup] = useState<boolean>(false);
  const [lightboxData, setLightboxData] = useState<{
    url: string;
    caption?: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3600);
  };

  // Применение темы к <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  const handleUpdateSettings = (next: AppSettings) => {
    setSettings(next);
    saveSettingsToLocalStorage(next);
  };

  const handleSecurityLogoutTriggered = (reason: string) => {
    setSecurityAlertReason(reason);
    setFirebaseUser(null);
    setGoogleProfile(null);
    setCloudChats([]);
    setMessages([]);
    setSelectedChatId(null);
    setSafetyModalChat(null);
    setBypassAuthGate(false);
  };

  // Отслеживание Google Auth, криптографическая проверка токена и регистрация E2EE ключей
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const syncedProfile = await registerOrSyncGoogleUser(user);
          setGoogleProfile(syncedProfile);
          setSecurityAlertReason(null);
          setSettings((prev) => {
            const next = {
              ...prev,
              userName: syncedProfile.displayName,
              userAbout: syncedProfile.about || prev.userAbout,
            };
            saveSettingsToLocalStorage(next);
            return next;
          });
        } catch (err) {
          const rawMsg =
            err instanceof Error
              ? err.message
              : 'Ошибка проверки безопасности сессии Google Auth.';
          const lower = rawMsg.toLowerCase();
          const isTransientNetworkError =
            (typeof navigator !== 'undefined' && !navigator.onLine) ||
            lower.includes('unavailable') ||
            lower.includes('offline') ||
            lower.includes('network-request-failed');

          if (isTransientNetworkError) {
            // При временном отсутствии сети в PWA сохраняем локальный профиль без принудительного сброса сессии
            setGoogleProfile({
              uid: user.uid,
              displayName:
                user.displayName ||
                (user.email ? user.email.split('@')[0] : 'Пользователь'),
              searchName: (user.displayName || 'user').toLowerCase(),
              photoURL: user.photoURL || '',
              about: 'Автономный режим PWA · E2EE',
              onlineStatus: 'автономно',
              visibility: 'discoverable',
            });
          } else {
            await executeEmergencySecurityLogout(
              rawMsg,
              handleSecurityLogoutTriggered
            );
          }
        }
      } else {
        setGoogleProfile(null);
        setCloudChats([]);
      }
      setAuthChecking(false);
    });

    return () => unsubAuth();
  }, []);

  // Активный монитор безопасности сессии: автовыход по бездействию, проверка отпечатка и межвкладочная защита
  useEffect(() => {
    if (!firebaseUser) return;
    const stopMonitor = startActiveSessionMonitor({
      user: firebaseUser,
      idleTimeoutMinutes: settings.idleTimeoutMinutes || 15,
      onSecurityLogout: handleSecurityLogoutTriggered,
    });
    return () => stopMonitor();
  }, [firebaseUser, settings.idleTimeoutMinutes]);

  // Подписка в реальном времени на облачные чаты пользователя в Firestore
  useEffect(() => {
    if (!googleProfile?.uid) {
      setCloudChats([]);
      return;
    }
    const unsubConv = subscribeToCloudConversations(
      googleProfile.uid,
      (loadedCloudChats) => {
        setCloudChats(loadedCloudChats);
      }
    );
    return () => unsubConv();
  }, [googleProfile?.uid]);

  // Загрузка локальных данных из IndexedDB
  const reloadLocalData = async (keepSelection = true) => {
    await seedInitialDataIfEmpty();
    const [loadedChats, loadedCalls] = await Promise.all([
      getChats(),
      getCalls(),
    ]);
    setLocalChats(loadedChats);
    setCalls(loadedCalls);

    if (!keepSelection && window.innerWidth >= 768 && loadedChats.length > 0) {
      setSelectedChatId((curr) => curr || loadedChats[0].id);
    }
    setIsInitializing(false);
  };

  useEffect(() => {
    reloadLocalData(false);
  }, []);

  // Объединённый список чатов: реальные облачные диалоги с друзьями + локальные чаты
  const allChats = useMemo(() => {
    const combined = [...cloudChats, ...localChats];
    return combined.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.lastMessageTime - a.lastMessageTime;
    });
  }, [cloudChats, localChats]);

  const selectedChat = useMemo(
    () => allChats.find((c) => c.id === selectedChatId) || null,
    [allChats, selectedChatId]
  );

  // Живой поиск друзей по имени в базе Firestore при вводе текста в верхней строке поиска
  useEffect(() => {
    if (!googleProfile?.uid) {
      setFoundDbUsers([]);
      return;
    }

    const q = sidebarSearch.trim();
    if (!q && !isSearchFocused) {
      setFoundDbUsers([]);
      return;
    }

    let cancelled = false;
    setIsSearchingDbUsers(true);

    const timer = window.setTimeout(async () => {
      try {
        const users = await searchUsersInDatabase(q, googleProfile.uid);
        if (!cancelled) {
          setFoundDbUsers(users);
        }
      } catch {
        if (!cancelled) {
          setFoundDbUsers([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearchingDbUsers(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sidebarSearch, isSearchFocused, googleProfile?.uid]);

  // Загрузка / подписка на сообщения выбранного чата (Firestore для облачных чатов, IndexedDB для локальных)
  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }

    setIsChatSearchOpen(false);
    setChatMessageSearch('');
    setReplyToMsg(null);
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
    setShowChatMenu(false);

    if (selectedChat.isCloudChat && googleProfile?.uid) {
      const unsubMsgs = subscribeToCloudMessages(
        selectedChat,
        googleProfile.uid,
        (liveMsgs) => {
          setMessages(liveMsgs);
        }
      );
      return () => unsubMsgs();
    }

    let cancelled = false;
    getMessagesByChat(selectedChat.id).then(async (msgs) => {
      if (cancelled) return;
      setMessages(msgs);

      if (selectedChat.unreadCount > 0) {
        const updatedChat: Chat = { ...selectedChat, unreadCount: 0 };
        await saveChat(updatedChat);
        const refreshed = await getChats();
        if (!cancelled) setLocalChats(refreshed);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedChat?.id, selectedChat?.isCloudChat, googleProfile?.uid]);

  // Автопрокрутка к последнему сообщению
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typingChatId]);

  // Таймер записи голоса
  useEffect(() => {
    if (!isRecordingVoice) return;
    const interval = window.setInterval(() => {
      setVoiceSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRecordingVoice]);

  // Закрытие всплывающих окон по Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxData(null);
        setSafetyModalChat(null);
        setShowAttachMenu(false);
        setShowEmojiPicker(false);
        setShowChatMenu(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Входящий звонок в реальном времени от друга из Google
  const incomingCloudCallChat = useMemo(() => {
    if (!googleProfile?.uid || activeCall) return null;
    return (
      cloudChats.find(
        (c) =>
          c.activeCallStatus === 'ringing' &&
          c.activeCallInitiatorId &&
          c.activeCallInitiatorId !== googleProfile.uid
      ) || null
    );
  }, [cloudChats, googleProfile?.uid, activeCall]);

  const filteredChats = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    return allChats.filter((chat) => {
      if (chatFilter === 'unread' && chat.unreadCount === 0) return false;
      if (chatFilter === 'groups' && !chat.isGroup) return false;
      if (!q) return true;
      return (
        chat.name.toLowerCase().includes(q) ||
        chat.lastMessagePreview.toLowerCase().includes(q) ||
        chat.phone.toLowerCase().includes(q)
      );
    });
  }, [allChats, sidebarSearch, chatFilter]);

  const visibleMessages = useMemo(() => {
    const q = chatMessageSearch.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.text.toLowerCase().includes(q));
  }, [messages, chatMessageSearch]);

  const totalUnreadCount = useMemo(
    () => allChats.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    [allChats]
  );

  // Обработчики входа / выхода Google
  const handleGoogleLogin = async () => {
    const profile = await signInWithGoogleAndRegister();
    setSecurityAlertReason(null);
    setGoogleProfile(profile);
    showToast(
      `Добро пожаловать, ${profile.displayName}! Ключи сквозного шифрования E2EE активны.`
    );
  };

  const handleGoogleLogout = async () => {
    await signOutFromGoogle();
    setGoogleProfile(null);
    setCloudChats([]);
    showToast('Вы вышли из аккаунта Google · Ключи очищены из памяти');
  };

  const handleEmergencyLockdown = async () => {
    await executeEmergencySecurityLogout(
      'Выполнен экстренный выход во всех открытых вкладках с очисткой криптоключей из оперативной памяти.',
      handleSecurityLogoutTriggered
    );
  };

  /**
   * Клик по найденному другу в строке поиска -> создаёт/открывает защищённый E2EE чат и сразу открывает переписку!
   */
  const handleSelectFoundFriend = async (friend: PublicUserProfile) => {
    if (!googleProfile) return;
    if (!guardAgainstSuspiciousBurst(handleSecurityLogoutTriggered)) return;
    setOpeningFriendUid(friend.uid);
    try {
      const openedChat = await openOrCreateFriendChat(googleProfile, friend);
      setCloudChats((prev) => {
        const exists = prev.some((c) => c.id === openedChat.id);
        return exists ? prev : [openedChat, ...prev];
      });
      setSelectedChatId(openedChat.id);
      setActiveTab('chats');
      setSidebarSearch('');
      setIsSearchFocused(false);
      showToast(`Чат с ${friend.displayName} открыт`);
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Не удалось открыть чат с пользователем'
      );
    } finally {
      setOpeningFriendUid(null);
    }
  };

  /**
   * Начало звонка (для облачных чатов отправляет сигнал вызова другу через Firestore).
   */
  const startCallWithChat = async (chat: Chat, type: CallType) => {
    setActiveCall({ chat, type });
    if (chat.isCloudChat && googleProfile?.uid) {
      try {
        await updateCloudCallSignaling({
          conversationId: chat.id,
          activeCallType: type === CallType.VIDEO ? 'video' : 'audio',
          activeCallStatus: 'ringing',
          activeCallInitiatorId: googleProfile.uid,
        });
      } catch {
        // Локальное окно звонка уже открыто
      }
    }
  };

  const handleAcceptIncomingCloudCall = async (chat: Chat) => {
    const cType =
      chat.activeCallType === 'video' ? CallType.VIDEO : CallType.AUDIO;
    setSelectedChatId(chat.id);
    setActiveTab('chats');
    setActiveCall({ chat, type: cType });
    if (googleProfile?.uid) {
      await updateCloudCallSignaling({
        conversationId: chat.id,
        activeCallType: chat.activeCallType || 'audio',
        activeCallStatus: 'connected',
        activeCallInitiatorId: chat.activeCallInitiatorId || '',
      }).catch(() => {});
    }
  };

  const handleDeclineIncomingCloudCall = async (chat: Chat) => {
    await updateCloudCallSignaling({
      conversationId: chat.id,
      activeCallType: 'none',
      activeCallStatus: 'idle',
      activeCallInitiatorId: '',
    }).catch(() => {});
  };

  /**
   * Сохранение сообщения в локальный чат (IndexedDB) + опциональный автоответ демо-контакта.
   */
  const appendMessageToLocalChat = async (
    chat: Chat,
    newMsg: Message,
    previewLabel: string,
    triggerAutoReply = true
  ) => {
    await saveMessage(newMsg);
    const updatedChat: Chat = {
      ...chat,
      lastMessagePreview: previewLabel,
      lastMessageTime: newMsg.timestamp,
      unreadCount: 0,
    };
    await saveChat(updatedChat);

    if (selectedChatId === chat.id) {
      setMessages((prev) => [...prev, newMsg]);
    }
    setLocalChats(await getChats());

    if (
      triggerAutoReply &&
      settings.autoReplyEnabled &&
      newMsg.senderId === 'me' &&
      newMsg.type !== MessageType.CALL_EVENT
    ) {
      const targetChatId = chat.id;
      const responderName = chat.isGroup ? 'Алексей' : chat.name;
      window.setTimeout(() => {
        setTypingChatId(targetChatId);
      }, 650);

      window.setTimeout(async () => {
        setTypingChatId((curr) => (curr === targetChatId ? null : curr));
        const replyText =
          AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)];
        const autoMsg: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          chatId: targetChatId,
          senderId: targetChatId,
          senderName: responderName,
          type: MessageType.TEXT,
          text: replyText,
          timestamp: Date.now(),
          status: 'read',
        };
        await saveMessage(autoMsg);

        const latestChats = await getChats();
        const found = latestChats.find((c) => c.id === targetChatId);
        if (found) {
          const isCurrentlyOpen = selectedChatId === targetChatId;
          await saveChat({
            ...found,
            lastMessagePreview: chat.isGroup
              ? `${responderName}: ${replyText}`
              : replyText,
            lastMessageTime: autoMsg.timestamp,
            unreadCount: isCurrentlyOpen ? 0 : (found.unreadCount || 0) + 1,
          });
          setLocalChats(await getChats());
          if (isCurrentlyOpen) {
            setMessages(await getMessagesByChat(targetChatId));
          }
        }
      }, 2100);
    }
  };

  /**
   * Отправка текстового сообщения со сквозным шифрованием E2EE (в Firestore для друзей, либо с шифрованием на диске в IndexedDB).
   */
  const handleSendText = async () => {
    const trimmed = draftText.trim();
    if (!trimmed || !selectedChat) return;
    if (!guardAgainstSuspiciousBurst(handleSecurityLogoutTriggered)) return;

    const replyRef = replyToMsg
      ? {
          id: replyToMsg.id,
          senderName: replyToMsg.senderName,
          previewText:
            replyToMsg.text ||
            (replyToMsg.type === MessageType.IMAGE
              ? 'Фотография'
              : replyToMsg.type === MessageType.VIDEO
              ? 'Видеозапись'
              : 'Голосовое сообщение'),
        }
      : undefined;

    setDraftText('');
    setReplyToMsg(null);
    setShowEmojiPicker(false);

    if (selectedChat.isCloudChat && googleProfile) {
      try {
        await sendCloudChatMessage({
          chat: selectedChat,
          currentUser: googleProfile,
          type: MessageType.TEXT,
          text: trimmed,
          previewLabel: trimmed,
          replyToSender: replyRef?.senderName,
          replyToPreview: replyRef?.previewText,
        });
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : 'Не удалось зашифровать и отправить сообщение'
        );
      }
      return;
    }

    const now = Date.now();
    const isFromMe = !sendAsContact;
    const newMsg: Message = {
      id: `msg_${now}_${Math.random().toString(36).slice(2, 7)}`,
      chatId: selectedChat.id,
      senderId: isFromMe ? 'me' : selectedChat.id,
      senderName: isFromMe ? settings.userName : selectedChat.name,
      type: MessageType.TEXT,
      text: trimmed,
      isEncrypted: true,
      timestamp: now,
      status: 'read',
      replyTo: replyRef,
    };

    await appendMessageToLocalChat(selectedChat, newMsg, trimmed, isFromMe);
  };

  /**
   * Подготовка фото/видео к сжатию и отправке.
   */
  const stageFileForSending = (file: File) => {
    if (!selectedChat) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      showToast('Поддерживаются изображения (JPG, PNG, WebP) и видеофайлы (MP4, WebM).');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPendingMediaFile({
      file,
      kind: isImage ? 'image' : 'video',
      previewUrl,
      caption: '',
    });
    setShowAttachMenu(false);
  };

  const handleConfirmSendStagedMedia = async () => {
    if (!pendingMediaFile || !selectedChat) return;
    if (!guardAgainstSuspiciousBurst(handleSecurityLogoutTriggered)) return;
    setIsCompressingMedia(true);

    try {
      const { file, kind, caption, previewUrl } = pendingMediaFile;
      const now = Date.now();
      const isFromMe = !sendAsContact;

      if (kind === 'image') {
        const compressed = await compressImageBlob(
          file,
          settings.imageMaxDimension,
          settings.imageQuality
        );
        const mediaId = await saveMediaBlob({
          blob: compressed.blob,
          mimeType: compressed.mimeType,
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          width: compressed.width,
          height: compressed.height,
        });

        const previewLabel = caption.trim()
          ? `Фото · ${caption.trim()}`
          : 'Фотография';

        if (selectedChat.isCloudChat && googleProfile) {
          const remoteThumb = await createCompactRemoteThumbnail(compressed.blob);
          await sendCloudChatMessage({
            chat: selectedChat,
            currentUser: googleProfile,
            type: MessageType.IMAGE,
            text: caption.trim(),
            previewLabel,
            mediaId,
            mediaMimeType: compressed.mimeType,
            rawRemoteMediaDataUrl: remoteThumb,
            compressedSize: compressed.compressedSize,
            originalSize: compressed.originalSize,
          });
        } else {
          const msg: Message = {
            id: `msg_${now}_img`,
            chatId: selectedChat.id,
            senderId: isFromMe ? 'me' : selectedChat.id,
            senderName: isFromMe ? settings.userName : selectedChat.name,
            type: MessageType.IMAGE,
            text: caption.trim(),
            isEncrypted: true,
            timestamp: now,
            status: 'read',
            mediaId,
            mediaMimeType: compressed.mimeType,
            mediaWidth: compressed.width,
            mediaHeight: compressed.height,
            originalSize: compressed.originalSize,
            compressedSize: compressed.compressedSize,
          };
          await appendMessageToLocalChat(selectedChat, msg, previewLabel, isFromMe);
        }

        const savedBytes = Math.max(
          0,
          compressed.originalSize - compressed.compressedSize
        );
        if (savedBytes > 1024) {
          showToast(
            `Фото сжато и зашифровано: ${formatBytes(
              compressed.originalSize
            )} → ${formatBytes(compressed.compressedSize)}`
          );
        }
      } else {
        const processed = await processVideoBlob(file);
        const mediaId = await saveMediaBlob({
          blob: processed.blob,
          mimeType: processed.mimeType,
          originalSize: processed.originalSize,
          compressedSize: processed.compressedSize,
          width: processed.width,
          height: processed.height,
          duration: processed.duration,
          posterDataUrl: processed.posterDataUrl,
        });

        const previewLabel = caption.trim()
          ? `Видео · ${caption.trim()}`
          : 'Видеозапись';

        if (selectedChat.isCloudChat && googleProfile) {
          await sendCloudChatMessage({
            chat: selectedChat,
            currentUser: googleProfile,
            type: MessageType.VIDEO,
            text: caption.trim(),
            previewLabel,
            mediaId,
            mediaMimeType: processed.mimeType,
            rawRemoteMediaDataUrl: processed.posterDataUrl,
            compressedSize: processed.compressedSize,
            originalSize: processed.originalSize,
            mediaDuration: processed.duration,
          });
        } else {
          const msg: Message = {
            id: `msg_${now}_vid`,
            chatId: selectedChat.id,
            senderId: isFromMe ? 'me' : selectedChat.id,
            senderName: isFromMe ? settings.userName : selectedChat.name,
            type: MessageType.VIDEO,
            text: caption.trim(),
            isEncrypted: true,
            timestamp: now,
            status: 'read',
            mediaId,
            mediaMimeType: processed.mimeType,
            mediaWidth: processed.width,
            mediaHeight: processed.height,
            mediaDuration: processed.duration,
            mediaPosterDataUrl: processed.posterDataUrl,
            originalSize: processed.originalSize,
            compressedSize: processed.compressedSize,
          };
          await appendMessageToLocalChat(selectedChat, msg, previewLabel, isFromMe);
        }
        showToast(
          `Видео (${formatBytes(processed.compressedSize)}) зашифровано и сохранено`
        );
      }

      URL.revokeObjectURL(previewUrl);
      setPendingMediaFile(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Ошибка обработки медиафайла');
    } finally {
      setIsCompressingMedia(false);
    }
  };

  const handleSendRecordedVideo = async (blob: Blob, caption: string) => {
    setShowVideoRecorder(false);
    if (!selectedChat) return;
    if (!guardAgainstSuspiciousBurst(handleSecurityLogoutTriggered)) return;

    const processed = await processVideoBlob(blob);
    const mediaId = await saveMediaBlob({
      blob: processed.blob,
      mimeType: processed.mimeType,
      originalSize: processed.originalSize,
      compressedSize: processed.compressedSize,
      width: processed.width,
      height: processed.height,
      duration: processed.duration,
      posterDataUrl: processed.posterDataUrl,
    });

    const previewLabel = caption ? `Видео · ${caption}` : 'Видеосообщение';

    if (selectedChat.isCloudChat && googleProfile) {
      try {
        await sendCloudChatMessage({
          chat: selectedChat,
          currentUser: googleProfile,
          type: MessageType.VIDEO,
          text: caption,
          previewLabel,
          mediaId,
          mediaMimeType: processed.mimeType,
          rawRemoteMediaDataUrl: processed.posterDataUrl,
          compressedSize: processed.compressedSize,
          originalSize: processed.originalSize,
          mediaDuration: processed.duration,
        });
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : 'Не удалось отправить зашифрованное видео'
        );
        return;
      }
    } else {
      const now = Date.now();
      const msg: Message = {
        id: `msg_${now}_camvid`,
        chatId: selectedChat.id,
        senderId: 'me',
        senderName: settings.userName,
        type: MessageType.VIDEO,
        text: caption,
        isEncrypted: true,
        timestamp: now,
        status: 'read',
        mediaId,
        mediaMimeType: processed.mimeType,
        mediaWidth: processed.width,
        mediaHeight: processed.height,
        mediaDuration: processed.duration,
        mediaPosterDataUrl: processed.posterDataUrl,
        originalSize: processed.originalSize,
        compressedSize: processed.compressedSize,
      };
      await appendMessageToLocalChat(selectedChat, msg, previewLabel, true);
    }
    showToast(`Видеосообщение (${formatBytes(processed.compressedSize)}) отправлено`);
  };

  /**
   * Запись голосового сообщения со сквозным шифрованием E2EE.
   */
  const startVoiceRecording = async () => {
    if (!selectedChat) return;
    if (!guardAgainstSuspiciousBurst(handleSecurityLogoutTriggered)) return;
    voiceCancelledRef.current = false;
    voiceChunksRef.current = [];
    setVoiceSeconds(0);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      await sendFallbackVoiceMessage();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;

      const mimeOptions = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const chosenMime =
        mimeOptions.find(
          (m) =>
            typeof MediaRecorder !== 'undefined' &&
            MediaRecorder.isTypeSupported(m)
        ) || '';

      const recorder = new MediaRecorder(stream, {
        ...(chosenMime ? { mimeType: chosenMime } : {}),
        audioBitsPerSecond: 24_000,
      });

      const capturedAmplitudes: number[] = [];

      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        voiceAudioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        const freq = new Uint8Array(analyser.frequencyBinCount);

        const updateWave = () => {
          analyser.getByteFrequencyData(freq);
          const avg = freq.reduce((a, b) => a + b, 0) / freq.length;
          const norm = Math.max(0.18, Math.min(0.98, avg / 85));
          capturedAmplitudes.push(norm);
          setVoiceBars((prev) => [...prev.slice(1), norm]);
          voiceAnimRef.current = requestAnimationFrame(updateWave);
        };
        updateWave();
      } catch {
        // Без WebAudio
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          voiceChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (voiceAnimRef.current) cancelAnimationFrame(voiceAnimRef.current);
        if (voiceAudioCtxRef.current) {
          voiceAudioCtxRef.current.close().catch(() => {});
          voiceAudioCtxRef.current = null;
        }
        if (voiceStreamRef.current) {
          voiceStreamRef.current.getTracks().forEach((t) => t.stop());
          voiceStreamRef.current = null;
        }

        if (voiceCancelledRef.current || !selectedChat) return;

        const blob = new Blob(voiceChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size < 100) return;

        const step = Math.max(1, Math.floor(capturedAmplitudes.length / 28));
        const finalWave = Array.from({ length: 28 }, (_, i) => {
          const val = capturedAmplitudes[i * step] ?? 0.35 + (i % 3) * 0.15;
          return Number(val.toFixed(2));
        });

        const dur = Math.max(1, voiceSeconds);
        const mediaId = await saveMediaBlob({
          blob,
          mimeType: blob.type || 'audio/webm',
          originalSize: blob.size * 3,
          compressedSize: blob.size,
          duration: dur,
        });

        const previewLabel = `Голосовое сообщение (${formatDuration(dur)})`;

        if (selectedChat.isCloudChat && googleProfile) {
          try {
            const voiceDataUrl = await encodeCompactVoiceDataUrl(blob);
            await sendCloudChatMessage({
              chat: selectedChat,
              currentUser: googleProfile,
              type: MessageType.VOICE,
              text: '',
              previewLabel,
              mediaId,
              mediaMimeType: blob.type || 'audio/webm',
              rawRemoteMediaDataUrl: voiceDataUrl,
              waveform: finalWave,
              compressedSize: blob.size,
              originalSize: blob.size * 3,
              mediaDuration: dur,
            });
          } catch (err) {
            showToast(
              err instanceof Error
                ? err.message
                : 'Не удалось зашифровать голосовое сообщение'
            );
          }
        } else {
          const now = Date.now();
          const isFromMe = !sendAsContact;
          const voiceMsg: Message = {
            id: `msg_${now}_voice`,
            chatId: selectedChat.id,
            senderId: isFromMe ? 'me' : selectedChat.id,
            senderName: isFromMe ? settings.userName : selectedChat.name,
            type: MessageType.VOICE,
            text: '',
            isEncrypted: true,
            timestamp: now,
            status: 'read',
            mediaId,
            mediaMimeType: blob.type || 'audio/webm',
            mediaDuration: dur,
            originalSize: blob.size * 3,
            compressedSize: blob.size,
            waveform: finalWave,
          };
          await appendMessageToLocalChat(
            selectedChat,
            voiceMsg,
            previewLabel,
            isFromMe
          );
        }
      };

      voiceRecorderRef.current = recorder;
      recorder.start(200);
      setIsRecordingVoice(true);
    } catch {
      await sendFallbackVoiceMessage();
    }
  };

  const sendFallbackVoiceMessage = async () => {
    if (!selectedChat) return;
    const synth = generateCompactVoiceWav(3.5);
    const mediaId = await saveMediaBlob({
      blob: synth.blob,
      mimeType: 'audio/wav',
      originalSize: synth.blob.size * 2,
      compressedSize: synth.blob.size,
      duration: synth.duration,
    });
    const previewLabel = `Голосовое сообщение (${formatDuration(synth.duration)})`;

    if (selectedChat.isCloudChat && googleProfile) {
      try {
        const voiceDataUrl = await encodeCompactVoiceDataUrl(synth.blob);
        await sendCloudChatMessage({
          chat: selectedChat,
          currentUser: googleProfile,
          type: MessageType.VOICE,
          text: '',
          previewLabel,
          mediaId,
          mediaMimeType: 'audio/wav',
          rawRemoteMediaDataUrl: voiceDataUrl,
          waveform: synth.waveform,
          compressedSize: synth.blob.size,
          originalSize: synth.blob.size * 2,
          mediaDuration: synth.duration,
        });
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : 'Не удалось отправить голосовое сообщение'
        );
        return;
      }
    } else {
      const now = Date.now();
      const msg: Message = {
        id: `msg_${now}_synthvoice`,
        chatId: selectedChat.id,
        senderId: 'me',
        senderName: settings.userName,
        type: MessageType.VOICE,
        text: '',
        isEncrypted: true,
        timestamp: now,
        status: 'read',
        mediaId,
        mediaMimeType: 'audio/wav',
        mediaDuration: synth.duration,
        originalSize: synth.blob.size * 2,
        compressedSize: synth.blob.size,
        waveform: synth.waveform,
      };
      await appendMessageToLocalChat(selectedChat, msg, previewLabel, true);
    }
    showToast('Голосовое сообщение зашифровано и отправлено');
  };

  const finishVoiceRecording = (cancel: boolean) => {
    voiceCancelledRef.current = cancel;
    setIsRecordingVoice(false);
    if (
      voiceRecorderRef.current &&
      voiceRecorderRef.current.state !== 'inactive'
    ) {
      voiceRecorderRef.current.stop();
    }
  };

  /**
   * Завершение аудио/видео звонка.
   */
  const handleEndCall = async (finalType: CallType, durationSec: number) => {
    if (!activeCall) return;
    const targetChat = activeCall.chat;
    setActiveCall(null);

    const now = Date.now();
    const log: CallLog = {
      id: `call_${now}`,
      chatId: targetChat.id,
      contactName: targetChat.name,
      contactAvatar: targetChat.avatarUrl,
      type: finalType,
      direction: CallDirection.OUTGOING,
      timestamp: now,
      durationSec,
    };
    await saveCallLog(log);
    setCalls(await getCalls());

    const summaryText =
      finalType === CallType.VIDEO
        ? `Видеозвонок · ${formatDuration(durationSec)}`
        : `Аудиозвонок · ${formatDuration(durationSec)}`;

    if (targetChat.isCloudChat && googleProfile) {
      await updateCloudCallSignaling({
        conversationId: targetChat.id,
        activeCallType: 'none',
        activeCallStatus: 'idle',
        activeCallInitiatorId: '',
      }).catch(() => {});

      await sendCloudChatMessage({
        chat: targetChat,
        currentUser: googleProfile,
        type: MessageType.CALL_EVENT,
        text: summaryText,
        previewLabel: summaryText,
        callType: finalType,
        callDurationSec: durationSec,
      });
    } else {
      const callMsg: Message = {
        id: `msg_${now}_call`,
        chatId: targetChat.id,
        senderId: 'me',
        senderName: settings.userName,
        type: MessageType.CALL_EVENT,
        text: summaryText,
        timestamp: now,
        status: 'read',
        callType: finalType,
        callDurationSec: durationSec,
      };
      await appendMessageToLocalChat(targetChat, callMsg, summaryText, false);
    }
  };

  const handleCreateNewLocalChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newChatName.trim();
    if (!name) return;

    const now = Date.now();
    const newChat: Chat = {
      id: `chat_${now}`,
      name,
      phone:
        newChatPhone.trim() ||
        (newChatIsGroup ? 'Групповой чат' : '+7 (900) 000-00-00'),
      about: newChatIsGroup
        ? 'Участники группы'
        : 'Локальный контакт',
      isGroup: newChatIsGroup,
      membersCount: newChatIsGroup ? 3 : undefined,
      lastMessagePreview: 'Чат создан',
      lastMessageTime: now,
      unreadCount: 0,
      pinned: false,
      onlineStatus: newChatIsGroup ? '3 участника' : 'в сети',
    };

    await saveChat(newChat);
    setLocalChats(await getChats());
    setSelectedChatId(newChat.id);
    setActiveTab('chats');
    setNewChatName('');
    setNewChatPhone('');
    setNewChatIsGroup(false);
    setShowNewChatModal(false);
  };

  const handleDeleteMessage = async (msg: Message) => {
    if (selectedChat?.isCloudChat) {
      if (msg.senderId !== 'me') {
        showToast('Можно удалять только собственные отправленные сообщения');
        return;
      }
      await deleteCloudChatMessage(selectedChat.id, msg.id);
      return;
    }
    await deleteMessageById(msg.id);
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  };

  const handleTogglePinChat = async (chat: Chat) => {
    if (chat.isCloudChat) {
      setShowChatMenu(false);
      return;
    }
    await saveChat({ ...chat, pinned: !chat.pinned });
    setLocalChats(await getChats());
    setShowChatMenu(false);
  };

  const handleClearCurrentChat = async () => {
    if (!selectedChat || selectedChat.isCloudChat) return;
    await clearChatMessages(selectedChat.id);
    await saveChat({
      ...selectedChat,
      lastMessagePreview: 'История сообщений очищена',
    });
    setMessages([]);
    setLocalChats(await getChats());
    setShowChatMenu(false);
    showToast('Переписка чата очищена');
  };

  const handleDeleteCurrentChat = async () => {
    if (!selectedChat || selectedChat.isCloudChat) return;
    const idToRemove = selectedChat.id;
    await deleteChatAndMessages(idToRemove);
    const remaining = await getChats();
    setLocalChats(remaining);
    setSelectedChatId(remaining[0]?.id || null);
    setShowChatMenu(false);
    showToast('Локальный чат удалён');
  };

  // Экран загрузки состояния Google Auth
  if (authChecking) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A] text-sm text-slate-500 dark:text-slate-400">
        Подключение к мессенджеру...
      </div>
    );
  }

  // Экран регистрации / входа через Google Auth
  if (!firebaseUser && !bypassAuthGate) {
    return (
      <AuthScreen
        securityAlertReason={securityAlertReason}
        onGoogleLogin={handleGoogleLogin}
        onContinueLocal={() => {
          setSecurityAlertReason(null);
          setBypassAuthGate(true);
        }}
      />
    );
  }

  return (
    <div className="h-dvh w-screen overflow-hidden flex flex-col md:flex-row bg-[#F0F2F5] dark:bg-[#0B141A] text-[#111B21] dark:text-[#E9EDEF] pwa-safe-top">
      <OfflineConnectivityBanner />

      {/* Всплывающее уведомление (Toast) */}
      {toastMessage && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium shadow-xl border border-slate-700 flex items-center gap-2">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Баннер входящего звонка от друга из Google */}
      {incomingCloudCallChat && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-md px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl border border-slate-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              name={incomingCloudCallChat.name}
              src={incomingCloudCallChat.avatarUrl}
              size="md"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {incomingCloudCallChat.name}
              </p>
              <p className="text-xs text-emerald-400">
                Входящий{' '}
                {incomingCloudCallChat.activeCallType === 'video'
                  ? 'видеозвонок'
                  : 'аудиозвонок'}
                ...
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                handleDeclineIncomingCloudCall(incomingCloudCallChat)
              }
              className="p-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors"
              title="Отклонить"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                handleAcceptIncomingCloudCall(incomingCloudCallChat)
              }
              className="px-3.5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Ответить</span>
            </button>
          </div>
        </div>
      )}

      {/* Левая навигационная колонка (Desktop) */}
      <aside className="hidden md:flex flex-col items-center justify-between w-16 py-4 bg-[#F0F2F5] dark:bg-[#202C33] border-r border-slate-200/90 dark:border-slate-800 shrink-0">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('chats')}
            className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
              activeTab === 'chats'
                ? 'bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Чаты"
          >
            <MessageSquare className="w-5 h-5" />
            {totalUnreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold font-mono tabular-nums flex items-center justify-center">
                {totalUnreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calls')}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
              activeTab === 'calls'
                ? 'bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Журнал звонков"
          >
            <PhoneCall className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
              activeTab === 'settings'
                ? 'bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Настройки и Бэкап"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() =>
              handleUpdateSettings({
                ...settings,
                theme: settings.theme === 'dark' ? 'light' : 'dark',
              })
            }
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title={
              settings.theme === 'dark'
                ? 'Включить светлую тему'
                : 'Включить тёмную тему'
            }
          >
            {settings.theme === 'dark' ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            title={`Профиль: ${googleProfile?.displayName || settings.userName}`}
          >
            <Avatar
              name={googleProfile?.displayName || settings.userName}
              src={googleProfile?.photoURL}
              size="sm"
            />
          </button>
        </div>
      </aside>

      {/* РЕЖИМ НАСТРОЕК И БЭКАПА */}
      {activeTab === 'settings' ? (
        <SettingsPanel
          settings={settings}
          googleProfile={googleProfile}
          googleEmail={firebaseUser?.email}
          onGoogleLogin={handleGoogleLogin}
          onGoogleLogout={handleGoogleLogout}
          onEmergencyLockdown={handleEmergencyLockdown}
          onSaveProfileToCloud={async (displayName, about) => {
            if (!firebaseUser) return;
            const updated = await registerOrSyncGoogleUser(
              firebaseUser,
              about,
              displayName
            );
            setGoogleProfile(updated);
          }}
          onUpdateSettings={handleUpdateSettings}
          onBackupImported={async () => {
            const loaded = loadSettingsFromLocalStorage();
            setSettings(loaded);
            await reloadLocalData(false);
          }}
          onResetDemo={async () => {
            await resetToDemoData();
            await reloadLocalData(false);
            showToast('Демонстрационные чаты восстановлены');
          }}
          onClearAll={async () => {
            await wipeAllStorageData();
            setLocalChats([]);
            setMessages([]);
            setCalls([]);
            setSelectedChatId(cloudChats[0]?.id || null);
            showToast('Локальное хранилище очищено');
          }}
          onNotify={showToast}
        />
      ) : activeTab === 'calls' ? (
        /* РЕЖИМ ЖУРНАЛА ЗВОНКОВ */
        <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111B21]">
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Аудио и видеозвонки
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Нажмите на иконку трубки или камеры напротив контакта, чтобы начать звонок.
              </p>
            </div>

            {calls.length === 0 ? (
              <div className="py-16 text-center rounded-xl border border-slate-200 dark:border-slate-800">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  История звонков пока пуста. Откройте любой чат и нажмите кнопку аудио- или видеозвонка.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {calls.map((call) => {
                  const relatedChat = allChats.find((c) => c.id === call.chatId);
                  return (
                    <div
                      key={call.id}
                      className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-[#182229] transition-colors"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <Avatar
                          name={call.contactName}
                          src={call.contactAvatar}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {call.contactName}
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                            {call.direction === CallDirection.INCOMING ? (
                              <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                            <span>
                              {call.type === CallType.VIDEO
                                ? 'Видеозвонок'
                                : 'Аудиозвонок'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{formatDuration(call.durationSec)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatChatTimestamp(call.timestamp)}</span>
                          </div>
                        </div>
                      </div>

                      {relatedChat && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              startCallWithChat(relatedChat, CallType.AUDIO)
                            }
                            className="p-2.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2A3942] transition-colors"
                            title="Аудиозвонок"
                          >
                            <Phone className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              startCallWithChat(relatedChat, CallType.VIDEO)
                            }
                            className="p-2.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                            title="Видеозвонок"
                          >
                            <Video className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ОСНОВНОЙ РЕЖИМ: СПИСОК ЧАТОВ + ПОИСК ДРУЗЕЙ + ОКНО ПЕРЕПИСКИ */
        <div className="flex-1 flex min-w-0 min-h-0">
          {/* Левая панель списка чатов и поиска друзей */}
          <section
            className={`${
              selectedChatId ? 'hidden md:flex' : 'flex'
            } flex-col w-full md:w-[360px] lg:w-[395px] shrink-0 bg-white dark:bg-[#111B21] border-r border-slate-200 dark:border-slate-800`}
          >
            {/* Верхняя шапка и строка поиска друзей в базе */}
            <div className="px-4 pt-4 pb-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  Чаты
                </h1>

                <div className="flex items-center gap-1.5">
                  {!googleProfile ? (
                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Войти (Google)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSearchFocused(true);
                        searchInputRef.current?.focus();
                      }}
                      className="p-2 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-[#202C33] transition-colors"
                      title="Найти друга по имени в базе"
                    >
                      <UserPlus className="w-5 h-5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowNewChatModal(true)}
                    className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#202C33] transition-colors"
                    title="Создать локальный контакт или группу"
                  >
                    <Plus className="w-5 h-5" />
                  </button>

                  {pwaBannerDismissed && (
                    <PWAInstallButton variant="compact" />
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 hover:bg-emerald-600/20 transition-colors whitespace-nowrap shrink-0"
                    title="Открыть настройки и Бэкап"
                  >
                    Бэкап
                  </button>
                </div>
              </div>

              {/* РАБОЧАЯ СТРОКА ПОИСКА ДРУЗЕЙ И ЧАТОВ */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={sidebarSearch}
                  onFocus={() => setIsSearchFocused(true)}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  placeholder={
                    googleProfile
                      ? 'Введите имя друга для нового чата...'
                      : 'Поиск чата (войдите в Google для поиска друзей)'
                  }
                  className="w-full pl-10 pr-8 py-2 rounded-lg text-sm bg-[#F0F2F5] dark:bg-[#202C33] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
                />
                {(sidebarSearch || isSearchFocused) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSidebarSearch('');
                      setIsSearchFocused(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label="Очистить поиск"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Фильтры чатов */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33]">
                {(
                  [
                    { id: 'all', label: 'Все' },
                    { id: 'unread', label: 'Непрочитанные' },
                    { id: 'groups', label: 'Группы' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setChatFilter(tab.id)}
                    className={`flex-1 py-1 px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      chatFilter === tab.id
                        ? 'bg-white dark:bg-[#2A3942] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Баннер установки мобильного приложения на телефон (PWA) */}
            {!pwaBannerDismissed && (
              <PWAInstallButton
                variant="banner"
                onDismissBanner={() => setPwaBannerDismissed(true)}
              />
            )}

            {/* Прокручиваемая область: Найденные друзья в базе + Список чатов */}
            <div className="flex-1 overflow-y-auto">
              {/* Секция найденных зарегистрированных пользователей в базе Firestore */}
              {googleProfile && (sidebarSearch.trim().length > 0 || isSearchFocused) && (
                <div className="border-b border-slate-200 dark:border-slate-800 bg-emerald-50/40 dark:bg-[#182229]/70">
                  <div className="px-4 py-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-emerald-800 dark:text-emerald-400">
                      Пользователи в базе данных
                    </span>
                    {isSearchingDbUsers && <span>Поиск...</span>}
                  </div>

                  {!isSearchingDbUsers && foundDbUsers.length === 0 ? (
                    <div className="px-4 pb-3.5 text-xs text-slate-500 dark:text-slate-400">
                      {sidebarSearch.trim()
                        ? `Пользователь «${sidebarSearch.trim()}» пока не найден. Попросите друга войти через Google.`
                        : 'Другие пользователи пока не зарегистрировались. Когда друг войдёт через Google, его аккаунт появится здесь.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {foundDbUsers.map((friend) => (
                        <button
                          key={friend.uid}
                          type="button"
                          disabled={openingFriendUid === friend.uid}
                          onClick={() => handleSelectFoundFriend(friend)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-emerald-100/50 dark:hover:bg-[#202C33] transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar
                              name={friend.displayName}
                              src={friend.photoURL}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {friend.displayName}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {friend.about}
                              </p>
                            </div>
                          </div>

                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
                            {openingFriendUid === friend.uid
                              ? 'Открытие...'
                              : 'Начать чат'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Список активных чатов */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {isInitializing && allChats.length === 0 ? (
                  <div className="p-6 space-y-4">
                    {[1, 2, 3].map((n) => (
                      <div key={n} className="flex items-center gap-3 animate-pulse">
                        <div className="w-11 h-11 rounded-full bg-slate-200 dark:bg-slate-800" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                          <div className="h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-800/70" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredChats.length === 0 ? (
                  <div className="px-6 py-12 text-center space-y-3">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {sidebarSearch
                        ? 'Среди открытых чатов совпадений нет.'
                        : 'Список чатов пуст.'}
                    </p>
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const isActive = chat.id === selectedChatId;
                    const isTyping = typingChatId === chat.id;
                    return (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => setSelectedChatId(chat.id)}
                        className={`w-full flex items-center gap-3.5 px-4 py-3 text-left transition-colors ${
                          isActive
                            ? 'bg-[#F0F2F5] dark:bg-[#2A3942]'
                            : 'hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]'
                        }`}
                      >
                        <Avatar
                          name={chat.name}
                          src={chat.avatarUrl}
                          isGroup={chat.isGroup}
                          size="md"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {chat.name}
                              </span>
                              {chat.isCloudChat && (
                                <span className="text-[11px] text-emerald-700 dark:text-emerald-400 shrink-0">
                                  · Google
                                </span>
                              )}
                            </div>
                            <span
                              className={`text-[11px] font-mono tabular-nums shrink-0 ${
                                chat.unreadCount > 0
                                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {formatChatTimestamp(chat.lastMessageTime)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p
                              className={`text-xs truncate ${
                                isTyping
                                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {isTyping ? 'печатает...' : chat.lastMessagePreview}
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {chat.pinned && (
                                <Pin className="w-3.5 h-3.5 text-slate-400 rotate-45" />
                              )}
                              {chat.unreadCount > 0 && (
                                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-semibold font-mono tabular-nums flex items-center justify-center">
                                  {chat.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* Правая область активного чата */}
          {selectedChat ? (
            <main
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) stageFileForSending(file);
              }}
              className="relative flex-1 flex flex-col min-w-0 min-h-0 wa-chat-canvas"
            >
              {isDraggingOver && (
                <div className="absolute inset-3 z-30 rounded-2xl bg-emerald-900/75 backdrop-blur-xs border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center text-white pointer-events-none">
                  <ImageIcon className="w-10 h-10 mb-2 text-emerald-300" />
                  <p className="text-base font-semibold">
                    Отпустите фото или видео для автоматического сжатия и отправки
                  </p>
                </div>
              )}

              {/* Шапка чата */}
              <header className="h-16 px-4 bg-[#F0F2F5] dark:bg-[#202C33] border-b border-slate-200/90 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0 z-20">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedChatId(null)}
                    className="md:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5"
                    aria-label="Назад к списку чатов"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>

                  <Avatar
                    name={selectedChat.name}
                    src={selectedChat.avatarUrl}
                    isGroup={selectedChat.isGroup}
                    size="sm"
                  />

                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {selectedChat.name}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {typingChatId === selectedChat.id
                        ? 'печатает...'
                        : selectedChat.onlineStatus}
                    </p>
                  </div>
                </div>

                {/* Кнопки проверки E2EE, звонков, поиска по чату и меню */}
                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 relative">
                  <button
                    type="button"
                    onClick={() => setSafetyModalChat(selectedChat)}
                    className="p-2.5 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-white/10 transition-colors"
                    title="Проверить код сквозного шифрования (E2EE)"
                  >
                    <ShieldCheck className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      startCallWithChat(selectedChat, CallType.VIDEO)
                    }
                    className="p-2.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    title="Начать видеозвонок"
                  >
                    <Video className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      startCallWithChat(selectedChat, CallType.AUDIO)
                    }
                    className="p-2.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    title="Начать аудиозвонок"
                  >
                    <Phone className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsChatSearchOpen((v) => !v);
                      setChatMessageSearch('');
                    }}
                    className={`p-2.5 rounded-lg transition-colors ${
                      isChatSearchOpen
                        ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                    title="Поиск в переписке"
                  >
                    <Search className="w-5 h-5" />
                  </button>

                  {!selectedChat.isCloudChat && (
                    <button
                      type="button"
                      onClick={() => setShowChatMenu((m) => !m)}
                      className="p-2.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      title="Меню чата"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                  )}

                  {showChatMenu && !selectedChat.isCloudChat && (
                    <div className="absolute right-0 top-12 w-60 rounded-xl bg-white dark:bg-[#233138] border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-30 text-sm">
                      <button
                        type="button"
                        onClick={() => handleTogglePinChat(selectedChat)}
                        className="w-full px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
                      >
                        <Pin className="w-4 h-4 text-slate-500" />
                        <span>
                          {selectedChat.pinned ? 'Открепить чат' : 'Закрепить чат'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSendAsContact((v) => !v);
                          setShowChatMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
                      >
                        <Reply className="w-4 h-4 text-emerald-600" />
                        <span>
                          {sendAsContact
                            ? 'Режим: писать от себя'
                            : 'Тест: написать за собеседника'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleClearCurrentChat}
                        className="w-full px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-[#182229] flex items-center gap-2.5"
                      >
                        <Trash2 className="w-4 h-4 text-slate-500" />
                        <span>Очистить сообщения</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDeleteCurrentChat}
                        className="w-full px-4 py-2 text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2.5"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Удалить чат</span>
                      </button>
                    </div>
                  )}
                </div>
              </header>

              {/* Поиск внутри переписки */}
              {isChatSearchOpen && (
                <div className="px-4 py-2 bg-white dark:bg-[#182229] border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    autoFocus
                    value={chatMessageSearch}
                    onChange={(e) => setChatMessageSearch(e.target.value)}
                    placeholder="Найти текст в этом чате..."
                    className="flex-1 text-sm bg-transparent focus:outline-none text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setIsChatSearchOpen(false);
                      setChatMessageSearch('');
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Закрыть
                  </button>
                </div>
              )}

              {/* Лента сообщений */}
              <div
                onClick={() => {
                  setShowAttachMenu(false);
                  setShowEmojiPicker(false);
                  setShowChatMenu(false);
                }}
                className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-14 py-5 space-y-2.5"
              >
                <div className="text-center pb-2">
                  <button
                    type="button"
                    onClick={() => setSafetyModalChat(selectedChat)}
                    className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                  >
                    <Lock className="w-3 h-3 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    <span>
                      {selectedChat.isCloudChat
                        ? 'Сообщения, голосовые заметки и медиа защищены сквозным шифрованием ECDH P-256 + AES-256-GCM · Нажмите для проверки кода'
                        : 'Локальный чат зашифрован на диске мастер-ключом AES-256-GCM · Нажмите для сведений'}
                    </span>
                  </button>
                </div>

                {visibleMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                    {chatMessageSearch
                      ? 'Сообщений с таким текстом не найдено.'
                      : 'Напишите первое сообщение, отправьте фото, видео, голосовую заметку или начните звонок.'}
                  </div>
                ) : (
                  visibleMessages.map((msg) => {
                    const isOwn = msg.senderId === 'me';

                    if (msg.type === MessageType.CALL_EVENT) {
                      return (
                        <div key={msg.id} className="flex justify-center py-1">
                          <div className="inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-white/90 dark:bg-[#202C33] border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-700 dark:text-slate-200 shadow-2xs">
                            {msg.callType === CallType.VIDEO ? (
                              <Video className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <Phone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            )}
                            <span className="font-mono tabular-nums">{msg.text}</span>
                            <span className="text-slate-400" aria-hidden="true">
                              ·
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                startCallWithChat(
                                  selectedChat,
                                  msg.callType || CallType.AUDIO
                                )
                              }
                              className="font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                            >
                              Перезвонить
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className={`group flex ${
                          isOwn ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`relative max-w-[85%] sm:max-w-[68%] rounded-2xl px-3.5 py-2 shadow-2xs ${
                            isOwn
                              ? 'bg-[#D9FDD3] dark:bg-[#005C4B] text-[#111B21] dark:text-[#E9EDEF] rounded-tr-sm'
                              : 'bg-white dark:bg-[#202C33] text-[#111B21] dark:text-[#E9EDEF] rounded-tl-sm'
                          }`}
                        >
                          {!isOwn && selectedChat.isGroup && (
                            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-0.5">
                              {msg.senderName}
                            </p>
                          )}

                          {msg.replyTo && (
                            <div className="mb-1.5 px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-black/20 border border-black/8 dark:border-white/10 text-xs">
                              <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                                {msg.replyTo.senderName}
                              </p>
                              <p className="truncate opacity-80">
                                {msg.replyTo.previewText}
                              </p>
                            </div>
                          )}

                          {msg.type === MessageType.IMAGE && (
                            <div className="mb-1">
                              <StoredImageView
                                mediaId={msg.mediaId}
                                previewDataUrl={msg.previewDataUrl}
                                caption={msg.text}
                                originalSize={msg.originalSize}
                                compressedSize={msg.compressedSize}
                                onOpenLightbox={(url, cap) =>
                                  setLightboxData({ url, caption: cap })
                                }
                              />
                            </div>
                          )}

                          {msg.type === MessageType.VIDEO && (
                            <div className="mb-1">
                              <StoredVideoView
                                mediaId={msg.mediaId}
                                posterDataUrl={msg.mediaPosterDataUrl}
                                compressedSize={msg.compressedSize}
                                duration={msg.mediaDuration}
                              />
                            </div>
                          )}

                          {msg.type === MessageType.VOICE && (
                            <VoiceMessagePlayer
                              mediaId={msg.mediaId}
                              remoteAudioDataUrl={msg.remoteAudioDataUrl}
                              durationSec={msg.mediaDuration}
                              waveform={msg.waveform}
                              compressedSize={msg.compressedSize}
                              isOwn={isOwn}
                            />
                          )}

                          {msg.text && (
                            <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.text}
                            </p>
                          )}

                          <div className="flex items-center justify-end gap-1 mt-1 select-none">
                            {msg.isEncrypted && (
                              <Lock
                                className="w-2.5 h-2.5 text-emerald-700/75 dark:text-emerald-300/75"
                                aria-label="Зашифровано E2EE"
                              />
                            )}
                            <span className="text-[10.5px] text-slate-500 dark:text-slate-300/75 font-mono tabular-nums">
                              {formatMessageTime(msg.timestamp)}
                            </span>
                            {isOwn &&
                              (msg.status === 'read' ? (
                                <CheckCheck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-slate-400" />
                              ))}
                          </div>

                          <div
                            className={`opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity absolute top-1 ${
                              isOwn ? '-left-16' : '-right-16'
                            } flex items-center gap-1`}
                          >
                            <button
                              type="button"
                              onClick={() => setReplyToMsg(msg)}
                              className="p-1.5 rounded-lg bg-white/90 dark:bg-[#202C33] text-slate-600 dark:text-slate-300 shadow-xs hover:text-emerald-600"
                              title="Ответить"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            {(!selectedChat.isCloudChat || isOwn) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteMessage(msg)}
                                className="p-1.5 rounded-lg bg-white/90 dark:bg-[#202C33] text-slate-600 dark:text-slate-300 shadow-xs hover:text-red-600"
                                title="Удалить сообщение"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Индикатор ответа */}
              {(replyToMsg || (sendAsContact && !selectedChat.isCloudChat)) && (
                <div className="px-4 py-2 bg-[#F0F2F5] dark:bg-[#182229] border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
                  {replyToMsg ? (
                    <div className="min-w-0">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        Ответ для {replyToMsg.senderName}:{' '}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300 truncate">
                        {replyToMsg.text || 'Медиафайл'}
                      </span>
                    </div>
                  ) : (
                    <div className="text-amber-700 dark:text-amber-400 font-medium">
                      Режим теста: сообщение от имени «{selectedChat.name}»
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setReplyToMsg(null);
                      setSendAsContact(false);
                    }}
                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label="Отменить"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Нижняя панель ввода */}
              <footer className="relative px-3 sm:px-4 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-slate-200/80 dark:border-slate-800 shrink-0 pwa-safe-bottom">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) stageFileForSending(f);
                  }}
                  className="hidden"
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) stageFileForSending(f);
                  }}
                  className="hidden"
                />

                {showEmojiPicker && (
                  <div className="absolute bottom-16 left-4 p-3 rounded-xl bg-white dark:bg-[#233138] border border-slate-200 dark:border-slate-700 shadow-xl grid grid-cols-8 gap-1.5 z-30">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setDraftText((prev) => prev + emoji)}
                        className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-lg flex items-center justify-center transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {showAttachMenu && (
                  <div className="absolute bottom-16 left-12 w-60 rounded-xl bg-white dark:bg-[#233138] border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-30 text-sm">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-[#182229] flex items-center gap-3"
                    >
                      <ImageIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Фотография (автосжатие WebP)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-[#182229] flex items-center gap-3"
                    >
                      <Film className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      <span>Видеофайл с устройства</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        setShowVideoRecorder(true);
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-[#182229] flex items-center gap-3"
                    >
                      <Camera className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Записать видео с камеры</span>
                    </button>
                  </div>
                )}

                {isRecordingVoice ? (
                  <div className="flex items-center justify-between gap-3 py-0.5">
                    <button
                      type="button"
                      onClick={() => finishVoiceRecording(true)}
                      className="p-2.5 rounded-full text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      title="Отменить запись"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>

                    <div className="flex-1 flex items-center gap-3 px-4 py-2 rounded-xl bg-white dark:bg-[#2A3942]">
                      <span className="text-xs font-semibold text-red-600 dark:text-red-400 font-mono tabular-nums">
                        Запись {formatDuration(voiceSeconds)}
                      </span>
                      <div className="flex-1 flex items-center gap-[3px] h-5">
                        {voiceBars.map((amp, i) => (
                          <div
                            key={i}
                            style={{
                              height: `${Math.max(4, Math.round(amp * 20))}px`,
                            }}
                            className="flex-1 rounded-full bg-emerald-600 dark:bg-emerald-400 transition-transform"
                          />
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => finishVoiceRecording(false)}
                      className="w-11 h-11 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shrink-0 transition-colors"
                      title="Отправить голосовое сообщение"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEmojiPicker((v) => !v);
                        setShowAttachMenu(false);
                      }}
                      className="p-2.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                      title="Смайлы"
                    >
                      <Smile className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu((v) => !v);
                        setShowEmojiPicker(false);
                      }}
                      className="p-2.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                      title="Прикрепить фото или видео"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>

                    <input
                      type="text"
                      maxLength={4000}
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendText();
                        }
                      }}
                      onPaste={(e) => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].type.startsWith('image/')) {
                            const pastedFile = items[i].getAsFile();
                            if (pastedFile) {
                              e.preventDefault();
                              stageFileForSending(pastedFile);
                              break;
                            }
                          }
                        }
                      }}
                      placeholder="Введите сообщение"
                      className="flex-1 px-4 py-2.5 rounded-xl text-sm bg-white dark:bg-[#2A3942] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />

                    {draftText.trim() ? (
                      <button
                        type="button"
                        onClick={handleSendText}
                        className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shrink-0 transition-colors"
                        title="Отправить сообщение"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startVoiceRecording}
                        className="w-10 h-10 rounded-full bg-emerald-600/15 hover:bg-emerald-600 text-emerald-700 dark:text-emerald-400 hover:text-white flex items-center justify-center shrink-0 transition-colors"
                        title="Записать голосовое сообщение"
                      >
                        <Mic className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                )}
              </footer>
            </main>
          ) : (
            <div className="hidden md:flex flex-1 flex-col items-center justify-center p-10 text-center bg-[#F0F2F5] dark:bg-[#222E35]">
              <div className="max-w-md space-y-3">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
                  WhatsApp Web · Поиск друзей и чаты
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Введите имя вашего друга в строке поиска слева, чтобы найти его аккаунт в базе и сразу начать переписку или звонок.
                </p>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSearchFocused(true);
                      searchInputRef.current?.focus();
                    }}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    Найти друга по имени
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="px-4 py-2 rounded-lg bg-white dark:bg-[#111B21] border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    Настройки и Бэкап
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Нижняя мобильная навигация */}
      {!(activeTab === 'chats' && selectedChatId) && (
        <nav className="md:hidden min-h-14 bg-white dark:bg-[#202C33] border-t border-slate-200 dark:border-slate-800 grid grid-cols-3 shrink-0 pwa-safe-bottom">
          <button
            type="button"
            onClick={() => setActiveTab('chats')}
            className={`flex flex-col items-center justify-center gap-0.5 text-xs font-medium ${
              activeTab === 'chats'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            <span>Чаты</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('calls')}
            className={`flex flex-col items-center justify-center gap-0.5 text-xs font-medium ${
              activeTab === 'calls'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <PhoneCall className="w-5 h-5" />
            <span>Звонки</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center gap-0.5 text-xs font-medium ${
              activeTab === 'settings'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span>Профиль</span>
          </button>
        </nav>
      )}

      {/* Предпросмотр перед сжатием и отправкой фото/видео */}
      {pendingMediaFile && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#202C33] border border-slate-200 dark:border-slate-700 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {pendingMediaFile.kind === 'image'
                  ? 'Отправка сжатого фото'
                  : 'Отправка видеофайла'}
              </span>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(pendingMediaFile.previewUrl);
                  setPendingMediaFile(null);
                }}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl overflow-hidden bg-black/90 max-h-72 flex items-center justify-center">
                {pendingMediaFile.kind === 'image' ? (
                  <img
                    src={pendingMediaFile.previewUrl}
                    alt="Предпросмотр"
                    className="max-h-72 object-contain"
                  />
                ) : (
                  <video
                    src={pendingMediaFile.previewUrl}
                    controls
                    className="max-h-72 object-contain"
                  />
                )}
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums flex items-center gap-2">
                <span>Исходный файл: {formatBytes(pendingMediaFile.file.size)}</span>
                {pendingMediaFile.kind === 'image' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      WebP ({settings.imageMaxDimension}px)
                    </span>
                  </>
                )}
              </div>

              <input
                type="text"
                autoFocus
                maxLength={500}
                value={pendingMediaFile.caption}
                onChange={(e) =>
                  setPendingMediaFile({
                    ...pendingMediaFile,
                    caption: e.target.value,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmSendStagedMedia();
                  }
                }}
                placeholder="Добавьте подпись (необязательно)..."
                className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-100 dark:bg-[#2A3942] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isCompressingMedia}
                  onClick={handleConfirmSendStagedMedia}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {isCompressingMedia ? 'Сжатие...' : 'Сжать и отправить'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно создания локального контакта/группы */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateNewLocalChat}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#202C33] border border-slate-200 dark:border-slate-700 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Новый локальный контакт или группа
              </h3>
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Имя собеседника или название группы
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newChatName}
                  onChange={(e) => setNewChatName(e.target.value)}
                  placeholder="Например: Мария Иванова"
                  className="w-full px-3.5 py-2 rounded-lg text-sm bg-slate-100 dark:bg-[#2A3942] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Телефон или описание
                </label>
                <input
                  type="text"
                  value={newChatPhone}
                  onChange={(e) => setNewChatPhone(e.target.value)}
                  placeholder="+7 (999) 555-12-34"
                  className="w-full px-3.5 py-2 rounded-lg text-sm bg-slate-100 dark:bg-[#2A3942] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={newChatIsGroup}
                  onChange={(e) => setNewChatIsGroup(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-600"
                />
                <span>Создать как групповой чат</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Создать чат
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Полноэкранный просмотр фотографий (Lightbox) */}
      {lightboxData && (
        <div
          onClick={() => setLightboxData(null)}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
        >
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <a
              href={lightboxData.url}
              download={`photo-${Date.now()}.webp`}
              onClick={(e) => e.stopPropagation()}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Скачать сжатое фото"
            >
              <Download className="w-5 h-5" />
            </a>
            <button
              type="button"
              onClick={() => setLightboxData(null)}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <img
            src={lightboxData.url}
            alt={lightboxData.caption || 'Просмотр фото'}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl"
          />
          {lightboxData.caption && (
            <p className="mt-4 text-sm text-white/90 max-w-xl text-center">
              {lightboxData.caption}
            </p>
          )}
        </div>
      )}

      {showVideoRecorder && (
        <VideoRecorderModal
          onClose={() => setShowVideoRecorder(false)}
          onSendVideo={handleSendRecordedVideo}
        />
      )}

      {activeCall && (
        <CallOverlay
          chat={activeCall.chat}
          initialCallType={activeCall.type}
          onEndCall={handleEndCall}
        />
      )}

      {safetyModalChat && (
        <SafetyNumberModal
          chat={safetyModalChat}
          myPublicKeyJwk={googleProfile?.publicKeyJwk}
          onClose={() => setSafetyModalChat(null)}
        />
      )}
    </div>
  );
}
