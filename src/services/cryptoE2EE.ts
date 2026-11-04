/**
 * Криптографическое ядро сквозного шифрования (End-to-End Encryption, E2EE)
 * и шифрования локального хранилища на базе стандартов Web Crypto API:
 * - Обмен ключами: ECDH на эллиптической кривой NIST P-256 (приватный ключ non-extractable в IndexedDB)
 * - Деривация сессионных ключей чата: HKDF-SHA256 с привязкой к ID диалога
 * - Аутентифицированное шифрование сообщений, голосовых заметок и медиа: AES-256-GCM (96-бит IV + AAD + 128-бит Auth Tag)
 * - Защита резервных копий паролем: PBKDF2-SHA256 (210 000 итераций) + AES-256-GCM
 */

const VAULT_DB_NAME = 'WhatsAppCryptoVaultDB';
const VAULT_DB_VERSION = 1;
const KEY_STORE = 'crypto_keys';
const LOCAL_MASTER_KEY_ID = 'local_vault_aes_master_v1';

interface StoredIdentityKeyRecord {
  id: string;
  privateKey: CryptoKey; // extractable: false — невозможно выгрузить сырые байты даже при XSS
  publicKeyJwk: string;
  fingerprint: string;
  createdAt: number;
}

interface StoredSymmetricKeyRecord {
  id: string;
  key: CryptoKey; // extractable: false
  createdAt: number;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
}

export interface PasswordEncryptedBackupEnvelope {
  appIdentifier: 'whatsapp-web-encrypted-backup-v2';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  exportedAt: number;
}

let vaultDbPromise: Promise<IDBDatabase> | null = null;
const derivedSharedKeyCache = new Map<string, CryptoKey>();
let localVaultKeyMemoryCache: CryptoKey | null = null;

function openCryptoVaultDB(): Promise<IDBDatabase> {
  if (vaultDbPromise) return vaultDbPromise;

  vaultDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      vaultDbPromise = null;
      reject(req.error);
    };
  });

  return vaultDbPromise;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Очищает все производные сессионные ключи из оперативной памяти при выходе или тревоге безопасности.
 */
export function purgeCryptoMemoryCache(): void {
  derivedSharedKeyCache.clear();
  localVaultKeyMemoryCache = null;
}

/**
 * Вычисляет отпечаток публичного ключа (SHA-256) для визуальной сверки.
 */
export async function computePublicKeyFingerprint(pubKeyJwkStr: string): Promise<string> {
  const encoded = new TextEncoder().encode(pubKeyJwkStr.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/**
 * Вычисляет 60-значный «Код безопасности» (Safety Number в стиле WhatsApp) для пары ключей собеседников.
 */
export async function computeConversationSafetyNumber(
  pubKeyA?: string,
  pubKeyB?: string
): Promise<string | null> {
  if (!pubKeyA || !pubKeyB) return null;
  const sorted = [pubKeyA.trim(), pubKeyB.trim()].sort().join('||');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sorted)
  );
  const view = new DataView(digest);
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const offset = (i * 2) % 28;
    const num = view.getUint32(offset, false) % 100000;
    groups.push(num.toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

/**
 * Получает или создаёт неизвлекаемую пару ключей ECDH P-256 для конкретного UID пользователя.
 */
export async function getOrCreateUserE2EEIdentity(uid: string): Promise<{
  privateKey: CryptoKey;
  publicKeyJwk: string;
  fingerprint: string;
}> {
  const db = await openCryptoVaultDB();
  const recordId = `ecdh_identity_${uid}`;

  const existing = await new Promise<StoredIdentityKeyRecord | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const req = tx.objectStore(KEY_STORE).get(recordId);
      req.onsuccess = () =>
        resolve(req.result as StoredIdentityKeyRecord | undefined);
      req.onerror = () => reject(req.error);
    }
  );

  if (existing && existing.privateKey && existing.publicKeyJwk) {
    return {
      privateKey: existing.privateKey,
      publicKeyJwk: existing.publicKeyJwk,
      fingerprint: existing.fingerprint,
    };
  }

  // Генерируем пару ECDH P-256. Публичный ключ экспортируем в JWK, затем пересоздаём приватный как non-extractable!
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // extractable: false для приватного ключа (публичный ключ в WebCrypto всегда можно экспортировать!)
    ['deriveBits']
  );

  const exportedPubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const compactPubJwk = JSON.stringify({
    kty: exportedPubJwk.kty,
    crv: exportedPubJwk.crv,
    x: exportedPubJwk.x,
    y: exportedPubJwk.y,
  });

  const fingerprint = await computePublicKeyFingerprint(compactPubJwk);

  const toStore: StoredIdentityKeyRecord = {
    id: recordId,
    privateKey: keyPair.privateKey,
    publicKeyJwk: compactPubJwk,
    fingerprint,
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).put(toStore);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return {
    privateKey: keyPair.privateKey,
    publicKeyJwk: compactPubJwk,
    fingerprint,
  };
}

/**
 * Выводит общий симметричный ключ AES-256-GCM для диалога по протоколу ECDH + HKDF-SHA256.
 */
