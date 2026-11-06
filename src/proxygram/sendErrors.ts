import type { RegularLangKey } from '../types/language';
import type { AdvancedLangFnParameters } from '../util/localization';

import { isPxgErrorReason, PXG_ERROR_REASON_KEYS } from './errorReasons';

const SEND_ERROR_KEYS: Record<string, RegularLangKey> = {
  CHAT_WRITE_FORBIDDEN: 'PxgSendErrorWrite',
  CHAT_ADMIN_REQUIRED: 'PxgSendErrorWrite',
  CHAT_RESTRICTED: 'PxgSendErrorWrite',
  CHAT_SEND_PLAIN_FORBIDDEN: 'PxgSendErrorText',
  CHAT_SEND_PHOTOS_FORBIDDEN: 'PxgSendErrorPhotos',
  CHAT_SEND_VIDEOS_FORBIDDEN: 'PxgSendErrorVideos',
  CHAT_SEND_AUDIOS_FORBIDDEN: 'PxgSendErrorAudio',
  CHAT_SEND_VOICES_FORBIDDEN: 'PxgSendErrorVoice',
  VOICE_MESSAGES_FORBIDDEN: 'PxgSendErrorVoice',
  CHAT_SEND_ROUNDVIDEOS_FORBIDDEN: 'PxgSendErrorRound',
  CHAT_SEND_DOCS_FORBIDDEN: 'PxgSendErrorFiles',
  CHAT_SEND_POLL_FORBIDDEN: 'ErrorChatSendPollForbidden',
  CHAT_SEND_STICKERS_FORBIDDEN: 'ErrorChatSendStickersForbidden',
  CHAT_SEND_GIFS_FORBIDDEN: 'ErrorChatSendGifsForbidden',
  CHAT_SEND_MEDIA_FORBIDDEN: 'ErrorChatSendMediaForbidden',
  CHAT_SEND_INLINE_FORBIDDEN: 'PxgSendErrorInline',
  CHAT_SEND_GAME_FORBIDDEN: 'PxgSendErrorInline',
  TOPIC_CLOSED: 'TopicClosedByAdmin',
  USER_BANNED_IN_CHANNEL: 'PxgSendErrorWrite',
  USER_IS_BLOCKED: 'ErrorUserIsBlocked',
  YOU_BLOCKED_USER: 'ErrorYouBlockedUser',
  USER_PRIVACY_RESTRICTED: 'ErrorUserPrivacyRestricted',
  PREMIUM_ACCOUNT_REQUIRED: 'PxgSendErrorPremium',
  ALLOW_PAYMENT_REQUIRED: 'PxgSendErrorPaid',
  STARS_PAYMENT_REQUIRED: 'PxgSendErrorPaid',
  COPY_UNSUPPORTED: 'PxgForwardNativeOnly',
};

/** Сохраняем число секунд Telegram: оно нужно гостю для повторной попытки */
export function getProxySendError(error: string): AdvancedLangFnParameters | undefined {
  const wait = error.match(/^(SLOWMODE_WAIT|FLOOD_WAIT)_(\d+)$/);
  if (wait) return { key: 'PxgSendErrorWait', variables: { seconds: Number(wait[2]) } };
  const key = SEND_ERROR_KEYS[error];
  if (key) return { key };
  // The server's own refusal, kept by the queue as a reason
  // A queued job has no values to fill in, and the reasons that need them never come from the queue
  return isPxgErrorReason(error) ? { key: PXG_ERROR_REASON_KEYS[error] } as AdvancedLangFnParameters : undefined;
}
