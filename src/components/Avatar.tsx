import React, { useState } from 'react';
import { Users } from 'lucide-react';

interface AvatarProps {
  name: string;
  src?: string;
  isGroup?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-24 h-24 text-2xl',
};

const PALETTES = [
  'bg-emerald-700 text-white',
  'bg-teal-700 text-white',
  'bg-slate-700 text-white',
  'bg-cyan-800 text-white',
  'bg-stone-700 text-white',
];

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  isGroup = false,
  size = 'md',
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const colorIdx =
    name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % PALETTES.length;

  const sizeClass = SIZE_CLASSES[size];

  if (src && !imgFailed) {
    return (
      <div
        className={`relative rounded-full overflow-hidden shrink-0 bg-slate-200 dark:bg-slate-700 ${sizeClass} ${className}`}
      >
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold shrink-0 select-none ${sizeClass} ${PALETTES[colorIdx]} ${className}`}
      aria-label={name}
    >
      {isGroup ? (
        <Users className={size === 'xl' ? 'w-10 h-10' : 'w-5 h-5'} />
      ) : (
        <span>{initials || '?'}</span>
      )}
    </div>
  );
};
