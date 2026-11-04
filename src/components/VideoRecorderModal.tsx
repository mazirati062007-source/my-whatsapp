import React, { useEffect, useRef, useState } from 'react';
import { CircleDot, Send, Square, Video, X } from 'lucide-react';
import { formatDuration } from '../services/compression';

interface VideoRecorderModalProps {
  onClose: () => void;
  onSendVideo: (blob: Blob, caption: string) => void;
}

export const VideoRecorderModal: React.FC<VideoRecorderModalProps> = ({
  onClose,
  onSendVideo,
}) => {
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [status, setStatus] = useState<'ready' | 'recording' | 'preview' | 'error'>('ready');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [seconds, setSeconds] = useState<number>(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    const initCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('error');
        setErrorMsg('Камера недоступна в браузере. Используйте загрузку готового видеофайла через скрепку.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg('Не предоставлен доступ к камере. Вы можете отправить видеофайл с устройства через кнопку прикрепления.');
        }
      }
    };

    initCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (status !== 'recording') return;
    const timer = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    setSeconds(0);

    const mimeCandidates = [
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const supportedMime =
      mimeCandidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ||
      '';

    // Компактный битрейт ~550 Кбит/с для экономии места в IndexedDB
    const recorder = new MediaRecorder(streamRef.current, {
      ...(supportedMime ? { mimeType: supportedMime } : {}),
      videoBitsPerSecond: 550_000,
      audioBitsPerSecond: 32_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      const url = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setRecordedUrl(url);
      setStatus('preview');
    };

    recorderRef.current = recorder;
    recorder.start(250);
    setStatus('recording');
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const handleSend = () => {
    if (!recordedBlob) return;
    onSendVideo(recordedBlob, caption.trim());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#202C33] border border-slate-200 dark:border-slate-700 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
            <Video className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Запись сжатого видеосообщения</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {status === 'error' ? (
            <div className="p-6 text-center text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
              {errorMsg}
            </div>
          ) : (
            <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
              {status === 'preview' && recordedUrl ? (
                <video
                  src={recordedUrl}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                />
              ) : (
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              )}

              {status === 'recording' && (
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-red-600 text-white text-xs font-mono tabular-nums">
                  ЗАПИСЬ · {formatDuration(seconds)}
                </div>
              )}
            </div>
          )}

          {status === 'preview' && (
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Добавить подпись к видео..."
              className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-100 dark:bg-[#2A3942] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          )}

          <div className="flex items-center justify-end gap-2.5">
            {status === 'ready' && (
              <button
                type="button"
                onClick={startRecording}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <CircleDot className="w-4 h-4" />
                <span>Начать запись (550 Кбит/с)</span>
              </button>
            )}

            {status === 'recording' && (
              <button
                type="button"
                onClick={stopRecording}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Остановить</span>
              </button>
            )}

            {status === 'preview' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
                    setRecordedBlob(null);
                    setRecordedUrl(null);
                    setStatus('ready');
                    if (videoPreviewRef.current && streamRef.current) {
                      videoPreviewRef.current.srcObject = streamRef.current;
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  Переснять
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span>Отправить</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
