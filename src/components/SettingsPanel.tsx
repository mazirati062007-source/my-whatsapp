import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { AppSettings, PublicUserProfile, StorageStats } from '../types';
import {
  calculateStorageStats,
  exportFullBackupFile,
  importFullBackupFile,
} from '../services/storage';
import { formatBytes } from '../services/compression';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Avatar } from './Avatar';
import { PWAInstallButton } from './PWAInstallPrompt';

interface SettingsPanelProps {
  settings: AppSettings;
  googleProfile: PublicUserProfile | null;
  googleEmail?: string | null;
  onGoogleLogin: () => Promise<void>;
  onGoogleLogout: () => Promise<void>;
  onEmergencyLockdown: () => Promise<void>;
  onSaveProfileToCloud: (displayName: string, about: string) => Promise<void>;
  onUpdateSettings: (next: AppSettings) => void;
  onBackupImported: () => Promise<void>;
  onResetDemo: () => Promise<void>;
  onClearAll: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  googleProfile,
  googleEmail,
  onGoogleLogin,
  onGoogleLogout,
  onEmergencyLockdown,
  onSaveProfileToCloud,
  onUpdateSettings,
  onBackupImported,
  onResetDemo,
  onClearAll,
  onNotify,
}) => {
  const { isInstalled, swReady } = usePWAInstall();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [busyAction, setBusyAction] = useState<
    'export' | 'import' | 'profile' | null
  >(null);
  const [confirmMode, setConfirmMode] = useState<'none' | 'reset' | 'wipe'>(
    'none'
  );
  const [backupPassword, setBackupPassword] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStats = async () => {
    const res = await calculateStorageStats();
    setStats(res);
  };

  useEffect(() => {
    refreshStats();
  }, []);

  const handleExportBackup = async () => {
    setBusyAction('export');
    try {
      const { filename, sizeBytes, encrypted } =
        await exportFullBackupFile(backupPassword);
      onNotify(
        `${
          encrypted ? 'Зашифрованный AES-256 бэкап' : 'Бэкап'
        } сохранён: ${filename} (${formatBytes(sizeBytes)})`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Ошибка при создании бэкапа'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusyAction('import');
    try {
      const result = await importFullBackupFile(file, backupPassword);
      await onBackupImported();
      await refreshStats();
      onNotify(
        `Бэкап восстановлен: ${result.chatsCount} чатов, ${result.messagesCount} сообщений, ${result.mediaCount} медиа`
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Не удалось импортировать файл бэкапа'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncCloudProfile = async () => {
    if (!googleProfile) return;
    setBusyAction('profile');
    try {
      await onSaveProfileToCloud(settings.userName, settings.userAbout);
      onNotify('Имя и ключи E2EE синхронизированы в базе');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Ошибка обновления профиля'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const savedPercent =
    stats && stats.originalMediaBytes > 0
      ? Math.round((stats.savedBytes / stats.originalMediaBytes) * 100)
      : 0;

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111B21]">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Безопасность E2EE, Приложение PWA и Бэкап
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Сквозное шифрование ECDH P-256 + AES-256-GCM, установка на телефон (PWA) и зашифрованное хранилище IndexedDB.
          </p>
        </div>

        {/* БЛОК PWA: Установка на телефон как отдельное мобильное приложение */}
        <section className="rounded-xl border border-emerald-600/25 dark:border-emerald-500/25 bg-emerald-50/40 dark:bg-[#182229] p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <img
                src="/pwa-192x192.png"
                alt="Иконка мобильного приложения"
                className="w-12 h-12 rounded-xl shadow-xs shrink-0"
              />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Мобильное приложение (PWA)
                </h2>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  <span>manifest.json</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {swReady
                      ? 'Service Worker активен (офлайн-кэш готов)'
                      : 'Service Worker подключён'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {isInstalled ? (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-white dark:bg-[#202C33] border border-emerald-600/20 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
              <Smartphone className="w-4 h-4 shrink-0" />
              <span>
                Приложение установлено на устройство и работает как отдельная программа с рабочего стола (Standalone).
              </span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Установите мессенджер на рабочий стол телефона (Android или iPhone) или компьютера — он будет открываться на весь экран без адресной строки браузера и работать даже при слабой сети.
              </p>
              <PWAInstallButton variant="full" />
            </div>
          )}

          <div className="pt-3 border-t border-emerald-600/15 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Полный исходный код проекта + иконки, manifest.json и Service Worker
            </span>
            <a
              href="/whatsapp-pwa-source.zip"
              download="whatsapp-pwa-source.zip"
              className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#202C33] hover:bg-slate-100 dark:hover:bg-[#2A3942] border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Скачать код (.zip)</span>
            </a>
          </div>
        </section>

        {/* БЛОК 0: Аккаунт Google + Криптографический центр защиты сессий */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#182229] p-6 space-y-5">
          {googleProfile ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <Avatar
                    name={googleProfile.displayName}
                    src={googleProfile.photoURL}
                    size="lg"
                  />
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {googleProfile.displayName}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {googleEmail && <span>{googleEmail}</span>}
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Токен Google Auth проверен
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onGoogleLogout}
                    className="px-3.5 py-2 rounded-lg bg-white dark:bg-[#202C33] hover:bg-slate-100 dark:hover:bg-[#2A3942] border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Выйти</span>
                  </button>
                </div>
              </div>

              {googleProfile.keyFingerprint && (
                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <KeyRound className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Отпечаток вашего публичного ключа ECDH P-256</span>
                  </div>
                  <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400 break-all">
                    {googleProfile.keyFingerprint}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Подключите аккаунт Google
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Активирует поиск друзей по имени и обмен ключами сквозного шифрования ECDH P-256.
                </p>
              </div>
              <button
                type="button"
                onClick={onGoogleLogin}
                className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-4 h-4" />
                <span>Войти через Google</span>
              </button>
            </div>
          )}

          {/* Настройки защиты сессии и автовыхода */}
          <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Защита от перехвата сессии и автовыход при бездействии
              </h3>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-600 dark:text-slate-300">
                  Таймер автоматического выхода
                </label>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#202C33] border border-slate-200/70 dark:border-slate-700">
                  {[5, 15, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...settings,
                          idleTimeoutMinutes: mins,
                        })
                      }
                      className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                        (settings.idleTimeoutMinutes || 15) === mins
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {mins} мин
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={onEmergencyLockdown}
                className="py-2 px-3.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Экстренный выход во всех вкладках</span>
              </button>
            </div>
          </div>
        </section>

        {/* БЛОК 1: Зашифрованный паролем Бэкап в один файл */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#182229] p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Защищённая резервная копия («Бэкап» в один файл)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Укажите мастер-пароль для шифрования архива по стандарту <span className="font-mono">PBKDF2-SHA256 (210 000 итераций) + AES-256-GCM</span>.
            </p>
          </div>

          <div className="max-w-md">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Мастер-пароль шифрования / расшифровки бэкапа
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                placeholder="Оставьте пустым для обычного JSON или задайте пароль..."
                className="w-full pl-10 pr-3.5 py-2 rounded-lg text-sm bg-white dark:bg-[#202C33] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleExportBackup}
              className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>
                {busyAction === 'export'
                  ? 'Шифрование и упаковка...'
                  : backupPassword.trim()
                  ? 'Скачать зашифрованный Бэкап (AES-256)'
                  : 'Бэкап: Скачать все данные'}
              </span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportFile}
              className="hidden"
            />

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 rounded-lg bg-white dark:bg-[#202C33] hover:bg-slate-100 dark:hover:bg-[#2A3942] border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                {busyAction === 'import'
                  ? 'Расшифровка и импорт...'
                  : 'Импортировать бэкап из файла'}
              </span>
            </button>
          </div>
        </section>

        {/* БЛОК 2: Статистика зашифрованного локального хранилища */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Зашифрованное хранилище IndexedDB и экономия места
              </h2>
            </div>
            <button
              type="button"
              onClick={refreshStats}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Обновить</span>
            </button>
          </div>

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
              <div className="space-y-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  IndexedDB (AES-256)
                </p>
                <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatBytes(stats.indexedDbMediaBytes)}
                </p>
                <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {stats.mediaFilesCount} зашифр. медиа
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  LocalStorage (без утечек)
                </p>
                <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatBytes(stats.localStorageBytes)}
                </p>
                <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                  Только настройки UI
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Сэкономлено сжатием
                </p>
                <p className="text-lg font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatBytes(stats.savedBytes)}
                </p>
                <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {savedPercent > 0
                    ? `−${savedPercent}% от исходников`
                    : 'WebP + SHA-256 дедуп.'}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Сообщения и звонки
                </p>
                <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {stats.messagesCount} / {stats.callsCount}
                </p>
                <p className="text-[11px] text-slate-500">Зашифрованы на диске</p>
              </div>
            </div>
          )}
        </section>

        {/* БЛОК 3: Параметры автоматического сжатия медиафайлов */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Параметры сжатия файлов перед шифрованием
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Максимальное разрешение фото (WebP)
              </label>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#202C33]">
                {[960, 1280, 1920].map((dim) => (
                  <button
                    key={dim}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ ...settings, imageMaxDimension: dim })
                    }
                    className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-medium font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                      settings.imageMaxDimension === dim
                        ? 'bg-white dark:bg-[#2A3942] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {dim}px
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Степень сжатия изображений
              </label>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#202C33]">
                {[
                  { label: 'Эконом 60%', val: 0.6 },
                  { label: 'Баланс 75%', val: 0.75 },
                  { label: 'Чёткое 88%', val: 0.88 },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ ...settings, imageQuality: opt.val })
                    }
                    className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      Math.abs(settings.imageQuality - opt.val) < 0.02
                        ? 'bg-white dark:bg-[#2A3942] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* БЛОК 4: Профиль, Тема оформления и Автоответы */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Профиль для поиска друзей и интерфейс
            </h2>
            {googleProfile && (
              <button
                type="button"
                disabled={busyAction === 'profile'}
                onClick={handleSyncCloudProfile}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                {busyAction === 'profile'
                  ? 'Сохранение...'
                  : 'Сохранить имя в базе'}
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Ваше имя (по нему вас находят друзья)
              </label>
              <input
                type="text"
                maxLength={80}
                value={settings.userName}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, userName: e.target.value })
                }
                className="w-full px-3.5 py-2 rounded-lg text-sm bg-slate-100 dark:bg-[#202C33] text-slate-900 dark:text-slate-100 border border-transparent focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Статус («Сведения»)
              </label>
              <input
                type="text"
                maxLength={160}
                value={settings.userAbout}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, userAbout: e.target.value })
                }
                className="w-full px-3.5 py-2 rounded-lg text-sm bg-slate-100 dark:bg-[#202C33] text-slate-900 dark:text-slate-100 border border-transparent focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Тема оформления
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Переключение светлой и тёмной палитры WhatsApp Web
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#202C33]">
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ ...settings, theme: 'light' })
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  settings.theme === 'light'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Светлая</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ ...settings, theme: 'dark' })}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  settings.theme === 'dark'
                    ? 'bg-[#2A3942] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Тёмная</span>
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Автоответ для локальных демо-контактов
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                В облачных E2EE-чатах с друзьями автоответ не используется
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoReplyEnabled}
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  autoReplyEnabled: !settings.autoReplyEnabled,
                })
              }
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                settings.autoReplyEnabled
                  ? 'bg-emerald-600'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                  settings.autoReplyEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </section>

        {/* БЛОК 5: Очистка зашифрованного кэша */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Управление локальной базой данных
          </h2>

          {confirmMode === 'none' ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirmMode('reset')}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-[#202C33] hover:bg-slate-200 dark:hover:bg-[#2A3942] text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Восстановить локальные демо-чаты</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmMode('wipe')}
                className="px-3.5 py-2 rounded-lg text-xs font-medium bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 text-red-700 dark:text-red-400 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Очистить зашифрованное хранилище</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60">
              <span className="text-xs text-amber-900 dark:text-amber-200">
                {confirmMode === 'wipe'
                  ? 'Безвозвратно удалить локальные зашифрованные чаты и медиафайлы из IndexedDB?'
                  : 'Сбросить локальную базу и пересоздать стартовые демо-чаты?'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmMode('none')}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const mode = confirmMode;
                    setConfirmMode('none');
                    if (mode === 'wipe') {
                      await onClearAll();
                    } else {
                      await onResetDemo();
                    }
                    await refreshStats();
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white"
                >
                  Подтвердить
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
