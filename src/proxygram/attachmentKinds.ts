import type { RegularLangKey } from '../types/language';
import type { AttachmentKind } from './server/types';

/** What to call an attachment a guest cannot open without a Telegram session */
export const PROXY_ATTACHMENT_KEYS: Record<AttachmentKind, RegularLangKey> = {
  giveaway: 'AttachGiveaway',
  story: 'AttachStory',
  invoice: 'PxgAttachInvoice',
  paidMedia: 'PxgAttachPaidMedia',
  todo: 'PxgAttachTodo',
  unknown: 'PxgAttachOther',
};
