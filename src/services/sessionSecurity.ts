import { IdTokenResult, signOut, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth } from '../firebase';
import { purgeCryptoMemoryCache, uint8ToBase64 } from './cryptoE2EE';

/**
 * Модуль защиты сессий, криптографической проверки токенов Google Auth
 * и автоматического выхода при обнаружении подозрительной активности.
 */

const SS_SESSION_BINDING_KEY = 'wa_sec_session_binding_v1';
const SS_SESSION_NONCE_KEY = 'wa_sec_session_nonce_v1';
const LS_SECURITY_KILLSWITCH_KEY = 'wa_sec_killswitch_event_v1';
const MAX_AUTH_AGE_MS = 12 * 60 * 60 * 1000; // Максимальный возраст сессии без повторного подтверждения: 12 часов
const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000;

export interface TokenValidationStatus {
  valid: boolean;
  reason?: string;
  issuedAt?: string;
  expiresAt?: string;
  signInProvider?: string;
  sessionFingerprint: string;
}

// Счётчик мутаций для защиты от автоматизированного спама / XSS-инъекций
const mutationTimestamps: number[] = [];
const MAX_MUTATIONS_PER_WINDOW = 28;
const MUTATION_WINDOW_MS = 5000;

/**
 * Вычисляет криптографический отпечаток окружения браузера (SHA-256) для защиты от перехвата сессии.
 */
export async function computeSessionEnvironmentFingerprint(
  uid: string
): Promise<string> {
  let tabNonce = sessionStorage.getItem(SS_SESSION_NONCE_KEY);
  if (!tabNonce) {
    const rnd = crypto.getRandomValues(new Uint8Array(16));
    tabNonce = uint8ToBase64(rnd);
    sessionStorage.setItem(SS_SESSION_NONCE_KEY, tabNonce);
  }

  const traits = [
    uid,
    navigator.userAgent || 'ua',
    navigator.language || 'ru',
    String(window.screen?.colorDepth || 24),
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    String(navigator.hardwareConcurrency || 4),
  ].join('|');

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(traits)
  );
  return Array.from(new Uint8Array(digest).slice(0, 20))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Строгая валидация ID-токена Google Auth (провайдер, подтверждённый email, аудитория проекта, сроки жизни).
 */
export async function validateGoogleAuthSession(
  user: User,
  forceRefresh = false
): Promise<TokenValidationStatus> {
  const fingerprint = await computeSessionEnvironmentFingerprint(user.uid);

  let tokenResult: IdTokenResult;
  try {
    tokenResult = await user.getIdTokenResult(forceRefresh);
  } catch (err) {
    // В автономном режиме PWA не выбрасываем пользователя из аккаунта из-за отсутствия интернета
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      msg.includes('network-request-failed') ||
      msg.includes('offline') ||
      msg.includes('unavailable')
    ) {
      return {
        valid: true,
        signInProvider: user.providerData[0]?.providerId || 'google.com',
        sessionFingerprint: fingerprint,
      };
    }
    return {
      valid: false,
      reason: 'Не удалось подтвердить криптографическую подпись токена Google Auth.',
      sessionFingerprint: fingerprint,
    };
  }

  // 1. Проверка провайдера аутентификации
  const provider =
    tokenResult.signInProvider || user.providerData[0]?.providerId || '';
  if (provider !== 'google.com') {
    return {
      valid: false,
      reason: `Недопустимый провайдер входа (${provider || 'неизвестен'}). Разрешён только Google Auth.`,
      sessionFingerprint: fingerprint,
    };
  }

  // 2. Проверка подтверждённого email в криптографических клеймах токена
  if (!user.emailVerified || tokenResult.claims.email_verified !== true) {
    return {
      valid: false,
      reason: 'Email аккаунта Google не подтверждён (email_verified != true).',
      sessionFingerprint: fingerprint,
    };
  }

  // 3. Проверка привязки токена к текущему Firebase проекту (aud)
  const audClaim = String(tokenResult.claims.aud || '');
  if (audClaim && firebaseConfig.projectId && audClaim !== firebaseConfig.projectId) {
    return {
      valid: false,
      reason: 'Обнаружено несоответствие аудитории токена (попытка подмены токена из другого проекта).',
      sessionFingerprint: fingerprint,
    };
  }

  // 4. Проверка срока действия и времени выпуска токена
  const now = Date.now();
  const expMs = Date.parse(tokenResult.expirationTime);
  const iatMs = Date.parse(tokenResult.issuedAtTime);
  const authTimeMs = Date.parse(tokenResult.authTime);

  if (!Number.isFinite(expMs) || expMs <= now) {
    return {
      valid: false,
      reason: 'Срок действия токена безопасности истёк.',
      sessionFingerprint: fingerprint,
    };
  }

  if (Number.isFinite(iatMs) && iatMs > now + CLOCK_SKEW_TOLERANCE_MS) {
    return {
      valid: false,
      reason: 'Аномалия системного времени выпуска токена.',
      sessionFingerprint: fingerprint,
    };
  }

  if (Number.isFinite(authTimeMs) && now - authTimeMs > MAX_AUTH_AGE_MS) {
    return {
      valid: false,
      reason: 'Сессия старше 12 часов — требуется повторный вход для защиты аккаунта.',
      sessionFingerprint: fingerprint,
    };
  }

  // 5. Проверка целостности привязки сессии к окружению браузера (защита от перехвата сессии)
  const storedBinding = sessionStorage.getItem(SS_SESSION_BINDING_KEY);
  const expectedBinding = `${user.uid}:${fingerprint}`;

  if (!storedBinding) {
    sessionStorage.setItem(SS_SESSION_BINDING_KEY, expectedBinding);
  } else if (storedBinding !== expectedBinding) {
    return {
      valid: false,
      reason: 'Обнаружено изменение цифрового отпечатка сессии (подозрение на перехват сессии).',
      sessionFingerprint: fingerprint,
    };
  }

  return {
    valid: true,
    issuedAt: tokenResult.issuedAtTime,
    expiresAt: tokenResult.expirationTime,
    signInProvider: provider,
    sessionFingerprint: fingerprint,
  };
}

