import { signInWithPopup, signOut, User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  CallType,
  Chat,
  Message,
  MessageType,
  PublicUserProfile,
} from '../types';
import { blobToBase64 } from './compression';
import {
  decryptStringAesGcm,
  deriveSharedConversationAesKey,
  encryptStringAesGcm,
  getOrCreateUserE2EEIdentity,
  purgeCryptoMemoryCache,
} from './cryptoE2EE';
import { validateGoogleAuthSession } from './sessionSecurity';

const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const MAX_ID_LEN = 128;
const MAX_NAME_LEN = 80;
const MAX_PHOTO_LEN = 1024;
const MAX_ABOUT_LEN = 160;
const MAX_STATUS_LEN = 60;
const MAX_PUBKEY_LEN = 512;
const MAX_FINGERPRINT_LEN = 96;
const MAX_CIPHERTEXT_LEN = 16000;
const MAX_MEDIA_CIPHERTEXT_LEN = 95000;

interface DecryptedMessageEnvelope {
  text: string;
  replyToSender?: string;
  replyToPreview?: string;
  waveform?: number[];
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, MAX_ID_LEN);
  return cleaned.length > 0 && ID_PATTERN.test(cleaned)
    ? cleaned
    : 'id_fallback';
}

function clampString(
  val: string | null | undefined,
  max: number,
  fallback = ''
): string {
  const str = (val ?? '').trim();
  if (!str) return fallback.slice(0, max);
  return str.slice(0, max);
}

/**
 * Генерирует компактное превью изображения для последующего сквозного шифрования AES-256-GCM.
 */
