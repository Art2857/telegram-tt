import type { MessageDto } from '../../proxygram/server/types';
import type { LangFn } from '../../util/localization/types';
import { PxgError } from '../../proxygram/server/types';

import { getPxgReasonText } from '../../proxygram/errorReasons';
import { getProxySendError } from '../../proxygram/sendErrors';

const ERROR_KEYS: Record<string, string> = {
  network: 'PxgErrorNetwork',
  invalid_code: 'PxgErrorInvalidCode',
  expired: 'PxgErrorExpired',
  too_many_attempts: 'PxgErrorTooMany',
  resend_later: 'PxgErrorResendLater',
  bot_offline: 'PxgErrorBotOffline',
  denied: 'PxgErrorDenied',
  not_found: 'PxgErrorExpired',
  forbidden: 'PxgErrorForbidden',
  rate_limited: 'PxgErrorRateLimited',
  already_exists: 'PxgErrorAlreadyExists',
  busy: 'PxgErrorBusy',
  grantee_not_registered: 'PxgErrorNotRegistered',
  too_large: 'PxgGuestFileTooLarge',
  no_space: 'PxgGuestNoServerSpace',
};

/**
 * Понятный текст ошибки сервера Proxygram на языке интерфейса: по причине отказа, затем по коду, затем по коду
 * Telegram. Готовую фразу сервера не показываем — она по-русски и только для его журнала (spec/07 §5)
 */
export function describePxgError(lang: LangFn, error: unknown): string {
  if (!(error instanceof PxgError)) return lang('PxgErrorGeneric');
  const byReason = error.reason ? getPxgReasonText(lang, error.reason, error.params) : undefined;
  if (byReason) return byReason;
  const key = ERROR_KEYS[error.code];
  if (key) return (lang as unknown as (langKey: string) => string)(key);
  const telegram = getProxySendError(error.message) as { key: string; variables?: object } | undefined;
  if (!telegram) return lang('PxgErrorGeneric');
  return (lang as unknown as (langKey: string, variables?: object) => string)(telegram.key, telegram.variables);
}

const AVATAR_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

/** Цвет и буквы аватара без фотографии — как у Telegram */
export function getAvatarPlaceholder(seed: string | number, title?: string | null) {
  const hash = String(seed).split('').reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
  const words = (title ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2) ?? '?').toUpperCase();
  return { color: AVATAR_COLORS[hash % AVATAR_COLORS.length], initials };
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function displayName(user?: { username?: string | null; firstName?: string | null; tgUserId?: number } | null) {
  if (!user) return '—';
  return user.firstName || (user.username ? `@${user.username}` : `id${user.tgUserId ?? ''}`);
}

const MEDIA_LABELS: Record<string, string> = {
  photo: 'PxgMediaPhoto',
  video: 'PxgMediaVideo',
  round: 'PxgMediaRound',
  gif: 'PxgMediaGif',
  sticker: 'PxgMediaSticker',
  voice: 'PxgMediaVoice',
  audio: 'PxgMediaAudio',
  poll: 'PxgMediaPoll',
  geo: 'PxgMediaGeo',
  geo_live: 'PxgMediaGeo',
  venue: 'PxgMediaGeo',
  contact: 'PxgMediaContact',
};

/** «Фото», «Стикер», «Голосовое»… — для цитаты в ответе и вложений, которых нет в архиве */
export function mediaLabel(lang: LangFn, message: MessageDto) {
  const key = MEDIA_LABELS[message.media?.kind ?? ''] ?? 'PxgMediaDocument';
  return (lang as unknown as (k: string) => string)(key);
}
