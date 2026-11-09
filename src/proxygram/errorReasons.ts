import type { RegularLangKey, RegularLangKeyWithVariables } from '../types/language';
import type { LangFn } from '../util/localization/types';
import { PxgError } from './server/types';

// Every reason the server may send (packages/protocol/src/errors.ts) and its string; lang.test.ts keeps them in step
export const PXG_ERROR_REASON_KEYS = {
  connect_disabled: 'PxgErrConnectDisabled',
  export_disabled: 'PxgErrExportDisabled',
  media_disabled: 'PxgErrMediaDisabled',
  files_disabled: 'PxgErrFilesDisabled',
  invites_disabled: 'PxgErrInvitesDisabled',
  push_disabled: 'PxgErrPushDisabled',
  languages_pending: 'PxgErrLanguagesPending',
  langpack_pending: 'PxgErrLangpackPending',
  account_unavailable: 'PxgErrAccountUnavailable',
  account_already_connected: 'PxgErrAccountAlreadyConnected',
  connect_busy: 'PxgErrConnectBusy',
  connect_wrong_account: 'PxgErrConnectWrongAccount',
  password_not_requested: 'PxgErrPasswordNotRequested',
  password_algo_unknown: 'PxgErrPasswordAlgoUnknown',
  account_disconnected: 'PxgErrAccountDisconnected',
  not_your_account: 'PxgErrNotYourAccount',
  file_loading: 'PxgErrFileLoading',
  file_not_archived: 'PxgErrFileNotArchived',
  file_not_saved: 'PxgErrFileNotSaved',
  file_empty: 'PxgErrFileEmpty',
  file_too_large: 'PxgErrFileTooLarge',
  no_space: 'PxgErrNoSpace',
  too_many_files: 'PxgErrTooManyFiles',
  upload_missing: 'PxgErrUploadMissing',
  upload_not_ready: 'PxgErrUploadNotReady',
  upload_mismatch: 'PxgErrUploadMismatch',
  upload_interrupted: 'PxgErrUploadInterrupted',
  upload_no_resume: 'PxgErrUploadNoResume',
  no_forward_out: 'PxgErrNoForwardOut',
  no_edit_history: 'PxgErrNoEditHistory',
  no_download: 'PxgErrNoDownload',
  no_topic_access: 'PxgErrNoTopicAccess',
  no_write: 'PxgErrNoWrite',
  no_send_files: 'PxgErrNoSendFiles',
  no_send_attachments: 'PxgErrNoSendAttachments',
  no_owner_emoji: 'PxgErrNoOwnerEmoji',
  no_owner_stickers: 'PxgErrNoOwnerStickers',
  no_react: 'PxgErrNoReact',
  no_owner_emoji_reaction: 'PxgErrNoOwnerEmojiReaction',
  no_admin: 'PxgErrNoAdmin',
  no_bot_buttons: 'PxgErrNoBotButtons',
  no_vote: 'PxgErrNoVote',
  no_interact: 'PxgErrNoInteract',
  no_upload_here: 'PxgErrNoUploadHere',
  no_source_access: 'PxgErrNoSourceAccess',
  cannot_edit_message: 'PxgErrCannotEditMessage',
  cannot_delete_message: 'PxgErrCannotDeleteMessage',
  access_gone: 'PxgErrAccessGone',
  user_blocked: 'PxgErrUserBlocked',
  job_no_actor: 'PxgErrJobNoActor',
  too_many_actions: 'PxgErrTooManyActions',
  source_lost: 'PxgErrSourceLost',
  owner_unavailable: 'PxgErrOwnerUnavailable',
  owner_flood: 'PxgErrOwnerFlood',
  reactions_premium: 'PxgErrReactionsPremium',
  transcribe_premium: 'PxgErrTranscribePremium',
  owner_cannot_pin: 'PxgErrOwnerCannotPin',
  owner_cannot_ban: 'PxgErrOwnerCannotBan',
  owner_cannot_create_topics: 'PxgErrOwnerCannotCreateTopics',
  owner_cannot_manage_topics: 'PxgErrOwnerCannotManageTopics',
  owner_cannot_delete_topics: 'PxgErrOwnerCannotDeleteTopics',
  owner_cannot_change_info: 'PxgErrOwnerCannotChangeInfo',
  topics_need_full_forum: 'PxgErrTopicsNeedFullForum',
  group_only: 'PxgErrGroupOnly',
  album_parts: 'PxgErrAlbumParts',
  quiz_answer_unknown: 'PxgErrQuizAnswerUnknown',
  geo_unavailable: 'PxgErrGeoUnavailable',
  copy_unsupported: 'PxgErrCopyUnsupported',
  same_account_forward: 'PxgErrSameAccountForward',
  forward_same_owner_only: 'PxgErrForwardSameOwnerOnly',
  message_not_found: 'PxgErrMessageNotFound',
  message_not_in_archive: 'PxgErrMessageNotInArchive',
  button_not_found: 'PxgErrButtonNotFound',
  poll_not_found: 'PxgErrPollNotFound',
  poll_closed: 'PxgErrPollClosed',
  poll_option_missing: 'PxgErrPollOptionMissing',
  poll_answers_disabled: 'PxgErrPollAnswersDisabled',
  poll_voters_hidden: 'PxgErrPollVotersHidden',
  todo_premium: 'PxgErrTodoPremium',
  todo_not_found: 'PxgErrTodoNotFound',
  todo_item_missing: 'PxgErrTodoItemMissing',
  todo_append_disabled: 'PxgErrTodoAppendDisabled',
  todo_complete_disabled: 'PxgErrTodoCompleteDisabled',
  ai_premium: 'PxgErrAiPremium',
  ai_tone_unavailable: 'PxgErrAiToneUnavailable',
  rich_premium: 'PxgErrRichPremium',
  rich_media_unsupported: 'PxgErrRichMediaUnsupported',
  sticker_unavailable: 'PxgErrStickerUnavailable',
  retry_key_required: 'PxgErrRetryKeyRequired',
  retry_key_conflict: 'PxgErrRetryKeyConflict',
  retry_too_old: 'PxgErrRetryTooOld',
  telegram_no_answer: 'PxgErrTelegramNoAnswer',
  transcribe_failed: 'PxgErrTranscribeFailed',
  translate_failed: 'PxgErrTranslateFailed',
  summary_failed: 'PxgErrSummaryFailed',
  grantee_missing: 'PxgErrGranteeMissing',
  invite_not_pending: 'PxgErrInviteNotPending',
  since_date_required: 'PxgErrSinceDateRequired',
  last_n_chat_only: 'PxgErrLastNChatOnly',
  last_n_not_folder: 'PxgErrLastNNotFolder',
  last_n_min: 'PxgErrLastNMin',
  share_exists: 'PxgErrShareExists',
  share_revoked: 'PxgErrShareRevoked',
  service_chat_forbidden: 'PxgErrServiceChatForbidden',
  share_to_self: 'PxgErrShareToSelf',
  share_target_missing: 'PxgErrShareTargetMissing',
  folders_limit: 'PxgErrFoldersLimit',
  saved_quota: 'PxgErrSavedQuota',
  requests_limit: 'PxgErrRequestsLimit',
  no_spend_stars: 'PxgErrNoSpendStars',
  stars_limit: 'PxgErrStarsLimit',
  request_rejected_recently: 'PxgErrRequestRejectedRecently',
  request_not_found: 'PxgErrRequestNotFound',
  request_owner_unknown: 'PxgErrRequestOwnerUnknown',
  saved_not_found: 'PxgErrSavedNotFound',
  saved_not_editable: 'PxgErrSavedNotEditable',
  cannot_block_self: 'PxgErrCannotBlockSelf',
  already_admin: 'PxgErrAlreadyAdmin',
  unblock_first: 'PxgErrUnblockFirst',
  restart_not_running: 'PxgErrRestartNotRunning',
  account_not_running: 'PxgErrAccountNotRunning',
  account_not_paused: 'PxgErrAccountNotPaused',
  account_no_owner: 'PxgErrAccountNoOwner',
  retry_failed_only: 'PxgErrRetryFailedOnly',
  cancel_pending_only: 'PxgErrCancelPendingOnly',
} as const satisfies Record<string, RegularLangKey | RegularLangKeyWithVariables>;
export type PxgErrorReason = keyof typeof PXG_ERROR_REASON_KEYS;

export type PxgErrorParams = Record<string, string | number>;

export function isPxgErrorReason(value: unknown): value is PxgErrorReason {
  return typeof value === 'string' && Object.hasOwn(PXG_ERROR_REASON_KEYS, value);
}

/**
 * Error text for Web A's error dialog: a server refusal in the interface language. Telegram's own codes stay as they
 * are, Web A and sendErrors know them; a phrase from the server is never shown, it is Russian and for its log only
 */
export function getPxgErrorMessage(lang: LangFn, error: unknown): string {
  if (!(error instanceof PxgError)) return error instanceof Error ? error.message : String(error);
  const text = error.reason ? getPxgReasonText(lang, error.reason, error.params) : undefined;
  if (text) return text;
  return /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : lang('PxgErrorGeneric');
}

/** Text of a server refusal in the interface language: the server sends a reason and values, not a phrase */
export function getPxgReasonText(lang: LangFn, reason: string, params?: PxgErrorParams) {
  if (!isPxgErrorReason(reason)) return undefined;
  return (lang as unknown as (key: string, variables?: PxgErrorParams) => string)(
    PXG_ERROR_REASON_KEYS[reason], params,
  );
}
