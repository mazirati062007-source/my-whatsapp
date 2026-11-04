export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  VOICE = 'voice',
  CALL_EVENT = 'call_event',
}

export enum CallType {
  AUDIO = 'audio',
  VIDEO = 'video',
}

export enum CallDirection {
  OUTGOING = 'outgoing',
  INCOMING = 'incoming',
}

export interface PublicUserProfile {
  uid: string;
  displayName: string;
  searchName: string;
  photoURL: string;
  about: string;
  onlineStatus: string;
  visibility: 'discoverable' | 'hidden';
  publicKeyJwk?: string;
  keyFingerprint?: string;
}

export interface Chat {
  id: string;
  name: string;
  phone: string;
  avatarUrl?: string;
  about: string;
  isGroup?: boolean;
  membersCount?: number;
  lastMessagePreview: string;
  lastMessageTime: number;
  unreadCount: number;
  pinned?: boolean;
  onlineStatus: string;
  // Поля облачного E2EE-чата между Google-пользователями
  isCloudChat?: boolean;
  peerUid?: string;
  participantOneId?: string;
  participantTwoId?: string;
  myPubKeyJwk?: string;
  peerPubKeyJwk?: string;
  e2eeReady?: boolean;
  activeCallType?: 'none' | 'audio' | 'video';
  activeCallStatus?: 'idle' | 'ringing' | 'connected' | 'ended';
  activeCallInitiatorId?: string;
}

export interface MessageReplyRef {
  id: string;
  senderName: string;
  previewText: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: 'me' | string;
  senderName: string;
  type: MessageType;
  text: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'read';
  isEncrypted?: boolean;
  mediaId?: string;
  mediaMimeType?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaDuration?: number;
  mediaPosterDataUrl?: string;
  previewDataUrl?: string;
  remoteAudioDataUrl?: string;
  originalSize?: number;
  compressedSize?: number;
  waveform?: number[];
  replyTo?: MessageReplyRef;
  callType?: CallType;
  callDurationSec?: number;
}

export interface StoredMediaRecord {
  id: string;
  // Зашифрованное хранилище AES-256-GCM на диске (с обратной совместимостью для старых Blob)
  encryptedBuffer?: ArrayBuffer;
  iv?: Uint8Array;
  blob?: Blob;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  width?: number;
  height?: number;
  duration?: number;
  posterDataUrl?: string;
  createdAt: number;
}

export interface CallLog {
  id: string;
  chatId: string;
  contactName: string;
  contactAvatar?: string;
  type: CallType;
  direction: CallDirection;
  timestamp: number;
  durationSec: number;
  missed?: boolean;
}

export interface AppSettings {
  userName: string;
  userAbout: string;
  userPhone: string;
  theme: 'light' | 'dark';
  autoReplyEnabled: boolean;
  imageMaxDimension: number;
  imageQuality: number;
  idleTimeoutMinutes: number;
}

export interface StorageStats {
  chatsCount: number;
  messagesCount: number;
  mediaFilesCount: number;
  callsCount: number;
  indexedDbMediaBytes: number;
  originalMediaBytes: number;
  savedBytes: number;
  localStorageBytes: number;
}

export interface SerializedMediaRecord {
  id: string;
  base64: string;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  width?: number;
  height?: number;
  duration?: number;
  posterDataUrl?: string;
  createdAt: number;
}

export interface BackupPayload {
  appIdentifier: 'whatsapp-web-local-backup-v1';
  version: number;
  exportedAt: number;
  settings: AppSettings;
  chats: Chat[];
  messages: Message[];
  calls: CallLog[];
  media: SerializedMediaRecord[];
}