/**
 * Экстренное завершение сессии с очисткой ключей из памяти и оповещением всех открытых вкладок.
 */
export async function executeEmergencySecurityLogout(
  reason: string,
  onSecurityAlert?: (reason: string) => void
): Promise<void> {
  purgeCryptoMemoryCache();
  try {
    sessionStorage.removeItem(SS_SESSION_BINDING_KEY);
    sessionStorage.removeItem(SS_SESSION_NONCE_KEY);
    localStorage.setItem(
      LS_SECURITY_KILLSWITCH_KEY,
      JSON.stringify({ reason, ts: Date.now() })
    );
  } catch {
    // Игнорируем ограничения storage
  }

  try {
    await signOut(auth);
  } catch {
    // Игнорируем сетевые ошибки при принудительном выходе
  }

  if (onSecurityAlert) {
    onSecurityAlert(reason);
  }
}

/**
 * Контроль частоты операций (защита от инъекций скриптов и аномального всплеска запросов).
 * Возвращает false и вызывает экстренный выход при обнаружении атаки.
 */
export function guardAgainstSuspiciousBurst(
  onAnomalyDetected: (reason: string) => void
): boolean {
  const now = Date.now();
  while (
    mutationTimestamps.length > 0 &&
    now - mutationTimestamps[0] > MUTATION_WINDOW_MS
  ) {
    mutationTimestamps.shift();
  }
  mutationTimestamps.push(now);

  if (mutationTimestamps.length > MAX_MUTATIONS_PER_WINDOW) {
    mutationTimestamps.length = 0;
    const reason =
      'Автоматический выход: зафиксирована подозрительная частота запросов (защита от автоматизированной атаки).';
    executeEmergencySecurityLogout(reason, onAnomalyDetected);
    return false;
  }

  return true;
}

/**
 * Запускает фоновый монитор безопасности активной сессии:
 * - Таймер бездействия (автовыход при отсутствии активности пользователя)
 * - Периодическая ре-валидация токена Google Auth и отпечатка браузера
 * - Межвкладочный детектор вмешательства в хранилище и сигнала экстренного выхода
 */
export function startActiveSessionMonitor(params: {
  user: User;
  idleTimeoutMinutes: number;
  onSecurityLogout: (reason: string) => void;
}): () => void {
  const { user, idleTimeoutMinutes, onSecurityLogout } = params;
  let lastActivityMs = Date.now();
  let disposed = false;

  const markActivity = () => {
    lastActivityMs = Date.now();
  };

  const activityEvents: (keyof WindowEventMap)[] = [
    'pointerdown',
    'keydown',
    'touchstart',
    'focus',
  ];
  activityEvents.forEach((evt) =>
    window.addEventListener(evt, markActivity, { passive: true })
  );

  // Контроль межвкладочного сигнала тревоги или подмены ключей
  const handleStorageEvent = (e: StorageEvent) => {
    if (disposed) return;
    if (e.key === LS_SECURITY_KILLSWITCH_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue) as { reason?: string };
        purgeCryptoMemoryCache();
        onSecurityLogout(
          parsed.reason || 'Сессия принудительно завершена системой безопасности.'
        );
      } catch {
        onSecurityLogout('Сессия завершена в другой вкладке.');
      }
    }
  };
  window.addEventListener('storage', handleStorageEvent);

  // Проверка каждые 30 секунд: простой пользователя + валидность токена и отпечатка сессии
  const checkInterval = window.setInterval(async () => {
    if (disposed) return;

    const maxIdleMs = Math.max(1, idleTimeoutMinutes) * 60 * 1000;
    if (Date.now() - lastActivityMs > maxIdleMs) {
      disposed = true;
      await executeEmergencySecurityLogout(
        `Автоматический выход из аккаунта после ${idleTimeoutMinutes} мин. бездействия для защиты переписки.`,
        onSecurityLogout
      );
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    const status = await validateGoogleAuthSession(user, false);
    if (!status.valid) {
      disposed = true;
      await executeEmergencySecurityLogout(
        status.reason || 'Сессия признана недействительной при проверке безопасности.',
        onSecurityLogout
      );
    }
  }, 30_000);

  return () => {
    disposed = true;
    activityEvents.forEach((evt) =>
      window.removeEventListener(evt, markActivity)
    );
    window.removeEventListener('storage', handleStorageEvent);
    window.clearInterval(checkInterval);
  };
}
