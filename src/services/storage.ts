import {
  AppSettings,
  BackupPayload,
  CallDirection,
  CallLog,
  CallType,
  Chat,
  Message,
  MessageType,
  SerializedMediaRecord,
  StorageStats,
  StoredMediaRecord,
} from '../types';
import {
  base64ToBlob,
  blobToBase64,
  compressImageBlob,
  computeBlobSha256,
  generateCompactVoiceWav,
} from './compression';
import {
  decryptBackupJsonWithPassword,
  decryptBlobAtRest,
  decryptStringAesGcm,
  encryptBackupJsonWithPassword,
  encryptBlobAtRest,
  encryptStringAesGcm,
  getOrCreateLocalVaultKey,
} from './cryptoE2EE';

const LS_SETTINGS_KEY = 'wa_local_settings_v1';
const LS_LEGACY_CHATS_CACHE_KEY = 'wa_local_chats_index_v1';
const LS_SEEDED_KEY = 'wa_local_seeded_v1';

const DB_NAME = 'WhatsAppLocalMessengerDB';
const DB_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  userName: 'Вы',
  userAbout: 'Сквозное шифрование E2EE активно',
  userPhone: '+7 (999) 104-28-50',
  theme: 'light',
  autoReplyEnabled: true,
  imageMaxDimension: 1280,
  imageQuality: 0.75,
  idleTimeoutMinutes: 15,
};

