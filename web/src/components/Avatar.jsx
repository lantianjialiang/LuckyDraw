import React from 'react';

/** 预设头像库：渐变底 + emoji，不需要上传也能有个像样的形象 */
export const PRESET_AVATARS = [
  { id: 'a1', emoji: '🐯', from: '#ffb457', to: '#ff6b3d' },
  { id: 'a2', emoji: '🐼', from: '#cbd5e1', to: '#64748b' },
  { id: 'a3', emoji: '🦊', from: '#fdba74', to: '#ea580c' },
  { id: 'a4', emoji: '🐻', from: '#d6a06a', to: '#7c4a21' },
  { id: 'a5', emoji: '🐨', from: '#c7d2fe', to: '#6366f1' },
  { id: 'a6', emoji: '🐰', from: '#fbcfe8', to: '#db2777' },
  { id: 'a7', emoji: '🦁', from: '#fde68a', to: '#d97706' },
  { id: 'a8', emoji: '🐮', from: '#e9d5ff', to: '#7c3aed' },
  { id: 'a9', emoji: '🐷', from: '#fecdd3', to: '#e11d48' },
  { id: 'a10', emoji: '🐔', from: '#fef08a', to: '#ca8a04' },
  { id: 'a11', emoji: '🐙', from: '#a5f3fc', to: '#0891b2' },
  { id: 'a12', emoji: '🦄', from: '#ddd6fe', to: '#8b5cf6' },
];

export const presetById = (id) => PRESET_AVATARS.find((a) => a.id === id) || PRESET_AVATARS[0];

export default function Avatar({ avatar = '', avatarKind = 'preset', name = '', size = 44, ring = false, style = {} }) {
  const s = { width: size, height: size, fontSize: Math.round(size * 0.46), ...style };
  if (avatarKind === 'photo' && avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`avatar-img ${ring ? 'avatar-ring' : ''}`}
        style={{ ...s, borderRadius: '50%', objectFit: 'cover', border: ring ? '2px solid var(--gold)' : '1px solid var(--border)' }}
      />
    );
  }
  const p = presetById(avatar || name);
  return (
    <span
      className={`avatar-preset ${ring ? 'avatar-ring' : ''}`}
      style={{ ...s, background: `linear-gradient(145deg, ${p.from}, ${p.to})` }}
      title={name}
    >
      {p.emoji}
    </span>
  );
}
