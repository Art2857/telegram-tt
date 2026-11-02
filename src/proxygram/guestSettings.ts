import { addCallback, removeCallback } from '../lib/teact/teactn';
import { getGlobal, setGlobal } from '../global';

import type { SharedSettings } from '../global/types/sharedState';

import { INITIAL_SHARED_STATE } from '../global/initialState';
import { pick } from '../util/iteratees';
import { pxgRpc } from './server/rpc';
import { getPxgState, subscribePxg } from './server/store';

const SAVE_DELAY_MS = 500;
const SETTINGS_KEYS = [
  'theme', 'shouldUseSystemTheme', 'language', 'messageTextSize', 'animationLevel', 'foldersPosition',
  'messageSendKeyCombo', 'shouldReplaceTextShortcuts', 'timeFormat', 'wasTimeFormatSetManually',
  'canDisplayChatInTitle', 'performance', 'wasAnimationLevelSetManually',
] as const;

type GuestSettings = Partial<SharedSettings> & {
  /** Folder tags in the chat list: a Telegram account setting, which a guest keeps here */
  folderTags?: boolean;
};

/** Sync only portable interface preferences; browser geometry, debug flags and credentials stay on the device */
export function startGuestSettingsSync(applyShared: (settings: Partial<SharedSettings>) => void) {
  const userId = getPxgState().session!.user.id;
  let isActive = true;
  let isLoaded = false;
  let isSaving = false;
  let requestId = 0;
  let lastJson = JSON.stringify(readSettings());
  let pending: ReturnType<typeof readSettings> | undefined;
  let timer: number | undefined;

  function apply({ folderTags, ...shared }: GuestSettings) {
    applyShared(shared);
    if (folderTags === undefined) return;
    let global = getGlobal();
    global = { ...global, chatFolders: { ...global.chatFolders, areTagsEnabled: folderTags } };
    setGlobal(global);
  }

  function isCurrent() {
    return isActive && getPxgState().session?.user.id === userId;
  }

  async function load() {
    if (!isCurrent() || pending || isSaving) return;
    const currentRequestId = ++requestId;
    try {
      const result = await pxgRpc.call<{ data: Record<string, unknown> } | undefined>('settings.get');
      if (!isCurrent() || currentRequestId !== requestId) return;
      const wasLoaded = isLoaded;
      isLoaded = true;
      // The first device of the guest: its preferences become the ones every other device gets
      if (!result) {
        pending = readSettings();
        void save();
        return;
      }
      // An edit made while the copy was on its way is newer. Before the first load nothing is an edit: a new
      // device adjusts defaults itself (system theme, time format), and those must not replace the saved choice
      if (wasLoaded && (pending || isSaving)) {
        void save();
        return;
      }
      const settings = sanitizeSettings(result.data || {});
      lastJson = JSON.stringify({ ...readSettings(), ...settings });
      apply(settings);
    } catch {
      // Reconnecting retries the read without replacing local preferences
    }
  }

  async function save() {
    if (!isCurrent() || !isLoaded || isSaving || !pending || getPxgState().connection !== 'online') return;
    const data = pending;
    pending = undefined;
    isSaving = true;
    try {
      await pxgRpc.call('settings.set', { data });
    } catch {
      if (isCurrent()) pending ||= data;
    } finally {
      isSaving = false;
    }
    if (pending && pending !== data && isCurrent()) void save();
  }

  function handleChange() {
    if (!isCurrent() || !isLoaded) return;
    const data = readSettings();
    const json = JSON.stringify(data);
    if (json === lastJson) return;
    lastJson = json;
    pending = data;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }

  addCallback(handleChange);
  const unsubscribeEvents = pxgRpc.on((event) => {
    if (event.e === 'settings.changed') void load();
  });
  let connection = getPxgState().connection;
  const unsubscribeConnection = subscribePxg(() => {
    const next = getPxgState().connection;
    if (next === connection) return;
    connection = next;
    if (connection !== 'online') return;
    if (pending) void save();
    else void load();
  });
  void load();
  return () => {
    isActive = false;
    window.clearTimeout(timer);
    removeCallback(handleChange);
    unsubscribeEvents();
    unsubscribeConnection();
  };
}

function readSettings() {
  const global = getGlobal();
  return {
    ...pick(global.sharedState.settings, [...SETTINGS_KEYS]),
    folderTags: Boolean(global.chatFolders.areTagsEnabled),
  };
}

function sanitizeSettings(data: Record<string, unknown>): GuestSettings {
  const result: Record<string, unknown> = {};
  if (typeof data.folderTags === 'boolean') result.folderTags = data.folderTags;
  const defaults = INITIAL_SHARED_STATE.settings;
  SETTINGS_KEYS.forEach((key) => {
    const value = data[key];
    if (key === 'performance') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      result.performance = { ...defaults.performance, ...Object.fromEntries(Object.entries(value).filter(
        ([name, enabled]) => name in defaults.performance && typeof enabled === 'boolean',
      )) };
      return;
    }
    if (key === 'wasAnimationLevelSetManually') {
      if (typeof value === 'boolean') result[key] = value;
      return;
    }
    if (typeof value !== typeof defaults[key]) return;
    if (key === 'theme' && value !== 'light' && value !== 'dark') return;
    if (key === 'foldersPosition' && value !== 'top' && value !== 'left') return;
    if (key === 'messageSendKeyCombo' && value !== 'enter' && value !== 'ctrl-enter') return;
    if (key === 'timeFormat' && value !== '12h' && value !== '24h') return;
    if (key === 'animationLevel' && value !== 0 && value !== 1 && value !== 2) return;
    if (key === 'messageTextSize' && (typeof value !== 'number' || value < 10 || value > 30)) return;
    if (key === 'language' && (typeof value !== 'string' || !/^[\w-]{1,64}$/.test(value))) return;
    result[key] = value;
  });
  return result;
}
