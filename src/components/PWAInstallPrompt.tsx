import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  MoreVertical,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'full' | 'compact' | 'banner';
  onDismissBanner?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'full',
  onDismissBanner,
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, isInIframe, install } =
    usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Когда приложение уже запущено с рабочего стола телефона (режим standalone), скрываем кнопку установки
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const result = await install();
      if (result === 'unavailable') {
        setShowGuideModal(true);
      }
      return;
    }
    setShowGuideModal(true);
  };

  const currentUrl =
    typeof window !== 'undefined' ? window.location.href : '/';

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // Игнорируем ограничения буфера обмена
    }
  };

  return (
    <>
      {variant === 'banner' ? (
        <div className="mx-4 mb-2.5 p-3 rounded-xl bg-emerald-600/10 dark:bg-emerald-500/15 border border-emerald-600/25 dark:border-emerald-500/25 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                Установить на телефон
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                Скачать как отдельное приложение с иконкой
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать</span>
            </button>
            {onDismissBanner && (
              <button
                type="button"
                onClick={onDismissBanner}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                aria-label="Скрыть подсказку"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ) : variant === 'compact' ? (
        <button
          type="button"
          onClick={handleInstallClick}
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          title="Установить на телефон (Скачать как приложение)"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Приложение</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleInstallClick}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 dark:border dark:border-emerald-500/40 text-white dark:text-emerald-300 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Установить на телефон (Скачать приложение)</span>
        </button>
      )}

      {showGuideModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#202C33] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <img
                  src="/pwa-192x192.png"
                  alt="Иконка приложения"
                  className="w-6 h-6 rounded-md"
                />
                <span>Установка приложения на телефон</span>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              {isInIframe && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 space-y-2.5">
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    Сейчас приложение открыто внутри встроенного окна предпросмотра. Для прямой установки на рабочий стол откройте его в отдельной вкладке браузера:
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={currentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Открыть в отдельной вкладке</span>
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="px-3 py-2 rounded-lg bg-white dark:bg-[#2A3942] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Ссылка скопирована</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Копировать ссылку</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {isIOS ? (
                <div className="rounded-xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Как установить на iPhone или iPad (Safari):
                  </p>
                  <ol className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
                    <li className="flex items-start gap-2.5">
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        1.
                      </span>
                      <span>
                        Нажмите кнопку <strong>«Поделиться»</strong>{' '}
                        <Share className="w-3.5 h-3.5 inline mx-0.5 text-emerald-600" />{' '}
                        в нижней панели браузера Safari.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        2.
                      </span>
                      <span>
                        Прокрутите меню вниз и выберите пункт{' '}
                        <strong>«На экран „Домой“»</strong>.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        3.
                      </span>
                      <span>
                        Нажмите <strong>«Добавить»</strong> — иконка WhatsApp появится на рабочем столе телефона.
                      </span>
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                    <p className="font-semibold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                      {isAndroid
                        ? 'Установка на Android (Chrome / Браузер):'
                        : 'Установка на Android и компьютер:'}
                    </p>
                    <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                      <li className="flex items-start gap-2">
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          1.
                        </span>
                        <span>
                          Откройте меню браузера{' '}
                          <MoreVertical className="w-3.5 h-3.5 inline mx-0.5 text-emerald-600" />{' '}
                          в правом верхнем углу (или значок установки в адресной строке).
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          2.
                        </span>
                        <span>
                          Нажмите <strong>«Установить приложение»</strong> или{' '}
                          <strong>«Добавить на гл. экран»</strong>.
                        </span>
                      </li>
                    </ol>
                  </div>

                  {!isAndroid && (
                    <div className="rounded-xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-slate-800 p-3.5 text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        На iPhone (Safari):{' '}
                      </span>
                      нажмите <strong>«Поделиться»</strong> →{' '}
                      <strong>«На экран „Домой“»</strong>.
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#2A3942] dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineConnectivityBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 md:bottom-4 right-4 z-50 px-3.5 py-2 rounded-xl bg-amber-600 text-white text-xs font-medium shadow-lg flex items-center gap-2">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Автономный режим PWA · Доступен зашифрованный локальный кэш</span>
    </div>
  );
};
