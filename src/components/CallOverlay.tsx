import React, { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CallType, Chat } from '../types';
import { Avatar } from './Avatar';
import { formatDuration } from '../services/compression';

interface CallOverlayProps {
  chat: Chat;
  initialCallType: CallType;
  onEndCall: (finalType: CallType, durationSec: number) => void;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  chat,
  initialCallType,
  onEndCall,
}) => {
  const [callType, setCallType] = useState<CallType>(initialCallType);
  const [phase, setPhase] = useState<'connecting' | 'connected'>('connecting');
  const [seconds, setSeconds] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState<boolean>(initialCallType === CallType.VIDEO);
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [minimized, setMinimized] = useState<boolean>(false);
  const [mediaNotice, setMediaNotice] = useState<string>('');
  const [micLevel, setMicLevel] = useState<number>(0);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Имитация дозвона (1.4 сек -> Соединено)
  useEffect(() => {
    const connectTimer = window.setTimeout(() => {
      setPhase('connected');
    }, 1400);
    return () => window.clearTimeout(connectTimer);
  }, []);

  // Таймер разговора
  useEffect(() => {
    if (phase !== 'connected') return;
    const interval = window.setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [phase]);

  // Запрос реальной камеры/микрофона с мягким откатом, если устройство недоступно
  useEffect(() => {
    let cancelled = false;

    const setupMedia = async () => {
      // Останавливаем предыдущий поток
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMediaNotice('Локальный демо-режим звонка (камера/микрофон не обнаружены в браузере)');
        return;
      }

      try {
        const wantVideo = callType === CallType.VIDEO && isVideoEnabled;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: wantVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        stream.getAudioTracks().forEach((t) => {
          t.enabled = !isMuted;
        });

        streamRef.current = stream;
        setMediaNotice('');

        if (localVideoRef.current && wantVideo) {
          localVideoRef.current.srcObject = stream;
        }

        // Анализатор громкости микрофона
        try {
          const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          const tick = () => {
            if (cancelled) return;
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            setMicLevel(Math.min(1, avg / 90));
            animFrameRef.current = requestAnimationFrame(tick);
          };
          tick();
        } catch {
          // Игнорируем ошибку WebAudio
        }
      } catch {
        if (!cancelled) {
          setMediaNotice('Доступ к камере/микрофону не выдан — звонок работает в демо-режиме');
        }
      }
    };

    setupMedia();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [callType, isVideoEnabled]);

  // Привязываем видео при разворачивании из мини-окна
  useEffect(() => {
    if (!minimized && localVideoRef.current) {
      const activeStream = isScreenSharing && screenStreamRef.current ? screenStreamRef.current : streamRef.current;
      if (activeStream) {
        localVideoRef.current.srcObject = activeStream;
      }
    }
  }, [minimized, isScreenSharing]);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
    }
  };

  const toggleVideo = () => {
    if (callType === CallType.AUDIO) {
      setCallType(CallType.VIDEO);
      setIsVideoEnabled(true);
    } else {
      const next = !isVideoEnabled;
      setIsVideoEnabled(next);
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach((t) => {
          t.enabled = next;
        });
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
      if (localVideoRef.current && streamRef.current) {
        localVideoRef.current.srcObject = streamRef.current;
      }
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setMediaNotice('Демонстрация экрана не поддерживается в текущем окне предпросмотра');
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = displayStream;
      setIsScreenSharing(true);
      setCallType(CallType.VIDEO);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = displayStream;
      }
      displayStream.getVideoTracks()[0].onended = () => {
        setIsScreenSharing(false);
        screenStreamRef.current = null;
      };
    } catch {
      setMediaNotice('Демонстрация экрана отменена');
    }
  };

  const handleHangup = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    onEndCall(callType, seconds);
  };

  // Компактная плавающая панель при сворачивании звонка (можно переписываться во время разговора)
  if (minimized) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900 text-white shadow-xl border border-slate-700">
        <Avatar name={chat.name} src={chat.avatarUrl} isGroup={chat.isGroup} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate max-w-[150px]">{chat.name}</p>
          <p className="text-xs text-emerald-400 font-mono tabular-nums">
            {phase === 'connecting' ? 'Вызов...' : formatDuration(seconds)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 ml-2">
          <button
            type="button"
            onClick={toggleMute}
            className={`p-2 rounded-lg transition-colors ${
              isMuted ? 'bg-amber-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
            title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            title="Развернуть окно звонка"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleHangup}
            className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
            title="Завершить звонок"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-3xl h-[82vh] max-h-[680px] rounded-2xl bg-[#111B21] text-white border border-slate-800 shadow-2xl overflow-hidden flex flex-col justify-between">
        {/* Верхняя панель звонка */}
        <div className="relative z-10 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/70 to-transparent">
          <div className="text-xs text-slate-300 flex items-center gap-2">
            <span>{callType === CallType.VIDEO ? 'Видеозвонок' : 'Аудиозвонок'}</span>
            <span aria-hidden="true">·</span>
            <span>Защищённый локальный канал</span>
          </div>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>Свернуть в чат</span>
          </button>
        </div>

        {/* Центральная сцена: собеседник + собственная камера Picture-in-Picture */}
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div
            style={{
              transform: !isMuted && micLevel > 0.08 ? `scale(${1 + micLevel * 0.08})` : 'scale(1)',
            }}
            className="transition-transform duration-150 mb-4"
          >
            <Avatar name={chat.name} src={chat.avatarUrl} isGroup={chat.isGroup} size="xl" />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">{chat.name}</h2>
          <p className="mt-1.5 text-sm text-emerald-400 font-mono tabular-nums">
            {phase === 'connecting' ? 'Соединение...' : formatDuration(seconds)}
          </p>

          {mediaNotice && (
            <p className="mt-3 text-xs text-slate-400 max-w-md">{mediaNotice}</p>
          )}

          {/* Окно собственной камеры или демонстрации экрана */}
          {(callType === CallType.VIDEO && isVideoEnabled) || isScreenSharing ? (
            <div className="absolute bottom-4 right-6 w-44 sm:w-56 aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-700 shadow-lg">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-1.5 left-2 text-[11px] text-white/90 bg-black/50 px-2 py-0.5 rounded">
                {isScreenSharing ? 'Ваш экран' : 'Вы'}
              </div>
            </div>
          ) : null}
        </div>

        {/* Нижняя панель управления звонком */}
        <div className="relative z-10 px-6 py-5 bg-[#1F2C34] border-t border-slate-800 flex items-center justify-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => setIsSpeakerOn((s) => !s)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isSpeakerOn
                ? 'bg-slate-700/80 hover:bg-slate-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
            title={isSpeakerOn ? 'Динамик включён' : 'Динамик выключен'}
          >
            {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          <button
            type="button"
            onClick={toggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              callType === CallType.VIDEO && isVideoEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-700/80 hover:bg-slate-600 text-white'
            }`}
            title={
              callType === CallType.VIDEO && isVideoEnabled
                ? 'Выключить камеру'
                : 'Включить видеокамеру'
            }
          >
            {callType === CallType.VIDEO && isVideoEnabled ? (
              <Video className="w-5 h-5" />
            ) : (
              <VideoOff className="w-5 h-5" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isMuted
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-slate-700/80 hover:bg-slate-600 text-white'
            }`}
            title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <button
            type="button"
            onClick={toggleScreenShare}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isScreenSharing
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-700/80 hover:bg-slate-600 text-white'
            }`}
            title="Демонстрация экрана"
          >
            <MonitorUp className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={handleHangup}
            className="px-6 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="hidden sm:inline">Завершить</span>
          </button>
        </div>
      </div>
    </div>
  );
};
