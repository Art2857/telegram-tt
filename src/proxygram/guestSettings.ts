import { addCallback, removeCallback } from '../lib/teact/teactn';
import { getGlobal, setGlobal } from '../global';

import type { ApiNotifyPeerType, ApiPeerNotifySettings } from '../api/types';
import type { SharedSettings } from '../global/types/sharedState';
import type { AccountSettings, TranslationTone } from '../types';
import { TRANSLATION_TONES } from '../types';

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
const TRANSLATION_KEYS = [
  'canTranslate', 'canTranslateChats', 'doNotTranslate', 'translationLanguage', 'translationTone',
] as const;

const DELETED_VIEW_KEYS = ['pxgHideDeleted', 'pxgHideDeletedChats'] as const;

type TranslationSettings = Partial<Pick<AccountSettings, typeof TRANSLATION_KEYS[number]>>;
type DeletedViewSettings = Partial<Pick<AccountSettings, typeof DELETED_VIEW_KEYS[number]>>;

type GuestSettings = Partial<SharedSettings> & {
  /** Folder tags in the chat list: a Telegram account setting, which a guest keeps here */
  folderTags?: boolean;
  /** Notifications by chat type, also read by the server for Web Push */
  notifyDefaults?: NotifyDefaults;
  /** Translation preferences belong to an account's settings, which a guest does not keep between reloads */
  translation?: TranslationSettings;
  /** Whether deleted messages stay in the feed, an account setting too */
  deletedView?: DeletedViewSettings;
};

type NotifyDefaults = Record<ApiNotifyPeerType, ApiPeerNotifySettings>;

const NOTIFY_PEER_TYPES: ApiNotifyPeerType[] = ['users', 'groups', 'channels'];

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

  function apply({
    folderTags, notifyDefaults, translation, deletedView, ...shared
  }: GuestSettings) {
    applyShared(shared);
    if (folderTags === undefined && !notifyDefaults && !translation && !deletedView) return;
    let global = getGlobal();
    if (folderTags !== undefined) {
      global = { ...global, chatFolders: { ...global.chatFolders, areTagsEnabled: folderTags } };
    }
    if (notifyDefaults) global = { ...global, settings: { ...global.settings, notifyDefaults } };
    if (translation) {
      global = {
        ...global,
        settings: { ...global.settings, byKey: { ...global.settings.byKey, ...translation } },
      };
    }
    if (deletedView) {
      global = {
        ...global,
        settings: { ...global.settings, byKey: { ...global.settings.byKey, ...deletedView } },
      };
    }
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
    notifyDefaults: global.settings.notifyDefaults,
    translation: pick(global.settings.byKey, [...TRANSLATION_KEYS]),
    deletedView: pick(global.settings.byKey, [...DELETED_VIEW_KEYS]),
  };
}

function sanitizeTranslation(value: unknown): TranslationSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const {
    canTranslate, canTranslateChats, doNotTranslate, translationLanguage, translationTone,
  } = value as Record<string, unknown>;
  return {
    ...(typeof canTranslate === 'boolean' && { canTranslate }),
    ...(typeof canTranslateChats === 'boolean' && { canTranslateChats }),
    ...(Array.isArray(doNotTranslate) && {
      doNotTranslate: doNotTranslate.filter((language): language is string => typeof language === 'string'),
    }),
    ...(typeof translationLanguage === 'string' && { translationLanguage }),
    ...(TRANSLATION_TONES.includes(translationTone as TranslationTone) && {
      translationTone: translationTone as TranslationTone,
    }),
  };
}

function sanitizeNotifyDefaults(value: unknown): NotifyDefaults | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const defaults = value as Record<string, ApiPeerNotifySettings | undefined>;
  return Object.fromEntries(NOTIFY_PEER_TYPES.map((type) => [type, {
    mutedUntil: Number(defaults[type]?.mutedUntil) || 0,
    shouldShowPreviews: defaults[type]?.shouldShowPreviews !== false,
  }])) as NotifyDefaults;
}

function sanitizeDeletedView(value: unknown): DeletedViewSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { pxgHideDeleted, pxgHideDeletedChats } = value as Record<string, unknown>;
  return {
    ...(typeof pxgHideDeleted === 'boolean' && { pxgHideDeleted }),
    ...(typeof pxgHideDeletedChats === 'object' && pxgHideDeletedChats && {
      pxgHideDeletedChats: Object.fromEntries(Object.entries(pxgHideDeletedChats)
        .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')),
    }),
  };
}

function sanitizeSettings(data: Record<string, unknown>): GuestSettings {
  const result: Record<string, unknown> = {};
  if (typeof data.folderTags === 'boolean') result.folderTags = data.folderTags;
  const notifyDefaults = sanitizeNotifyDefaults(data.notifyDefaults);
  if (notifyDefaults) result.notifyDefaults = notifyDefaults;
  const translation = sanitizeTranslation(data.translation);
  if (translation) result.translation = translation;
  const deletedView = sanitizeDeletedView(data.deletedView);
  if (deletedView) result.deletedView = deletedView;
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