export async function createCompactRemoteThumbnail(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Ошибка чтения превью'));
      el.src = url;
    });

    const maxSide = 340;
    let w = img.naturalWidth || 300;
    let h = img.naturalHeight || 220;
    if (w > maxSide || h > maxSide) {
      if (w >= h) {
        h = Math.round((h * maxSide) / w);
        w = maxSide;
      } else {
        w = Math.round((w * maxSide) / h);
        h = maxSide;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, w, h);

    let dataUrl = canvas.toDataURL('image/webp', 0.6);
    if (dataUrl.length > 52000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.42);
    }
    return dataUrl.length <= 58000 ? dataUrl : '';
  } catch {
    return '';
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Кодирует компактное голосовое сообщение в DataURL (<= 65 КБ) для E2EE передачи собеседнику.
 */
export async function encodeCompactVoiceDataUrl(blob: Blob): Promise<string> {
  if (blob.size > 48 * 1024) return '';
  try {
    const b64 = await blobToBase64(blob);
    const dataUrl = `data:${blob.type || 'audio/webm'};base64,${b64}`;
    return dataUrl.length <= 66000 ? dataUrl : '';
  } catch {
    return '';
  }
}

/**
 * Вход через Google с немедленной валидацией токена, генерацией ключей E2EE ECDH P-256
 * и привязкой сессии к окружению браузера.
 */
export async function signInWithGoogleAndRegister(): Promise<PublicUserProfile> {
  const credential = await signInWithPopup(auth, googleProvider);
  const validation = await validateGoogleAuthSession(credential.user, true);
  if (!validation.valid) {
    await signOut(auth);
    throw new Error(
      validation.reason || 'Проверка безопасности токена Google не пройдена.'
    );
  }
  return registerOrSyncGoogleUser(credential.user);
}

export async function signOutFromGoogle(): Promise<void> {
  purgeCryptoMemoryCache();
  await signOut(auth);
}

/**
 * Регистрирует/обновляет публичный профиль с ключом E2EE ECDH P-256 и изолированный PII документ.
 */
export async function registerOrSyncGoogleUser(
  user: User,
  customAbout?: string,
  customDisplayName?: string
): Promise<PublicUserProfile> {
  const tokenCheck = await validateGoogleAuthSession(user, false);
  if (!tokenCheck.valid) {
    throw new Error(tokenCheck.reason || 'Сессия недействительна');
  }

  const uid = sanitizeId(user.uid);
  const e2eeIdentity = await getOrCreateUserE2EEIdentity(uid);
  const publicKeyJwk = clampString(e2eeIdentity.publicKeyJwk, MAX_PUBKEY_LEN, '');
  const keyFingerprint = clampString(
    e2eeIdentity.fingerprint,
    MAX_FINGERPRINT_LEN,
    ''
  );

  const fallbackName = user.email ? user.email.split('@')[0] : 'Пользователь';
  const displayName = clampString(
    customDisplayName || user.displayName,
    MAX_NAME_LEN,
    fallbackName
  );
  const searchName = clampString(displayName.toLowerCase(), MAX_NAME_LEN, 'user');
  const photoURL = clampString(user.photoURL, MAX_PHOTO_LEN, '');
  const about = clampString(
    customAbout,
    MAX_ABOUT_LEN,
    'Защищённый профиль · E2EE'
  );
  const onlineStatus = clampString('в сети · E2EE', MAX_STATUS_LEN, 'в сети');

  const publicPath = `publicProfiles/${uid}`;
  const publicRef = doc(db, 'publicProfiles', uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(publicRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, publicPath);
  }

  if (!existingSnap.exists()) {
    try {
      await setDoc(publicRef, {
        uid,
        displayName,
        searchName,
        photoURL,
        about,
        onlineStatus,
        visibility: 'discoverable',
        publicKeyJwk,
        keyFingerprint,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, publicPath);
    }
  } else {
    const prev = existingSnap.data();
    const resolvedName = customDisplayName
      ? displayName
      : clampString(prev.displayName || displayName, MAX_NAME_LEN, displayName);
    const resolvedAbout = customAbout
      ? about
      : clampString(prev.about || about, MAX_ABOUT_LEN, about);

    try {
      await updateDoc(publicRef, {
        displayName: resolvedName,
        searchName: clampString(resolvedName.toLowerCase(), MAX_NAME_LEN, 'user'),
        photoURL: photoURL || clampString(prev.photoURL, MAX_PHOTO_LEN, ''),
        about: resolvedAbout,
        onlineStatus: 'в сети · E2EE',
        visibility: prev.visibility === 'hidden' ? 'hidden' : 'discoverable',
        publicKeyJwk,
        keyFingerprint,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, publicPath);
    }
  }

  // Сохранение изолированного email и отпечатка сессии в /userPrivate/{uid}
  if (user.email && user.email.length >= 3 && user.emailVerified) {
    const privatePath = `userPrivate/${uid}`;
    const privateRef = doc(db, 'userPrivate', uid);
    try {
      const privSnap = await getDoc(privateRef);
      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid,
          email: user.email.slice(0, 254),
          sessionFingerprint: tokenCheck.sessionFingerprint.slice(0, 128),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email: user.email.slice(0, 254),
          sessionFingerprint: tokenCheck.sessionFingerprint.slice(0, 128),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, privatePath);
    }
  }

  const finalSnap = await getDoc(publicRef);
  const d = finalSnap.data();
  return {
    uid,
    displayName: d?.displayName || displayName,
    searchName: d?.searchName || searchName,
    photoURL: d?.photoURL || photoURL,
    about: d?.about || about,
    onlineStatus: d?.onlineStatus || onlineStatus,
    visibility: d?.visibility === 'hidden' ? 'hidden' : 'discoverable',
    publicKeyJwk: d?.publicKeyJwk || publicKeyJwk,
    keyFingerprint: d?.keyFingerprint || keyFingerprint,
  };
}

/**
 * Загружает свежий публичный ключ E2EE собеседника из /publicProfiles/{peerUid}.
 */
export async function fetchUserPublicProfile(
  peerUid: string
): Promise<PublicUserProfile | null> {
  const cleanId = sanitizeId(peerUid);
  const path = `publicProfiles/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, 'publicProfiles', cleanId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: String(d.uid),
      displayName: String(d.displayName || 'Пользователь'),
      searchName: String(d.searchName || ''),
      photoURL: String(d.photoURL || ''),
      about: String(d.about || ''),
      onlineStatus: String(d.onlineStatus || 'в сети'),
      visibility: d.visibility === 'hidden' ? 'hidden' : 'discoverable',
      publicKeyJwk: d.publicKeyJwk ? String(d.publicKeyJwk) : undefined,
      keyFingerprint: d.keyFingerprint ? String(d.keyFingerprint) : undefined,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function searchUsersInDatabase(
  queryText: string,
  currentUid: string
): Promise<PublicUserProfile[]> {
  const path = 'publicProfiles';
  const normalizedQuery = queryText.trim().toLowerCase();

  try {
    const q = query(
      collection(db, 'publicProfiles'),
      where('visibility', '==', 'discoverable'),
      limit(50)
    );
    const snap = await getDocs(q);
    const results: PublicUserProfile[] = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data || data.uid === currentUid) return;

      const nameLower = String(
        data.searchName || data.displayName || ''
      ).toLowerCase();
      if (!normalizedQuery || nameLower.includes(normalizedQuery)) {
        results.push({
          uid: data.uid,
          displayName: data.displayName,
          searchName: data.searchName,
          photoURL: data.photoURL || '',
          about: data.about || 'На связи',
          onlineStatus: data.onlineStatus || 'в сети',
          visibility: 'discoverable',
          publicKeyJwk: data.publicKeyJwk ? String(data.publicKeyJwk) : undefined,
          keyFingerprint: data.keyFingerprint
            ? String(data.keyFingerprint)
            : undefined,
        });
      }
    });

    return results;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function buildDirectConversationId(uidA: string, uidB: string): string {
  const [first, second] = [sanitizeId(uidA), sanitizeId(uidB)].sort();
  return sanitizeId(`dm_${first.slice(0, 56)}_${second.slice(0, 56)}`);
}

async function mapAndDecryptConversationDoc(
  data: Record<string, unknown>,
  currentUid: string
): Promise<Chat> {
  const convId = String(data.id);
  const p1 = String(data.participantOneId || '');
  const p2 = String(data.participantTwoId || '');
  const isP1 = p1 === currentUid;
  const peerUid = isP1 ? p2 : p1;
  const peerName = String(
    isP1 ? data.participantTwoName : data.participantOneName || 'Собеседник'
  );
  const peerPhoto = String(
    isP1 ? data.participantTwoPhoto : data.participantOnePhoto || ''
  );

  const p1Key = data.participantOnePubKey
    ? String(data.participantOnePubKey)
    : '';
  const p2Key = data.participantTwoPubKey
    ? String(data.participantTwoPubKey)
    : '';
  const myPubKeyJwk = isP1 ? p1Key : p2Key;
  let peerPubKeyJwk = isP1 ? p2Key : p1Key;

  if (!peerPubKeyJwk && peerUid) {
    const freshPeer = await fetchUserPublicProfile(peerUid).catch(() => null);
    if (freshPeer?.publicKeyJwk) {
      peerPubKeyJwk = freshPeer.publicKeyJwk;
    }
  }

  let preview = String(data.lastMessagePreview || 'Зашифрованный диалог');
  const lastCipher = data.lastMessageCiphertext
    ? String(data.lastMessageCiphertext)
    : '';
  const lastIv = data.lastMessageIv ? String(data.lastMessageIv) : '';

  if (lastCipher && lastIv && peerPubKeyJwk) {
    try {
      const aesKey = await deriveSharedConversationAesKey(
        currentUid,
        peerPubKeyJwk,
        convId
      );
      preview = await decryptStringAesGcm(
        aesKey,
        lastCipher,
        lastIv,
        `conv-preview:${convId}`
      );
    } catch {
      preview = 'Зашифрованное сообщение (E2EE)';
    }
  }

  return {
    id: convId,
    name: peerName,
    phone: 'Защищённый аккаунт Google · E2EE',
    avatarUrl: peerPhoto || undefined,
    about: 'Сквозное шифрование ECDH P-256 + AES-256-GCM',
    lastMessagePreview: preview,
    lastMessageTime: Number(data.lastMessageTimeMs || Date.now()),
    unreadCount: 0,
    pinned: false,
    onlineStatus: peerPubKeyJwk ? 'в сети · E2EE активен' : 'в сети · ожидание ключа E2EE',
    isCloudChat: true,
    peerUid,
    participantOneId: p1,
    participantTwoId: p2,
    myPubKeyJwk: myPubKeyJwk || undefined,
    peerPubKeyJwk: peerPubKeyJwk || undefined,
    e2eeReady: Boolean(peerPubKeyJwk),
    activeCallType: (data.activeCallType as Chat['activeCallType']) || 'none',
    activeCallStatus:
      (data.activeCallStatus as Chat['activeCallStatus']) || 'idle',
    activeCallInitiatorId: String(data.activeCallInitiatorId || ''),
  };
}

/**
 * Открывает или создаёт защищённый сквозным шифрованием диалог с другом.
 */
export async function openOrCreateFriendChat(
  me: PublicUserProfile,
  friend: PublicUserProfile
): Promise<Chat> {
  const convId = buildDirectConversationId(me.uid, friend.uid);
  const path = `conversations/${convId}`;
  const convRef = doc(db, 'conversations', convId);

  const myIdentity = await getOrCreateUserE2EEIdentity(me.uid);
  const freshFriend = (await fetchUserPublicProfile(friend.uid)) || friend;

  const meWithKey: PublicUserProfile = {
    ...me,
    publicKeyJwk: myIdentity.publicKeyJwk,
  };

  const [firstProfile, secondProfile] =
    meWithKey.uid < freshFriend.uid
      ? [meWithKey, freshFriend]
      : [freshFriend, meWithKey];

  let existing;
  try {
    existing = await getDoc(convRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (existing.exists()) {
    const d = existing.data() as Record<string, unknown>;
    // Синхронизируем публичные ключи участников, если они ещё не записаны в документ диалога
    const needUpdateKeys =
      (!d.participantOnePubKey && firstProfile.publicKeyJwk) ||
      (!d.participantTwoPubKey && secondProfile.publicKeyJwk);

    if (needUpdateKeys) {
      await updateDoc(convRef, {
        participantOnePubKey: clampString(
          firstProfile.publicKeyJwk || String(d.participantOnePubKey || ''),
          MAX_PUBKEY_LEN,
          ''
        ),
        participantTwoPubKey: clampString(
          secondProfile.publicKeyJwk || String(d.participantTwoPubKey || ''),
          MAX_PUBKEY_LEN,
          ''
        ),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      const reloaded = await getDoc(convRef);
      return mapAndDecryptConversationDoc(
        reloaded.data() as Record<string, unknown>,
        me.uid
      );
    }

    return mapAndDecryptConversationDoc(d, me.uid);
  }

  const nowMs = Date.now();
  const payload = {
    id: convId,
    participantOneId: sanitizeId(firstProfile.uid),
    participantTwoId: sanitizeId(secondProfile.uid),
    participantOneName: clampString(
      firstProfile.displayName,
      MAX_NAME_LEN,
      'Пользователь'
    ),
    participantOnePhoto: clampString(firstProfile.photoURL, MAX_PHOTO_LEN, ''),
    participantTwoName: clampString(
      secondProfile.displayName,
      MAX_NAME_LEN,
      'Пользователь'
    ),
    participantTwoPhoto: clampString(secondProfile.photoURL, MAX_PHOTO_LEN, ''),
    participantOnePubKey: clampString(
      firstProfile.publicKeyJwk,
      MAX_PUBKEY_LEN,
      ''
    ),
    participantTwoPubKey: clampString(
      secondProfile.publicKeyJwk,
      MAX_PUBKEY_LEN,
      ''
    ),
    lastMessagePreview: 'Зашифрованный чат создан',
    lastMessageCiphertext: '',
    lastMessageIv: '',
    lastMessageTimeMs: nowMs,
    activeCallType: 'none' as const,
    activeCallStatus: 'idle' as const,
    activeCallInitiatorId: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(convRef, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  return mapAndDecryptConversationDoc(payload, me.uid);
}

/**
 * Подписка на список облачных чатов с автоматической расшифровкой превью сообщений.
 */
export function subscribeToCloudConversations(
  currentUid: string,
  onUpdate: (cloudChats: Chat[]) => void
): Unsubscribe {
  const rawDocsOne = new Map<string, Record<string, unknown>>();
  const rawDocsTwo = new Map<string, Record<string, unknown>>();

  const emitMerged = async () => {
    const combined = new Map<string, Record<string, unknown>>([
      ...rawDocsOne,
      ...rawDocsTwo,
    ]);
    const decryptedList = await Promise.all(
      Array.from(combined.values()).map((d) =>
        mapAndDecryptConversationDoc(d, currentUid)
      )
    );
    decryptedList.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    onUpdate(decryptedList);
  };

  const q1 = query(
    collection(db, 'conversations'),
    where('participantOneId', '==', currentUid)
  );
  const q2 = query(
    collection(db, 'conversations'),
    where('participantTwoId', '==', currentUid)
  );

  const unsub1 = onSnapshot(
    q1,
    (snap) => {
      rawDocsOne.clear();
      snap.forEach((d) =>
        rawDocsOne.set(d.id, d.data() as Record<string, unknown>)
      );
      emitMerged();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
  );

  const unsub2 = onSnapshot(
    q2,
    (snap) => {
      rawDocsTwo.clear();
      snap.forEach((d) =>
        rawDocsTwo.set(d.id, d.data() as Record<string, unknown>)
      );
      emitMerged();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
  );

  return () => {
    unsub1();
    unsub2();
  };
}

/**
 * Подписка на сообщения внутри чата с полной клиентской расшифровкой E2EE (текст, цитаты, фото-превью и голосовые заметки).
 */
export function subscribeToCloudMessages(
  chat: Chat,
  currentUid: string,
  onUpdate: (msgs: Message[]) => void
): Unsubscribe {
  const convId = chat.id;
  const isP1 = chat.participantOneId === currentUid;
  const fieldToMatch = isP1 ? 'participantOneId' : 'participantTwoId';
  const path = `conversations/${convId}/messages`;

  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    where(fieldToMatch, '==', currentUid)
  );

  return onSnapshot(
    q,
    async (snap) => {
      const list: Message[] = [];

      for (const docSnap of snap.docs) {
        const d = docSnap.data();
        const isMine = d.senderId === currentUid;

        if (!isMine && d.status !== 'read') {
          updateDoc(doc(db, 'conversations', convId, 'messages', docSnap.id), {
            status: 'read',
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }

        const msgId = String(d.id || docSnap.id);
        const senderUid = String(d.senderId || '');
        const msgType = (d.type as MessageType) || MessageType.TEXT;
        const isEnc = Boolean(d.isEncrypted);

        let plainText = String(d.text || '');
        let replySender = d.replyToSender ? String(d.replyToSender) : '';
        let replyPreview = d.replyToPreview ? String(d.replyToPreview) : '';
        let waveform: number[] | undefined;
        let decryptedMediaUrl = d.previewDataUrl
          ? String(d.previewDataUrl)
          : '';

        if (isEnc && d.e2eeCiphertext && d.e2eeIv) {
          // Для расшифровки берём публичный ключ второй стороны (если сообщение моё — recipientPubKey, если от собеседника — senderPubKey)
          const peerPubKey = isMine
            ? String(d.recipientPubKey || chat.peerPubKeyJwk || '')
            : String(d.senderPubKey || chat.peerPubKeyJwk || '');

          if (peerPubKey) {
            try {
              const aesKey = await deriveSharedConversationAesKey(
                currentUid,
                peerPubKey,
                convId
              );
              const envJson = await decryptStringAesGcm(
                aesKey,
                String(d.e2eeCiphertext),
                String(d.e2eeIv),
                `msg:${convId}:${msgId}:${senderUid}`
              );
              const parsedEnv = JSON.parse(envJson) as DecryptedMessageEnvelope;
              plainText = parsedEnv.text || '';
              replySender = parsedEnv.replyToSender || '';
              replyPreview = parsedEnv.replyToPreview || '';
              waveform = parsedEnv.waveform;

              // Расшифровка медиа-полезной нагрузки (превью фото/видео или голосовая заметка)
              if (d.e2eeMediaCiphertext && d.e2eeMediaIv) {
                decryptedMediaUrl = await decryptStringAesGcm(
                  aesKey,
                  String(d.e2eeMediaCiphertext),
                  String(d.e2eeMediaIv),
                  `media:${convId}:${msgId}:${senderUid}`
                );
              }
            } catch {
              plainText = '[Ошибка проверки ключа сквозного шифрования E2EE]';
            }
          } else {
            plainText = '[Ожидание публичного ключа собеседника для расшифровки]';
          }
        }

        list.push({
          id: msgId,
          chatId: convId,
          senderId: isMine ? 'me' : senderUid,
          senderName: String(d.senderName || 'Собеседник'),
          type: msgType,
          text: plainText,
          isEncrypted: isEnc,
          timestamp: Number(d.timestampMs || Date.now()),
          status: (d.status as Message['status']) || 'sent',
          mediaId: d.mediaId ? String(d.mediaId) : undefined,
          mediaMimeType: d.mediaMimeType ? String(d.mediaMimeType) : undefined,
          previewDataUrl:
            msgType === MessageType.IMAGE || msgType === MessageType.VIDEO
              ? decryptedMediaUrl || undefined
              : undefined,
          mediaPosterDataUrl:
            msgType === MessageType.VIDEO
              ? decryptedMediaUrl || undefined
              : undefined,
          remoteAudioDataUrl:
            msgType === MessageType.VOICE
              ? decryptedMediaUrl || undefined
              : undefined,
          compressedSize: Number(d.compressedSize || 0) || undefined,
          originalSize: Number(d.originalSize || 0) || undefined,
          mediaDuration: Number(d.mediaDuration || 0) || undefined,
          waveform,
          callType:
            d.callType === 'video'
              ? CallType.VIDEO
              : d.callType === 'audio'
              ? CallType.AUDIO
              : undefined,
          callDurationSec: Number(d.callDurationSec || 0) || undefined,
          replyTo: replySender
            ? {
                id: 'reply',
                senderName: replySender,
                previewText: replyPreview,
              }
            : undefined,
        });
      }

      list.sort((a, b) => a.timestamp - b.timestamp);
      onUpdate(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

/**
 * Отправка сообщения со сквозным шифрованием E2EE (ECDH P-256 + HKDF + AES-256-GCM).
 * Ни текст, ни цитаты, ни голосовые заметки, ни превью фотографий не попадают в Firestore в открытом виде!
 */
export async function sendCloudChatMessage(params: {
  chat: Chat;
  currentUser: PublicUserProfile;
  type: MessageType;
  text: string;
  previewLabel: string;
  mediaId?: string;
  mediaMimeType?: string;
  rawRemoteMediaDataUrl?: string;
  waveform?: number[];
  compressedSize?: number;
  originalSize?: number;
  mediaDuration?: number;
  callType?: CallType;
  callDurationSec?: number;
  replyToSender?: string;
  replyToPreview?: string;
}): Promise<void> {
  const { chat, currentUser } = params;
  if (!chat.participantOneId || !chat.participantTwoId) return;

  const nowMs = Date.now();
  const msgId = sanitizeId(
    `m_${nowMs}_${Math.random().toString(36).slice(2, 8)}`
  );
  const msgPath = `conversations/${chat.id}/messages/${msgId}`;
  const convPath = `conversations/${chat.id}`;

  const myIdentity = await getOrCreateUserE2EEIdentity(currentUser.uid);
  let peerPubKey = chat.peerPubKeyJwk || '';
  if (!peerPubKey && chat.peerUid) {
    const freshPeer = await fetchUserPublicProfile(chat.peerUid);
    peerPubKey = freshPeer?.publicKeyJwk || '';
  }

  if (!peerPubKey) {
    throw new Error(
      'Собеседник ещё не опубликовал ключ сквозного шифрования E2EE. Попросите друга открыть приложение.'
    );
  }

  const aesKey = await deriveSharedConversationAesKey(
    currentUser.uid,
    peerPubKey,
    chat.id
  );

  // 1. Шифруем конверт текста, цитаты и аудиоволны
  const envelope: DecryptedMessageEnvelope = {
    text: clampString(params.text, 3800, ''),
    replyToSender: clampString(params.replyToSender, 80, ''),
    replyToPreview: clampString(params.replyToPreview, 180, ''),
    waveform: params.waveform,
  };

  const encryptedEnvelope = await encryptStringAesGcm(
    aesKey,
    JSON.stringify(envelope),
    `msg:${chat.id}:${msgId}:${currentUser.uid}`
  );

  if (encryptedEnvelope.ciphertext.length > MAX_CIPHERTEXT_LEN) {
    throw new Error('Размер зашифрованного сообщения превышает допустимый лимит.');
  }

  // 2. Шифруем медиа-превью или голосовое сообщение AES-256-GCM
  let e2eeMediaCiphertext = '';
  let e2eeMediaIv = '';
  if (params.rawRemoteMediaDataUrl) {
    const encMedia = await encryptStringAesGcm(
      aesKey,
      params.rawRemoteMediaDataUrl,
      `media:${chat.id}:${msgId}:${currentUser.uid}`
    );
    if (encMedia.ciphertext.length <= MAX_MEDIA_CIPHERTEXT_LEN) {
      e2eeMediaCiphertext = encMedia.ciphertext;
      e2eeMediaIv = encMedia.iv;
    }
  }

  // 3. Шифруем превью последнего сообщения для списка чатов
  const encPreview = await encryptStringAesGcm(
    aesKey,
    clampString(params.previewLabel, 180, 'Сообщение'),
    `conv-preview:${chat.id}`
  );

  const msgPayload = {
    id: msgId,
    conversationId: sanitizeId(chat.id),
    participantOneId: sanitizeId(chat.participantOneId),
    participantTwoId: sanitizeId(chat.participantTwoId),
    senderId: sanitizeId(currentUser.uid),
    senderName: clampString(
      currentUser.displayName,
      MAX_NAME_LEN,
      'Пользователь'
    ),
    type: params.type,
    text: '[Зашифровано E2EE]', // Открытый текст никогда не передаётся в Firestore
    isEncrypted: true,
    e2eeCiphertext: encryptedEnvelope.ciphertext,
    e2eeIv: encryptedEnvelope.iv,
    e2eeMediaCiphertext,
    e2eeMediaIv,
    senderPubKey: clampString(myIdentity.publicKeyJwk, MAX_PUBKEY_LEN, ''),
    recipientPubKey: clampString(peerPubKey, MAX_PUBKEY_LEN, ''),
    timestampMs: nowMs,
    status: 'sent' as const,
    mediaId: clampString(params.mediaId, MAX_ID_LEN, ''),
    mediaMimeType: clampString(params.mediaMimeType, 80, ''),
    previewDataUrl: '', // Незашифрованные превью отключены
    compressedSize: Math.max(0, Math.round(params.compressedSize || 0)),
    originalSize: Math.max(0, Math.round(params.originalSize || 0)),
    mediaDuration: Math.max(0, Math.round(params.mediaDuration || 0)),
    callType:
      params.callType === CallType.VIDEO
        ? ('video' as const)
        : params.callType === CallType.AUDIO
        ? ('audio' as const)
        : ('none' as const),
    callDurationSec: Math.max(0, Math.round(params.callDurationSec || 0)),
    replyToSender: '',
    replyToPreview: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(
      doc(db, 'conversations', chat.id, 'messages', msgId),
      msgPayload
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, msgPath);
  }

  const isP1 = chat.participantOneId === currentUser.uid;
  try {
    await updateDoc(doc(db, 'conversations', chat.id), {
      lastMessagePreview: 'Зашифрованное сообщение',
      lastMessageCiphertext: encPreview.ciphertext,
      lastMessageIv: encPreview.iv,
      lastMessageTimeMs: nowMs,
      ...(isP1
        ? {
            participantOnePubKey: clampString(
              myIdentity.publicKeyJwk,
              MAX_PUBKEY_LEN,
              ''
            ),
            participantTwoPubKey: clampString(peerPubKey, MAX_PUBKEY_LEN, ''),
          }
        : {
            participantOnePubKey: clampString(peerPubKey, MAX_PUBKEY_LEN, ''),
            participantTwoPubKey: clampString(
              myIdentity.publicKeyJwk,
              MAX_PUBKEY_LEN,
              ''
            ),
          }),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, convPath);
  }
}

export async function deleteCloudChatMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  const path = `conversations/${conversationId}/messages/${messageId}`;
  try {
    await deleteDoc(
      doc(db, 'conversations', conversationId, 'messages', messageId)
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function updateCloudCallSignaling(params: {
  conversationId: string;
  activeCallType: 'none' | 'audio' | 'video';
  activeCallStatus: 'idle' | 'ringing' | 'connected' | 'ended';
  activeCallInitiatorId: string;
}): Promise<void> {
  const path = `conversations/${params.conversationId}`;
  try {
    await updateDoc(doc(db, 'conversations', params.conversationId), {
      activeCallType: params.activeCallType,
      activeCallStatus: params.activeCallStatus,
      activeCallInitiatorId: clampString(
        params.activeCallInitiatorId,
        MAX_ID_LEN,
        ''
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