export async function deriveSharedConversationAesKey(
  myUid: string,
  peerPublicKeyJwkStr: string,
  conversationId: string
): Promise<CryptoKey> {
  const cacheKey = `${myUid}:${conversationId}:${peerPublicKeyJwkStr}`;
  const cached = derivedSharedKeyCache.get(cacheKey);
  if (cached) return cached;

  const { privateKey } = await getOrCreateUserE2EEIdentity(myUid);
  const parsedJwk = JSON.parse(peerPublicKeyJwkStr) as JsonWebKey;

  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    { ...parsedJwk, ext: true },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  );

  const hkdfBaseKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );

  const encoder = new TextEncoder();
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(`wa-e2ee-salt:${conversationId}`),
      info: encoder.encode('whatsapp-web-e2ee-aes256gcm-v1'),
    },
    hkdfBaseKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable сессионный ключ!
    ['encrypt', 'decrypt']
  );

  derivedSharedKeyCache.set(cacheKey, aesKey);
  return aesKey;
}

/**
 * Шифрует строку UTF-8 с помощью AES-256-GCM и дополнительными аутентифицируемыми данными (AAD).
 */
export async function encryptStringAesGcm(
  key: CryptoKey,
  plaintext: string,
  aadContext: string
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);
  const additionalData = new TextEncoder().encode(aadContext);

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData,
      tagLength: 128,
    },
    key,
    encodedText
  );

  return {
    ciphertext: uint8ToBase64(new Uint8Array(cipherBuffer)),
    iv: uint8ToBase64(iv),
  };
}

/**
 * Расшифровывает строку UTF-8 с проверкой тега подлинности AES-256-GCM и AAD.
 */
export async function decryptStringAesGcm(
  key: CryptoKey,
  ciphertextBase64: string,
  ivBase64: string,
  aadContext: string
): Promise<string> {
  const iv = base64ToUint8(ivBase64);
  const cipherBytes = base64ToUint8(ciphertextBase64);
  const additionalData = new TextEncoder().encode(aadContext);

  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData,
      tagLength: 128,
    },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * Получает или создаёт локальный неизвлекаемый мастер-ключ AES-256-GCM для шифрования IndexedDB на диске.
 */
export async function getOrCreateLocalVaultKey(): Promise<CryptoKey> {
  if (localVaultKeyMemoryCache) return localVaultKeyMemoryCache;

  const db = await openCryptoVaultDB();
  const existing = await new Promise<StoredSymmetricKeyRecord | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const req = tx.objectStore(KEY_STORE).get(LOCAL_MASTER_KEY_ID);
      req.onsuccess = () =>
        resolve(req.result as StoredSymmetricKeyRecord | undefined);
      req.onerror = () => reject(req.error);
    }
  );

  if (existing?.key) {
    localVaultKeyMemoryCache = existing.key;
    return existing.key;
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false
    ['encrypt', 'decrypt']
  );

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).put({
      id: LOCAL_MASTER_KEY_ID,
      key,
      createdAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  localVaultKeyMemoryCache = key;
  return key;
}

/**
 * Шифрует бинарный медиафайл (фото, видео, голосовое сообщение) перед сохранением в IndexedDB.
 */
export async function encryptBlobAtRest(
  blob: Blob,
  aadId: string
): Promise<{ encryptedBuffer: ArrayBuffer; iv: Uint8Array }> {
  const key = await getOrCreateLocalVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawBuffer = await blob.arrayBuffer();
  const additionalData = new TextEncoder().encode(`local-media:${aadId}`);

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    rawBuffer
  );

  return { encryptedBuffer, iv };
}

/**
 * Расшифровывает бинарный медиафайл из IndexedDB строго в оперативной памяти.
 */
export async function decryptBlobAtRest(
  encryptedBuffer: ArrayBuffer,
  iv: Uint8Array,
  mimeType: string,
  aadId: string
): Promise<Blob> {
  const key = await getOrCreateLocalVaultKey();
  const additionalData = new TextEncoder().encode(`local-media:${aadId}`);

  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(iv),
      additionalData,
      tagLength: 128,
    },
    key,
    encryptedBuffer
  );

  return new Blob([plainBuffer], { type: mimeType });
}

/**
 * Шифрование полного файла Бэкапа мастер-паролем через PBKDF2-SHA256 (210 000 итераций) + AES-256-GCM.
 */
export async function encryptBackupJsonWithPassword(
  plainJson: string,
  password: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 210_000;

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const aad = new TextEncoder().encode('whatsapp-web-encrypted-backup-v2');
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    aesKey,
    new TextEncoder().encode(plainJson)
  );

  const envelope: PasswordEncryptedBackupEnvelope = {
    appIdentifier: 'whatsapp-web-encrypted-backup-v2',
    kdf: 'PBKDF2-SHA256',
    iterations,
    cipher: 'AES-256-GCM',
    saltBase64: uint8ToBase64(salt),
    ivBase64: uint8ToBase64(iv),
    ciphertextBase64: uint8ToBase64(new Uint8Array(cipherBuffer)),
    exportedAt: Date.now(),
  };

  return JSON.stringify(envelope);
}

/**
 * Расшифровка защищённого паролем файла Бэкапа.
 */
export async function decryptBackupJsonWithPassword(
  envelopeJson: string,
  password: string
): Promise<string> {
  const parsed = JSON.parse(envelopeJson) as PasswordEncryptedBackupEnvelope;
  if (parsed.appIdentifier !== 'whatsapp-web-encrypted-backup-v2') {
    throw new Error('Неверный заголовок зашифрованного архива');
  }

  const salt = base64ToUint8(parsed.saltBase64);
  const iv = base64ToUint8(parsed.ivBase64);
  const cipherBytes = base64ToUint8(parsed.ciphertextBase64);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: parsed.iterations || 210_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const aad = new TextEncoder().encode('whatsapp-web-encrypted-backup-v2');
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      aesKey,
      cipherBytes
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    throw new Error('Неверный пароль расшифровки или файл бэкапа повреждён.');
  }
}
