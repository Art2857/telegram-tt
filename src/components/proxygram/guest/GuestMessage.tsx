import { memo, useState } from '../../../lib/teact/teact';

import type { AccessChat, MessageDto, ReactionCountDto } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { formatTime, getAvatarPlaceholder, mediaLabel } from '../helpers';

import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';
import GuestMedia from './GuestMedia';

import styles from './GuestApp.module.scss';

const GROUP_TYPES = new Set(['chat', 'megagroup', 'forum']);
const QUOTE_LENGTH = 90;
/** Быстрые реакции, как в меню сообщения Telegram */
const QUICK_REACTIONS = ['👍', '❤', '🔥', '😂', '😮', '😢', '👎'];

type OwnProps = {
  message: MessageDto;
  chat: AccessChat;
  /** Сообщение, на которое ответили, если оно уже загружено */
  replyTarget?: MessageDto;
  /** Кто смотрит: свои сообщения гость может менять и удалять (по правам) */
  myUserId?: string;
  /** emoji не передан — снять реакцию */
  onReact?: (message: MessageDto, emoji?: string) => void;
  onReply?: (message: MessageDto) => void;
  onEdit?: (message: MessageDto) => void;
  onDelete?: (message: MessageDto) => void;
};

const GuestMessage = ({
  message, chat, replyTarget, myUserId, onReact, onReply, onEdit, onDelete,
}: OwnProps) => {
  const lang = useLang();
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  if (message.isService) {
    return <div className={styles.service}>{message.text || lang('PxgGuestServiceMessage')}</div>;
  }

  const isGroup = GROUP_TYPES.has(chat.type ?? '');
  const senderName = isGroup && !message.isOutgoing ? message.senderName ?? lang('PxgGuestUnknownSender') : undefined;
  const replyToId = message.replyTo?.replyToMsgId;
  const isStickerOnly = message.media?.kind === 'sticker' && !message.text;
  const reactions = message.reactions?.results ?? [];
  const { permissions } = chat;
  // своё сообщение или исходящее владельца при праве на них — так же проверяет сервер
  const isOwn = Boolean(myUserId) && message.sentByUserId === myUserId;
  const isAlive = !message.deleted;
  const canEdit = isAlive && Boolean(message.text)
    && ((isOwn && permissions.editOwn) || (message.isOutgoing && permissions.manageOwnerOutgoing));
  const canDelete = isAlive
    && ((isOwn && permissions.deleteOwn) || (message.isOutgoing && permissions.manageOwnerOutgoing));
  const canReply = isAlive && permissions.write;
  const canReact = isAlive && permissions.react;
  const chosen = reactions.find((item) => item.chosenOrder !== undefined)?.reaction.emoticon;

  return (
    <div
      className={buildClassName(styles.messageRow, message.isOutgoing && styles.outgoing)}
      onMouseLeave={() => setIsPickerOpen(false)}
    >
      {(canReply || canReact || canEdit || canDelete) && (
        <div className={buildClassName(styles.messageActions, isPickerOpen && styles.messageActionsOpen)}>
          {isPickerOpen ? QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={buildClassName(styles.quickReaction, chosen === emoji && styles.quickReactionChosen)}
              onClick={() => {
                setIsPickerOpen(false);
                onReact?.(message, chosen === emoji ? undefined : emoji);
              }}
            >
              {emoji}
            </button>
          )) : (
            <>
              {canReply && (
                <button
                  type="button"
                  title={lang.withRegular({ key: 'PxgGuestReply' })}
                  onClick={() => onReply?.(message)}
                >
                  <Icon name="reply" />
                </button>
              )}
              {canReact && (
                <button
                  type="button"
                  title={lang.withRegular({ key: 'PxgGuestReact' })}
                  onClick={() => setIsPickerOpen(true)}
                >
                  <Icon name="smile" />
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  title={lang.withRegular({ key: 'PxgGuestEdit' })}
                  onClick={() => onEdit?.(message)}
                >
                  <Icon name="edit" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  title={lang.withRegular({ key: 'PxgGuestDelete' })}
                  onClick={() => onDelete?.(message)}
                >
                  <Icon name="delete" />
                </button>
              )}
            </>
          )}
        </div>
      )}
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