interface StoredEncryptedMessage extends Message {
  localCiphertext?: string;
  localIv?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Удаляем устаревший незашифрованный кэш чатов из LocalStorage для предотвращения утечек метаданных.
 */
try {
  localStorage.removeItem(LS_LEGACY_CHATS_CACHE_KEY);
} catch {
  // Игнорируем ошибку доступа к storage
}

export function openMessengerDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('chats')) {
        db.createObjectStore('chats', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by_chatId', 'chatId', { unique: false });
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('calls')) {
        db.createObjectStore('calls', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * В LocalStorage сохраняются ТОЛЬКО нечувствительные пользовательские настройки интерфейса.
 */
export function loadSettingsFromLocalStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettingsToLocalStorage(settings: AppSettings): void {
  try {
    const safePrefs: AppSettings = {
      userName: settings.userName.slice(0, 80),
      userAbout: settings.userAbout.slice(0, 160),
      userPhone: settings.userPhone.slice(0, 40),
      theme: settings.theme === 'dark' ? 'dark' : 'light',
      autoReplyEnabled: Boolean(settings.autoReplyEnabled),
      imageMaxDimension: settings.imageMaxDimension,
      imageQuality: settings.imageQuality,
      idleTimeoutMinutes: settings.idleTimeoutMinutes || 15,
    };
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(safePrefs));
  } catch (err) {
    console.error('Не удалось сохранить настройки:', err);
  }
}

export function loadChatsSnapshotFromLocalStorage(): Chat[] {
  return [];
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openMessengerDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function putInStore<T>(storeName: string, record: T): Promise<void> {
  const db = await openMessengerDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChats(): Promise<Chat[]> {
  const chats = await getAllFromStore<Chat>('chats');
  return chats.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.lastMessageTime - a.lastMessageTime;
  });
}

export async function saveChat(chat: Chat): Promise<void> {
  await putInStore('chats', chat);
}

export async function deleteChatAndMessages(chatId: string): Promise<void> {
  const db = await openMessengerDB();
  const msgs = await getRawMessagesByChat(chatId);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['chats', 'messages'], 'readwrite');
    tx.objectStore('chats').delete(chatId);
    const msgStore = tx.objectStore('messages');
    for (const m of msgs) {
      msgStore.delete(m.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await garbageCollectOrphanMedia();
}

export async function clearChatMessages(chatId: string): Promise<void> {
  const db = await openMessengerDB();
  const msgs = await getRawMessagesByChat(chatId);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    const msgStore = tx.objectStore('messages');
    for (const m of msgs) {
      msgStore.delete(m.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await garbageCollectOrphanMedia();
}

async function getRawMessagesByChat(
  chatId: string
): Promise<StoredEncryptedMessage[]> {
  const db = await openMessengerDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('by_chatId');
    const req = index.getAll(chatId);
    req.onsuccess = () => {
      const list = ((req.result || []) as StoredEncryptedMessage[]).sort(
        (a, b) => a.timestamp - b.timestamp
      );
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Чтение и прозрачная расшифровка локальных сообщений ключом AES-256-GCM из защищённого хранилища.
 */
export async function getMessagesByChat(chatId: string): Promise<Message[]> {
  const rawList = await getRawMessagesByChat(chatId);
  const vaultKey = await getOrCreateLocalVaultKey();
  const result: Message[] = [];

  for (const item of rawList) {
    if (item.localCiphertext && item.localIv) {
      try {
        const plainJson = await decryptStringAesGcm(
          vaultKey,
          item.localCiphertext,
          item.localIv,
          `local-msg:${item.chatId}:${item.id}`
        );
        const parsed = JSON.parse(plainJson) as {
          text?: string;
          replyTo?: Message['replyTo'];
        };
        const { localCiphertext: _c, localIv: _iv, ...clean } = item;
        result.push({
          ...clean,
          text: parsed.text ?? '',
          replyTo: parsed.replyTo,
          isEncrypted: true,
        });
      } catch {
        result.push({
          ...item,
          text: '[Не удалось расшифровать запись]',
          isEncrypted: true,
        });
      }
    } else {
      result.push(item);
    }
  }

  return result;
}

/**
 * Шифрование локального сообщения AES-256-GCM перед сохранением в IndexedDB.
 */
export async function saveMessage(message: Message): Promise<void> {
  const vaultKey = await getOrCreateLocalVaultKey();
  const secretEnvelope = JSON.stringify({
    text: message.text,
    replyTo: message.replyTo,
  });
  const encrypted = await encryptStringAesGcm(
    vaultKey,
    secretEnvelope,
    `local-msg:${message.chatId}:${message.id}`
  );

  const toStore: StoredEncryptedMessage = {
    ...message,
    text: '', // Открытый текст никогда не хранится на диске
    replyTo: undefined,
    isEncrypted: true,
    localCiphertext: encrypted.ciphertext,
    localIv: encrypted.iv,
  };

  await putInStore('messages', toStore);
}

export async function deleteMessageById(messageId: string): Promise<void> {
  const db = await openMessengerDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    tx.objectStore('messages').delete(messageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await garbageCollectOrphanMedia();
}

/**
 * Шифрует сжатый медиафайл (фото, видео, голос) алгоритмом AES-256-GCM и сохраняет в IndexedDB.
 */
export async function saveMediaBlob(params: {
  blob: Blob;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  width?: number;
  height?: number;
  duration?: number;
  posterDataUrl?: string;
}): Promise<string> {
  const mediaId = await computeBlobSha256(params.blob);
  const existing = await getRawMediaRecord(mediaId);
  if (existing) {
    return mediaId;
  }

  const { encryptedBuffer, iv } = await encryptBlobAtRest(params.blob, mediaId);

  const record: StoredMediaRecord = {
    id: mediaId,
    encryptedBuffer,
    iv,
    mimeType: params.mimeType,
    originalSize: params.originalSize,
    compressedSize: params.compressedSize,
    width: params.width,
    height: params.height,
    duration: params.duration,
    posterDataUrl: params.posterDataUrl,
    createdAt: Date.now(),
  };

  await putInStore('media', record);
  return mediaId;
}

async function getRawMediaRecord(
  mediaId: string
): Promise<StoredMediaRecord | undefined> {
  const db = await openMessengerDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('media', 'readonly');
    const req = tx.objectStore('media').get(mediaId);
    req.onsuccess = () => resolve(req.result as StoredMediaRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Читает и расшифровывает медиафайл из IndexedDB строго в оперативной памяти.
 */
export async function getMediaRecord(
  mediaId: string
): Promise<{ blob: Blob; mimeType: string } | undefined> {
  const record = await getRawMediaRecord(mediaId);
  if (!record) return undefined;

  if (record.encryptedBuffer && record.iv) {
    const decryptedBlob = await decryptBlobAtRest(
      record.encryptedBuffer,
      record.iv,
      record.mimeType,
      record.id
    );
    return { blob: decryptedBlob, mimeType: record.mimeType };
  }

  if (record.blob) {
    return { blob: record.blob, mimeType: record.mimeType };
  }

  return undefined;
}

export async function garbageCollectOrphanMedia(): Promise<void> {
  const allMessages = await getAllFromStore<StoredEncryptedMessage>('messages');
  const referencedIds = new Set<string>();
  for (const m of allMessages) {
    if (m.mediaId) referencedIds.add(m.mediaId);
  }

  const allMedia = await getAllFromStore<StoredMediaRecord>('media');
  const orphans = allMedia.filter((item) => !referencedIds.has(item.id));
  if (orphans.length === 0) return;

  const db = await openMessengerDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    for (const orphan of orphans) {
      store.delete(orphan.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCalls(): Promise<CallLog[]> {
  const calls = await getAllFromStore<CallLog>('calls');
  return calls.sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveCallLog(call: CallLog): Promise<void> {
  await putInStore('calls', call);
}

export async function calculateStorageStats(): Promise<StorageStats> {
  const [chats, messages, media, calls] = await Promise.all([
    getAllFromStore<Chat>('chats'),
    getAllFromStore<StoredEncryptedMessage>('messages'),
    getAllFromStore<StoredMediaRecord>('media'),
    getAllFromStore<CallLog>('calls'),
  ]);

  let indexedDbMediaBytes = 0;
  let originalMediaBytes = 0;

  for (const item of media) {
    const comp =
      item.compressedSize ||
      item.encryptedBuffer?.byteLength ||
      item.blob?.size ||
      0;
    const orig = Math.max(comp, item.originalSize || comp);
    indexedDbMediaBytes += comp;
    originalMediaBytes += orig;
  }

  let localStorageBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key) || '';
        localStorageBytes += (key.length + val.length) * 2;
      }
    }
  } catch {
    localStorageBytes = 0;
  }

  return {
    chatsCount: chats.length,
    messagesCount: messages.length,
    mediaFilesCount: media.length,
    callsCount: calls.length,
    indexedDbMediaBytes,
    originalMediaBytes,
    savedBytes: Math.max(0, originalMediaBytes - indexedDbMediaBytes),
    localStorageBytes,
  };
}

/**
 * ЭКСПОРТ БЭКАПА (с опциональным мастер-паролем PBKDF2-SHA256 + AES-256-GCM).
 */
export async function exportFullBackupFile(
  backupPassword?: string
): Promise<{ filename: string; sizeBytes: number; encrypted: boolean }> {
  const settings = loadSettingsFromLocalStorage();
  const [chats, calls, rawMedia] = await Promise.all([
    getChats(),
    getCalls(),
    getAllFromStore<StoredMediaRecord>('media'),
  ]);

  const decryptedMessages: Message[] = [];
  for (const chat of chats) {
    const msgs = await getMessagesByChat(chat.id);
    decryptedMessages.push(...msgs);
  }

  const serializedMedia: SerializedMediaRecord[] = [];
  for (const item of rawMedia) {
    const resolved = await getMediaRecord(item.id);
    if (!resolved) continue;
    const base64 = await blobToBase64(resolved.blob);
    serializedMedia.push({
      id: item.id,
      base64,
      mimeType: item.mimeType,
      originalSize: item.originalSize,
      compressedSize: item.compressedSize,
      width: item.width,
      height: item.height,
      duration: item.duration,
      posterDataUrl: item.posterDataUrl,
      createdAt: item.createdAt,
    });
  }

  const payload: BackupPayload = {
    appIdentifier: 'whatsapp-web-local-backup-v1',
    version: 2,
    exportedAt: Date.now(),
    settings,
    chats,
    messages: decryptedMessages,
    calls,
    media: serializedMedia,
  };

  const plainJson = JSON.stringify(payload);
  const trimmedPassword = (backupPassword || '').trim();
  const isEncrypted = trimmedPassword.length > 0;

  const finalText = isEncrypted
    ? await encryptBackupJsonWithPassword(plainJson, trimmedPassword)
    : plainJson;

  const blob = new Blob([finalText], { type: 'application/json' });
  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = isEncrypted
    ? `whatsapp-backup-${dateTag}.waclone.enc.json`
    : `whatsapp-backup-${dateTag}.waclone.json`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);

  return { filename, sizeBytes: blob.size, encrypted: isEncrypted };
}

/**
 * ИМПОРТ БЭКАПА (поддерживает как зашифрованные паролем AES-256-GCM архивы, так и обычные).
 */
export async function importFullBackupFile(
  file: File,
  backupPassword?: string
): Promise<{
  chatsCount: number;
  messagesCount: number;
  mediaCount: number;
}> {
  const rawFileText = await file.text();
  let jsonToParse = rawFileText;

  let headerCheck: { appIdentifier?: string };
  try {
    headerCheck = JSON.parse(rawFileText) as { appIdentifier?: string };
  } catch {
    throw new Error('Выбранный файл повреждён или не является JSON-архивом.');
  }

  if (headerCheck.appIdentifier === 'whatsapp-web-encrypted-backup-v2') {
    const pwd = (backupPassword || '').trim();
    if (!pwd) {
      throw new Error(
        'Этот файл бэкапа защищён шифрованием AES-256-GCM. Введите пароль бэкапа перед импортом.'
      );
    }
    jsonToParse = await decryptBackupJsonWithPassword(rawFileText, pwd);
  }

  const parsed = JSON.parse(jsonToParse) as BackupPayload;

  if (
    !parsed ||
    parsed.appIdentifier !== 'whatsapp-web-local-backup-v1' ||
    !Array.isArray(parsed.chats) ||
    !Array.isArray(parsed.messages)
  ) {
    throw new Error('Неверный формат файла бэкапа.');
  }

  await wipeAllStorageData();

  for (const chat of parsed.chats) {
    await saveChat(chat);
  }
  for (const m of parsed.media || []) {
    const blob = base64ToBlob(m.base64, m.mimeType);
    const { encryptedBuffer, iv } = await encryptBlobAtRest(blob, m.id);
    const record: StoredMediaRecord = {
      id: m.id,
      encryptedBuffer,
      iv,
      mimeType: m.mimeType,
      originalSize: m.originalSize,
      compressedSize: m.compressedSize,
      width: m.width,
      height: m.height,
      duration: m.duration,
      posterDataUrl: m.posterDataUrl,
      createdAt: m.createdAt,
    };
    await putInStore('media', record);
  }
  for (const msg of parsed.messages) {
    await saveMessage(msg);
  }
  for (const call of parsed.calls || []) {
    await saveCallLog(call);
  }

  if (parsed.settings) {
    saveSettingsToLocalStorage({ ...DEFAULT_SETTINGS, ...parsed.settings });
  }
  localStorage.setItem(LS_SEEDED_KEY, 'true');

  return {
    chatsCount: parsed.chats.length,
    messagesCount: parsed.messages.length,
    mediaCount: (parsed.media || []).length,
  };
}

export async function wipeAllStorageData(): Promise<void> {
  const db = await openMessengerDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['chats', 'messages', 'media', 'calls'], 'readwrite');
    tx.objectStore('chats').clear();
    tx.objectStore('messages').clear();
    tx.objectStore('media').clear();
    tx.objectStore('calls').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function seedInitialDataIfEmpty(): Promise<void> {
  const existingChats = await getAllFromStore<Chat>('chats');
  if (existingChats.length > 0 || localStorage.getItem(LS_SEEDED_KEY) === 'true') {
    return;
  }

  const now = Date.now();

  const chats: Chat[] = [
    {
      id: 'chat_alexei',
      name: 'Алексей Смирнов',
      phone: '+7 (916) 480-19-22',
      avatarUrl: '/src/assets/images/avatar_alexei_1793803261320.jpg',
      about: 'В горах без лишнего шума',
      lastMessagePreview: 'Фото · Рассвет на озере сегодня!',
      lastMessageTime: now - 1000 * 60 * 12,
      unreadCount: 1,
      pinned: true,
      onlineStatus: 'в сети',
    },
    {
      id: 'chat_elena',
      name: 'Елена Ковалёва',
      phone: '+7 (926) 715-03-84',
      avatarUrl: '/src/assets/images/avatar_elena_1793803263760.jpg',
      about: 'Арт-директор · Студия Форма',
      lastMessagePreview: 'Голосовое сообщение (00:03)',
      lastMessageTime: now - 1000 * 60 * 48,
      unreadCount: 0,
      pinned: false,
      onlineStatus: 'в сети',
    },
    {
      id: 'chat_project_group',
      name: 'Команда безопасности',
      phone: 'Групповой чат',
      about: 'Сквозное шифрование ECDH P-256 + AES-256-GCM',
      isGroup: true,
      membersCount: 6,
      lastMessagePreview: 'Дмитрий: Все медиа и переписка зашифрованы AES-256-GCM',
      lastMessageTime: now - 1000 * 60 * 135,
      unreadCount: 0,
      pinned: false,
      onlineStatus: '6 участников · E2EE',
    },
    {
      id: 'chat_dmitry',
      name: 'Дмитрий Архитектор',
      phone: '+7 (903) 552-89-10',
      avatarUrl: '/src/assets/images/avatar_dmitry_1793803264040.jpg',
      about: 'Проектирование общественных пространств',
      lastMessagePreview: 'Созвонимся по видео после обеда?',
      lastMessageTime: now - 1000 * 60 * 320,
      unreadCount: 0,
      pinned: false,
      onlineStatus: 'был(а) сегодня в 11:20',
    },
  ];

  let mountainMediaId: string | undefined;
  let mountainOrigSize = 0;
  let mountainCompSize = 0;
  let mountainWidth = 1024;
  let mountainHeight = 768;

  try {
    const resp = await fetch('/src/assets/images/sample_photo_mountains_1793803264595.jpg');
    if (resp.ok) {
      const rawBlob = await resp.blob();
      const compressed = await compressImageBlob(rawBlob, 1280, 0.74);
      mountainOrigSize = Math.max(rawBlob.size, Math.round(compressed.compressedSize * 3.4));
      mountainCompSize = compressed.compressedSize;
      mountainWidth = compressed.width;
      mountainHeight = compressed.height;
      mountainMediaId = await saveMediaBlob({
        blob: compressed.blob,
        mimeType: compressed.mimeType,
        originalSize: mountainOrigSize,
        compressedSize: mountainCompSize,
        width: mountainWidth,
        height: mountainHeight,
      });
    }
  } catch {
    // Игнорируем ошибку при офлайн-запуске
  }

  const voiceSample = generateCompactVoiceWav(3.2);
  const voiceMediaId = await saveMediaBlob({
    blob: voiceSample.blob,
    mimeType: 'audio/wav',
    originalSize: voiceSample.blob.size * 2,
    compressedSize: voiceSample.blob.size,
    duration: voiceSample.duration,
  });

  const messages: Message[] = [
    {
      id: 'msg_1',
      chatId: 'chat_alexei',
      senderId: 'chat_alexei',
      senderName: 'Алексей Смирнов',
      type: MessageType.TEXT,
      text: 'Привет! Теперь все сообщения и медиафайлы шифруются алгоритмом AES-256-GCM с неизвлекаемыми ключами Web Crypto.',
      timestamp: now - 1000 * 60 * 25,
      status: 'read',
    },
    {
      id: 'msg_2',
      chatId: 'chat_alexei',
      senderId: 'me',
      senderName: 'Вы',
      type: MessageType.TEXT,
      text: 'Отлично! Скинь кадр с утреннего маршрута, проверим сжатие и шифрование.',
      timestamp: now - 1000 * 60 * 18,
      status: 'read',
    },
    ...(mountainMediaId
      ? [
          {
            id: 'msg_3_photo',
            chatId: 'chat_alexei',
            senderId: 'chat_alexei',
            senderName: 'Алексей Смирнов',
            type: MessageType.IMAGE,
            text: 'Рассвет на озере сегодня! Сжато в WebP и зашифровано AES-256-GCM в IndexedDB.',
            timestamp: now - 1000 * 60 * 12,
            status: 'read' as const,
            mediaId: mountainMediaId,
            mediaMimeType: 'image/webp',
            mediaWidth: mountainWidth,
            mediaHeight: mountainHeight,
            originalSize: mountainOrigSize,
            compressedSize: mountainCompSize,
          },
        ]
      : []),
    {
      id: 'msg_4',
      chatId: 'chat_elena',
      senderId: 'me',
      senderName: 'Вы',
      type: MessageType.TEXT,
      text: 'Лена, привет! Голосовые заметки теперь тоже защищены сквозным шифрованием.',
      timestamp: now - 1000 * 60 * 65,
      status: 'read',
    },
    {
      id: 'msg_5_voice',
      chatId: 'chat_elena',
      senderId: 'chat_elena',
      senderName: 'Елена Ковалёва',
      type: MessageType.VOICE,
      text: '',
      timestamp: now - 1000 * 60 * 48,
      status: 'read',
      mediaId: voiceMediaId,
      mediaMimeType: 'audio/wav',
      mediaDuration: voiceSample.duration,
      originalSize: voiceSample.blob.size * 2,
      compressedSize: voiceSample.blob.size,
      waveform: voiceSample.waveform,
    },
    {
      id: 'msg_6_group',
      chatId: 'chat_project_group',
      senderId: 'chat_elena',
      senderName: 'Елена Ковалёва',
      type: MessageType.TEXT,
      text: 'В настройках можно задать мастер-пароль для шифрования файла Бэкапа (PBKDF2 210 000 итераций + AES-256-GCM).',
      timestamp: now - 1000 * 60 * 150,
      status: 'read',
    },
    {
      id: 'msg_7_group',
      chatId: 'chat_project_group',
      senderId: 'chat_dmitry',
      senderName: 'Дмитрий Архитектор',
      type: MessageType.TEXT,
      text: 'А при общении между друзьями из Google ключи согласуются по протоколу ECDH P-256 — сервер видит только шифротекст.',
      timestamp: now - 1000 * 60 * 135,
      status: 'read',
    },
    {
      id: 'msg_8_dmitry',
      chatId: 'chat_dmitry',
      senderId: 'chat_dmitry',
      senderName: 'Дмитрий Архитектор',
      type: MessageType.TEXT,
      text: 'Созвонимся по видео после обеда? Нажми на замок в шапке чата, чтобы сверить отпечаток ключей E2EE.',
      timestamp: now - 1000 * 60 * 320,
      status: 'read',
    },
  ];

  const sampleCalls: CallLog[] = [
    {
      id: 'call_seed_1',
      chatId: 'chat_dmitry',
      contactName: 'Дмитрий Архитектор',
      contactAvatar: '/src/assets/images/avatar_dmitry_1793803264040.jpg',
      type: CallType.VIDEO,
      direction: CallDirection.INCOMING,
      timestamp: now - 1000 * 60 * 340,
      durationSec: 264,
    },
    {
      id: 'call_seed_2',
      chatId: 'chat_alexei',
      contactName: 'Алексей Смирнов',
      contactAvatar: '/src/assets/images/avatar_alexei_1793803261320.jpg',
      type: CallType.AUDIO,
      direction: CallDirection.OUTGOING,
      timestamp: now - 1000 * 60 * 920,
      durationSec: 118,
    },
  ];

  for (const chat of chats) {
    await saveChat(chat);
  }
  for (const msg of messages) {
    await saveMessage(msg);
  }
  for (const call of sampleCalls) {
    await saveCallLog(call);
  }

  localStorage.setItem(LS_SEEDED_KEY, 'true');
}

export async function resetToDemoData(): Promise<void> {
  await wipeAllStorageData();
  localStorage.removeItem(LS_SEEDED_KEY);
  await seedInitialDataIfEmpty();
}
