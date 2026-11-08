import type { PermissionKey, Permissions, PresetKey } from './server/types';

// Зеркало packages/protocol/src/permissions.ts: окно выдачи доступа показывает итоговые права шаблона.
// Меняя шаблоны на сервере — поменяйте и здесь.

export const PERMISSION_KEYS: PermissionKey[] = [
  'read', 'write', 'sendMedia', 'useOwnerStickers', 'react', 'editOwn', 'deleteOwn', 'manageOwnerOutgoing',
  'interact', 'download', 'forwardOut', 'seeArchive', 'seeAttribution', 'markRead', 'typing', 'seePhones', 'admin',
  'signMessages', 'spendStars',
];

const NONE = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false])) as Permissions;

export const PRESETS: Record<PresetKey, Permissions> = {
  readOnly: { ...NONE, read: true, download: true, markRead: true },
  assistant: {
    ...NONE,
    read: true,
    write: true,
    sendMedia: true,
    useOwnerStickers: true,
    react: true,
    editOwn: true,
    deleteOwn: true,
    interact: true,
    download: true,
    seeAttribution: true,
    markRead: true,
    typing: true,
  },
  full: {
    ...(Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true])) as Permissions),
    seePhones: false,
    admin: false,
    signMessages: false,
    // The owner's money is never part of a preset: only an explicit right with a daily limit
    spendStars: false,
  },
};

export function resolvePermissions(preset: PresetKey, overrides: Partial<Permissions> = {}): Permissions {
  return { ...PRESETS[preset], ...overrides, read: true };
}

/** Отличия от шаблона — только они хранятся в доступе */
export function diffPermissions(preset: PresetKey, permissions: Permissions): Partial<Permissions> {
  return Object.fromEntries(PERMISSION_KEYS
    .filter((key) => key !== 'read' && permissions[key] !== PRESETS[preset][key])
    .map((key) => [key, permissions[key]]));
}
