import React, { useEffect, useRef, useState } from 'react';
import { Download, ImageOff, Pause, Play, Volume2 } from 'lucide-react';
import { getMediaRecord } from '../services/storage';
import { formatBytes, formatDuration } from '../services/compression';

/**
 * Хук безопасной загрузки Blob из IndexedDB с автоматическим освобождением ObjectURL.
 */
function useIndexedDbMediaUrl(mediaId?: string) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(mediaId));
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!mediaId) {
      setObjectUrl(null);
      setLoading(false);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(false);

    getMediaRecord(mediaId)
      .then((record) => {
        if (!active) return;
        if (!record || !record.blob) {
          setError(true);
          setLoading(false);
          return;
        }
        createdUrl = URL.createObjectURL(record.blob);
        setObjectUrl(createdUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [mediaId]);

  return { objectUrl, loading, error };
}

interface StoredImageViewProps {
  mediaId?: string;
  previewDataUrl?: string;
  caption?: string;
  originalSize?: number;
  compressedSize?: number;
  onOpenLightbox: (url: string, caption?: string) => void;
}

export const StoredImageView: React.FC<StoredImageViewProps> = ({
  mediaId,
  previewDataUrl,
  caption,
  originalSize,
  compressedSize,
  onOpenLightbox,
}) => {
  const { objectUrl, loading, error } = useIndexedDbMediaUrl(mediaId);
  const displayUrl = objectUrl || previewDataUrl || null;

  const savedPercent =
    originalSize && compressedSize && originalSize > compressedSize
      ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
      : 0;

  if (loading && !previewDataUrl) {
    return (
      <div className="w-64 sm:w-72 h-48 rounded-lg bg-black/5 dark:bg-white/5 animate-pulse flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        Загрузка фото...
      </div>
    );
  }

  if ((error || !displayUrl) && !previewDataUrl) {
    return (
      <div className="w-64 sm:w-72 h-36 rounded-lg bg-black/5 dark:bg-white/5 flex flex-col items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 p-4">
        <ImageOff className="w-5 h-5 opacity-70" />
        <span>Медиафайл недоступен</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => displayUrl && onOpenLightbox(displayUrl, caption)}
        className="group relative block rounded-lg overflow-hidden max-w-[300px] sm:max-w-[340px] bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
      >
        <img
          src={displayUrl || ''}
          alt={caption || 'Фотография в чате'}
          referrerPolicy="no-referrer"
          className="w-full max-h-80 object-cover transition-transform duration-150 group-hover:scale-[1.01]"
        />
      </button>

      {compressedSize ? (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span>WebP</span>
          <span aria-hidden="true">·</span>
          <span>{formatBytes(compressedSize)}</span>
          {savedPercent > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700 dark:text-emerald-400">
                сжато −{savedPercent}%
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

interface StoredVideoViewProps {
  mediaId?: string;
  posterDataUrl?: string;
  compressedSize?: number;
  duration?: number;
}

export const StoredVideoView: React.FC<StoredVideoViewProps> = ({
  mediaId,
  posterDataUrl,
  compressedSize,
  duration,
}) => {
  const { objectUrl, loading, error } = useIndexedDbMediaUrl(mediaId);

  if (loading && !posterDataUrl) {
    return (
      <div className="w-64 sm:w-72 h-44 rounded-lg bg-black/5 dark:bg-white/5 animate-pulse flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        Расшифровка видео из хранилища...
      </div>
    );
  }

  if ((error || !objectUrl) && !posterDataUrl) {
    return (
      <div className="w-64 sm:w-72 h-36 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        Видеофайл не найден
      </div>
    );
  }

  if (!objectUrl && posterDataUrl) {
    return (
      <div className="space-y-1.5 max-w-[300px] sm:max-w-[340px]">
        <div className="relative rounded-lg overflow-hidden bg-black">
          <img
            src={posterDataUrl}
            alt="Зашифрованный кадр видео"
            referrerPolicy="no-referrer"
            className="w-full max-h-72 object-cover opacity-90"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
            <span className="px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs font-medium">
              Кадр видео · E2EE
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span>Видео · E2EE</span>
          {duration ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatDuration(duration)}</span>
            </>
          ) : null}
          {compressedSize ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(compressedSize)}</span>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  if (!objectUrl) {
    return null;
  }

  return (
    <div className="space-y-1.5 max-w-[300px] sm:max-w-[340px]">
      <div className="rounded-lg overflow-hidden bg-black">
        <video
          src={objectUrl}
          poster={posterDataUrl || undefined}
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-72 object-contain"
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
        <div className="flex items-center gap-1.5">
          <span>Видео</span>
          {duration ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatDuration(duration)}</span>
            </>
          ) : null}
          {compressedSize ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(compressedSize)}</span>
            </>
          ) : null}
        </div>
        <a
          href={objectUrl}
          download={`video-${Date.now()}.webm`}
          className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          title="Скачать видео"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Скачать</span>
        </a>
      </div>
    </div>
  );
};

interface VoiceMessagePlayerProps {
  mediaId?: string;
  remoteAudioDataUrl?: string;
  durationSec?: number;
  waveform?: number[];
  compressedSize?: number;
  isOwn: boolean;
}

const DEFAULT_WAVEFORM = [
  0.3, 0.55, 0.4, 0.8, 0.65, 0.9, 0.45, 0.35, 0.7, 0.85, 0.5, 0.6, 0.95, 0.7,
  0.4, 0.6, 0.75, 0.5, 0.3, 0.65, 0.8, 0.55, 0.45, 0.7, 0.5, 0.35, 0.6, 0.4,
];

export const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({
  mediaId,
  remoteAudioDataUrl,
  durationSec = 0,
  waveform,
  compressedSize,
  isOwn,
}) => {
  const { objectUrl, loading, error } = useIndexedDbMediaUrl(mediaId);
  const resolvedAudioSrc = objectUrl || remoteAudioDataUrl || null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSec);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);

  const bars = waveform && waveform.length > 8 ? waveform : DEFAULT_WAVEFORM;

  useEffect(() => {
    setTotalDuration(durationSec);
  }, [durationSec]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !resolvedAudioSrc) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.playbackRate = playbackRate;
      audio.play().catch(() => setIsPlaying(false));
    }
  };

  const cycleSpeed = () => {
    const nextRate: 1 | 1.5 | 2 = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleSeekBarClick = (index: number) => {
    const audio = audioRef.current;
    if (!audio || !totalDuration) return;
    const ratio = index / bars.length;
    audio.currentTime = ratio * totalDuration;
    setCurrentTime(audio.currentTime);
  };

  const progressRatio = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0;

  return (
    <div className="w-64 sm:w-72 py-1 select-none">
      {resolvedAudioSrc && (
        <audio
          ref={audioRef}
          src={resolvedAudioSrc}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onLoadedMetadata={(e) => {
            const dur = e.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setTotalDuration(dur);
            }
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        />
      )}

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={(loading && !remoteAudioDataUrl) || (error && !remoteAudioDataUrl) || !resolvedAudioSrc}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Пауза' : 'Воспроизвести голосовое сообщение'}
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            isOwn
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600'
          } disabled:opacity-40`}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-[3px] h-7" role="slider" aria-valuenow={Math.round(progressRatio * 100)}>
            {bars.map((amp, idx) => {
              const barRatio = idx / bars.length;
              const active = barRatio <= progressRatio;
              const heightPx = Math.max(4, Math.round(amp * 24));
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSeekBarClick(idx)}
                  aria-label={`Перемотать к ${Math.round(barRatio * 100)}%`}
                  style={{ height: `${heightPx}px` }}
                  className={`flex-1 rounded-full transition-colors ${
                    active
                      ? 'bg-emerald-600 dark:bg-emerald-400'
                      : 'bg-slate-400/50 dark:bg-slate-500/60 hover:bg-slate-500'
                  }`}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <div className="flex items-center gap-1.5">
              <Volume2 className="w-3 h-3 opacity-75" />
              <span>
                {formatDuration(isPlaying || currentTime > 0 ? currentTime : totalDuration)}
              </span>
              {compressedSize ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatBytes(compressedSize)}</span>
                </>
              ) : null}
            </div>

            <button
              type="button"
              onClick={cycleSpeed}
              className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[10px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
              title="Скорость воспроизведения"
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
