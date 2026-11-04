import React, { useEffect, useState } from 'react';
import { Check, Copy, Lock, ShieldCheck, X } from 'lucide-react';
import { Chat } from '../types';
import { computeConversationSafetyNumber } from '../services/cryptoE2EE';

interface SafetyNumberModalProps {
  chat: Chat;
  myPublicKeyJwk?: string;
  onClose: () => void;
}

export const SafetyNumberModal: React.FC<SafetyNumberModalProps> = ({
  chat,
  myPublicKeyJwk,
  onClose,
}) => {
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const myKey = myPublicKeyJwk || chat.myPubKeyJwk;
    if (chat.isCloudChat && myKey && chat.peerPubKeyJwk) {
      computeConversationSafetyNumber(myKey, chat.peerPubKeyJwk).then((num) => {
        if (active) setSafetyNumber(num);
      });
    } else {
      setSafetyNumber(null);
    }
    return () => {
      active = false;
    };
  }, [chat, myPublicKeyJwk]);

  const handleCopy = async () => {
    if (!safetyNumber) return;
    try {
      await navigator.clipboard.writeText(safetyNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Игнорируем ограничения буфера обмена
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#202C33] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Проверка сквозного шифрования (E2EE)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Диалог с «{chat.name}» защищён
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {chat.isCloudChat
                  ? 'Сообщения, голосовые заметки и превью медиа шифруются на вашем устройстве по протоколу ECDH P-256 + HKDF-SHA256 + AES-256-GCM. Даже сервер базы данных видит только шифротекст.'
                  : 'Все сообщения и сжатые медиафайлы этого чата зашифрованы на диске неизвлекаемым мастер-ключом AES-256-GCM внутри IndexedDB.'}
              </p>
            </div>
          </div>

          {chat.isCloudChat && (
            <div className="rounded-xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  60-значный код безопасности диалога
                </span>
                {safetyNumber && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Копировать</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {safetyNumber ? (
                <div className="grid grid-cols-4 gap-2 text-center font-mono tabular-nums text-sm font-semibold text-slate-800 dark:text-slate-100 py-1">
                  {safetyNumber.split(' ').map((block, idx) => (
                    <span
                      key={idx}
                      className="py-1 rounded bg-white dark:bg-[#202C33] border border-slate-200/70 dark:border-slate-700"
                    >
                      {block}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Ожидание публикации публичного ключа ECDH собеседника. Как только {chat.name} войдёт в приложение, код безопасности сформируется автоматически.
                </p>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Если эти цифры совпадают на вашем экране и экране собеседника, перехват сообщений («человек посередине») математически исключён.
              </p>
            </div>
          )}

          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>AES-256-GCM</span>
            <span aria-hidden="true">·</span>
            <span>ECDH P-256</span>
            <span aria-hidden="true">·</span>
            <span>96-bit IV + 128-bit Tag</span>
          </div>
        </div>
      </div>
    </div>
  );
};
