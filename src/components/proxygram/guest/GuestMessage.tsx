import { memo } from '../../../lib/teact/teact';

import type { AccessChat, MessageDto, ReactionCountDto } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { formatTime, getAvatarPlaceholder, mediaLabel } from '../helpers';

import useLang from '../../../hooks/useLang';

import GuestMedia from './GuestMedia';

import styles from './GuestApp.module.scss';

const GROUP_TYPES = new Set(['chat', 'megagroup', 'forum']);
const QUOTE_LENGTH = 90;

type OwnProps = {
  message: MessageDto;
  chat: AccessChat;
  /** Сообщение, на которое ответили, если оно уже загружено */
  replyTarget?: MessageDto;
  /** emoji не передан — снять реакцию */
  onReact?: (message: MessageDto, emoji?: string) => void;
};

const GuestMessage = ({ message, chat, replyTarget, onReact }: OwnProps) => {
  const lang = useLang();

  if (message.isService) {
    return <div className={styles.service}>{message.text || lang('PxgGuestServiceMessage')}</div>;
  }

  const isGroup = GROUP_TYPES.has(chat.type ?? '');
  const senderName = isGroup && !message.isOutgoing ? message.senderName ?? lang('PxgGuestUnknownSender') : undefined;
  const replyToId = message.replyTo?.replyToMsgId;
  const isStickerOnly = message.media?.kind === 'sticker' && !message.text;
  const reactions = message.reactions?.results ?? [];

  return (
    <div className={buildClassName(styles.messageRow, message.isOutgoing && styles.outgoing)}>
      <div
        className={buildClassName(
          styles.bubble,
          message.deleted && styles.deleted,
          isStickerOnly && styles.stickerOnly,
        )}
      >
        {senderName && (
          <div className={styles.sender} style={`color: ${getAvatarPlaceholder(message.senderId ?? 0).color}`}>
            {senderName}
          </div>
        )}
        {Boolean(replyToId) && (
          <div className={styles.reply}>
            <span className={styles.replySender}>
              {replyTarget ? replyTarget.senderName ?? (replyTarget.isOutgoing ? lang('PxgGuestOwner') : '') : ''}
            </span>
            <span className={styles.replyText}>
              {replyTarget
                ? truncate(replyTarget.text) || mediaLabel(lang, replyTarget)
                : message.replyTo?.quoteText ?? lang('PxgGuestReplyTo')}
            </span>
          </div>
        )}
        {message.media && message.media.kind !== 'webpage' && (
          <GuestMedia message={message} canDownload={chat.permissions.download} />
        )}
        {message.text && <div className={styles.text}>{message.text}</div>}
        {reactions.length > 0 && (
          <div className={styles.reactions}>
            {reactions.map((item) => (
              <ReactionChip
                key={reactionKey(item)}
                item={item}
                canReact={chat.permissions.react && Boolean(onReact)}
                onToggle={(emoji) => onReact?.(message, emoji)}
              />
            ))}
          </div>
        )}
        <div className={styles.meta}>
          {message.deleted && <span className={styles.deletedMark}>{lang('PxgDeleted')}</span>}
          {message.editDate && !message.deleted && <span>{lang('PxgGuestEdited')}</span>}
          {message.sentByUserId && <span title={lang.withRegular({ key: 'PxgGuestSentByGuest' })}>✍</span>}
          <span>{formatTime(message.date)}</span>
        </div>
      </div>
    </div>
  );
};

function ReactionChip({ item, canReact, onToggle }: {
  item: ReactionCountDto;
  canReact: boolean;
  onToggle: (emoji?: string) => void;
}) {
  const emoji = item.reaction.emoticon;
  const isChosen = item.chosenOrder !== undefined;
  return (
    <button
      type="button"
      className={buildClassName(styles.reaction, isChosen && styles.reactionChosen)}
      disabled={!canReact || !emoji}
      onClick={() => emoji && onToggle(isChosen ? undefined : emoji)}
    >
      <span>{emoji ?? '★'}</span>
      <span>{item.count}</span>
    </button>
  );
}

function reactionKey(item: ReactionCountDto) {
  return item.reaction.emoticon ?? item.reaction.documentId ?? item.reaction._;
}

function truncate(text: string) {
  return text.length > QUOTE_LENGTH ? `${text.slice(0, QUOTE_LENGTH)}…` : text;
}

export default memo(GuestMessage);
