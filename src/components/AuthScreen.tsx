import React, { useState } from 'react';
import {
  AlertTriangle,
  KeyRound,
  Lock,
  LogIn,
  MessageSquare,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallPrompt';

interface AuthScreenProps {
  securityAlertReason?: string | null;
  onGoogleLogin: () => Promise<void>;
  onContinueLocal: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  securityAlertReason,
  onGoogleLogin,
  onContinueLocal,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await onGoogleLogin();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Не удалось выполнить вход через Google';
      if (msg.includes('popup-closed-by-user')) {
        setErrorMsg('Окно авторизации Google было закрыто до завершения входа.');
      } else if (msg.includes('popup-blocked')) {
        setErrorMsg(
          'Браузер заблокировал всплывающее окно входа. Разрешите всплывающие окна и повторите попытку.'
        );
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#F0F2F5] dark:bg-[#0B141A] text-[#111B21] dark:text-[#E9EDEF] flex flex-col overflow-y-auto">
      <div className="h-52 bg-[#00A884] dark:bg-[#005C4B] shrink-0 px-6 pt-8">
        <div className="max-w-4xl mx-auto flex items-center gap-3 text-white">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <MessageSquare className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight whitespace-nowrap">
            WhatsApp Web · End-to-End Encrypted
          </span>
        </div>
      </div>

      <div className="flex-1 px-4 pb-12 -mt-28 flex items-start justify-center">
        <div className="w-full max-w-4xl rounded-2xl bg-white dark:bg-[#111B21] border border-slate-200 dark:border-slate-800 shadow-xl p-8 sm:p-12 space-y-6">
          {securityAlertReason && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  Сессия автоматически завершена системой защиты
                </p>
                <p className="mt-0.5 opacity-90">{securityAlertReason}</p>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-7 space-y-5">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
                Защищённый мессенджер со сквозным шифрованием E2EE
              </h1>

              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Войдите через аккаунт Google. В вашем браузере автоматически создаётся неизвлекаемая пара ключей ECDH P-256: тексты, голосовые заметки и медиафайлы шифруются алгоритмом AES-256-GCM так, что прочитать их могут только участники диалога.
              </p>

              <div className="space-y-3 pt-1 text-sm text-slate-700 dark:text-slate-300">
                <div className="flex items-center gap-3">
                  <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    Сквозное шифрование ECDH P-256 + HKDF-SHA256 + AES-256-GCM
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Search className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    Поиск друзей по имени и сверка 60-значного кода безопасности
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    Проверка токенов Google Auth, привязка сессии и автовыход при угрозах
                  </span>
                </div>
              </div>
            </div>

            <div className="md:col-span-5 rounded-xl bg-[#F8FAFC] dark:bg-[#182229] border border-slate-200/80 dark:border-slate-800 p-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Вход через Google Auth
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Строгая валидация криптографической подписи токена
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-xs text-red-700 dark:text-red-300">
                  {errorMsg}
                </div>
              )}

              <button
                type="button"
                disabled={loading}
                onClick={handleSignIn}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap shrink-0 shadow-xs"
              >
                <LogIn className="w-4 h-4" />
                <span>
                  {loading ? 'Проверка токена Google...' : 'Войти через Google'}
                </span>
              </button>

              <PWAInstallButton variant="full" />

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-center">
                <button
                  type="button"
                  onClick={onContinueLocal}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                >
                  Открыть автономное зашифрованное хранилище
                </button>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 pt-1">
                <Lock className="w-3 h-3" />
                <span>Приватные ключи изолированы (extractable: false)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
