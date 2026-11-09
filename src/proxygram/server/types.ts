// Зеркало типов из packages/protocol: клиент живёт вне pnpm workspace и не тянет zod.
// Меняя протокол на сервере — поменяйте и здесь.
import type { ApiMessageEntity, ApiTypingStatus } from '../../api/types';

export type SessionLevel = 'guest' | 'client';

export interface SessionUser {
  id: string;
  tgUserId: number;
  username: string | null;
  firstName?: string | null;
  role: 'user' | 'admin';
}

export interface StoredSession {
  level: SessionLevel;
  accessToken: string;
  /** Unix-время в мс */
  accessExpiresAt: number;
  refreshToken: string;
  user: SessionUser;
}

export type LoginStart = {
  requestId: string;
  deviceSecret: string;
  expiresAt: string;
  botLink: string;
} & ({ delivery: 'bot' } | { delivery: 'deeplink'; deeplink: string });

export interface SessionTokensResponse {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  level: SessionLevel;
  user: SessionUser;
}

export type PermissionKey =
  | 'read' | 'write' | 'sendMedia' | 'useOwnerStickers' | 'react' | 'editOwn' | 'deleteOwn'
  | 'manageOwnerOutgoing' | 'interact' | 'download' | 'forwardOut' | 'seeArchive' | 'seeAttribution'
  | 'markRead' | 'typing' | 'seePhones' | 'admin' | 'signMessages' | 'spendStars' | 'startChats';

export type Permissions = Record<PermissionKey, boolean>;

export type PresetKey = 'readOnly' | 'assistant' | 'full';

export interface AccessChat {
  accountId: string;
  peerId: number;
  /** The viewer's own account in thin mode, not a chat someone shared */
  isOwn?: boolean;
  /** The provider's Telegram Saved Messages, shared with the same rights as any other chat */
  isSavedMessages?: boolean;
  title: string | null;
  username: string | null;
  type: 'user' | 'bot' | 'chat' | 'channel' | 'megagroup' | 'forum' | null;
  /** ID текущего фото чата или собеседника; сам аватар — через media.avatar */
  photoId: string | null;
  badges?: PeerBadgesDto | null;
  /** Up to where others read the account's outgoing messages */
  readOutboxMaxId?: number | null;
  /** The group has a channel, or the channel a discussion group, which may stay closed to the guest */
  hasLinkedChat?: boolean;
  /** "Restrict saving content" of the whole chat */
  isProtected?: boolean;
  /** Ограничения Telegram для владельца, с учётом его роли и срока личных запретов */
  telegramBans?: string[];
  isOwnerAdmin?: boolean;
  /** Who the guest writes as in this chat; null — the owner */
  sendAsPeerId?: number | null;
  /** Online status of the other side of a private chat */
  userStatus?: UserStatusDto | null;
  /** Phone of the other side of a private chat: only with `seePhones` */
  phone?: string | null;
  permissions: Permissions;
  /** The owner's Stars a day for paid messages; only for a guest with `spendStars` */
  starsPerDay?: number;
  shareIds: string[];
  /** Только архив: чат пропал у владельца, аккаунт недоступен или Telegram ограничил отправку */
  restricted: AccessRestriction | null;
  /** The owner's label for the guest: "Clients / Acme" */
  label?: string | null;
  /** Имя аккаунта владельца: гость пишет от его имени */
  providerName: string | null;
  /** Кто поделился: по ним полный вход переходит к этому человеку в своём Telegram */
  providerUserId: number | null;
  providerUsername: string | null;
  /** Premium у аккаунта владельца: несколько реакций и кастомные эмодзи */
  providerPremium?: boolean;
  /** How large a file can be sent: the limits of the server and of Telegram, higher with the owner's Premium */
  maxUploadBytes: number;
  /** Reactions allowed in a group or channel; `null` until the provider's worker reads them, and in private chats */
  reactions?: ChatReactionsDto | null;
  /** Profile of a group or channel from its full info; `null` until read, and in private chats */
  info?: ChatInfoDto | null;
  /** Гость заглушил чат у себя, unix-секунды */
  mutedUntil: number | null;
  /** Закреплён в списке гостя (позже закреплённый — выше), unix-секунды */
  pinnedAt: number | null;
  /** В архиве списка гостя, unix-секунды */
  archivedAt: number | null;
}

export type ForwardOptionsDto = {
  accounts: Record<string, 'native' | 'copy'>;
  copyError?: string;
  hasPoll?: boolean;
  hasCustomEmoji?: boolean;
  hasPremiumEmoji?: boolean;
};

/** A chat of the owner and the people it is open to right now */
export interface OutgoingChatDto {
  accountId: string;
  peerId: number;
  grantees: string[];
}

/** Who wrote a comment or put a reaction: a user or a channel */
export interface PeerBriefDto {
  peerId: number;
  name: string | null;
  photoId: string | null;
}

/** An inline bot as the owner's account sees it */
export interface InlineBotDto extends PeerBriefDto {
  username: string;
  placeholder: string;
}

export interface InlineResultDto {
  id: string;
  queryId: string;
  type: string;
  title?: string;
  description?: string;
  url?: string;
  document?: CatalogDocumentDto;
}

export interface InlineResultsDto {
  isGallery: boolean;
  nextOffset?: string;
  cacheTime: number;
  results: InlineResultDto[];
}

/** Who the owner may write as in a chat */
export interface SendAsPeerDto extends PeerBriefDto {
  isPremium: boolean;
}

/** Who read a message and when, in unix seconds */
export interface SeenByDto extends PeerBriefDto {
  date: number;
}

/** Marks next to a name: verified, scam or fake, Premium, emoji status */
export interface PeerBadgesDto {
  verified?: true;
  fake?: 'fake' | 'scam';
  premium?: true;
  emojiStatus?: { documentId: string; until?: number };
}

/** A member of a shared group or channel, as the owner sees them */
export interface MemberDto {
  userId: number;
  name: string | null;
  username: string | null;
  photoId: string | null;
  /** Only with `seePhones` and when Telegram shows the number to the owner */
  phone?: string | null;
  badges?: PeerBadgesDto | null;
  isBot: boolean;
  role: 'creator' | 'admin' | 'member';
  rank: string | null;
  joinedAt: string | null;
}

export interface ChatInfoDto {
  about?: string;
  /** Members of a group or subscribers of a channel */
  participantsCount?: number;
  usernames?: string[];
  linkedChatId?: number;
  slowmodeSeconds?: number;
  /** The owner's invite link; only with the admin permission */
  inviteLink?: string;
  /** The owner created the chat */
  isCreator?: boolean;
  /** The owner's admin rights by flag name (changeInfo, pinMessages…) */
  adminRights?: string[];
  /** Rights banned for members by default, by flag name */
  defaultBannedRights?: string[];
  /** The group or the other side of a private chat charges the owner this many Stars a message */
  paidMessagesStars?: number;
  /** The channel or supergroup accepts paid Star reactions */
  paidReactionsAvailable?: boolean;
}

/** What the other side of a private chat requires from the owner's account */
export interface ContactRequirementsDto {
  paidStars: number | null;
  premiumRequired: boolean;
}

/** As Telegram's ChatReactions: `limit` is how many different reactions a message may have */
export interface ChatReactionsDto {
  type: 'all' | 'some' | 'none';
  allowCustom?: boolean;
  allowed?: ({ emoji: string } | { documentId: string })[];
  limit?: number;
}

/** Своё место чата в списке гостя; приходит в ответ на chats.mute/pin/archive и событием chats.state */
export type ChatStateDto = Pick<
  AccessChat, 'accountId' | 'peerId' | 'mutedUntil' | 'pinnedAt' | 'archivedAt' | 'sendAsPeerId'
>;

export type AccessRestriction = 'source_lost' | 'account_unavailable' | 'flood';
export type GuestBurstReason = 'burst' | 'rate_limited' | 'account_limit';

export type InlineButtonDto = (
  | { kind: 'callback'; text: string; data: string }
  | { kind: 'url'; text: string; url: string }
  | { kind: 'copy'; text: string; copyText: string }
  | { kind: 'switchInline'; text: string; query: string }
  | { kind: 'unsupported'; text: string }
) & {
  /** The button's color and custom emoji icon */
  style?: { type?: 'primary' | 'success' | 'destructive'; iconId?: string };
};

export interface PollDto {
  id: string;
  question: string;
  questionEntities: unknown[];
  answers: { text: string; option: string }[];
  isClosed: boolean;
  isPublic: boolean;
  isMultipleChoice: boolean;
  isQuiz: boolean;
  /** Telegram 2026: новые возможности опросов */
  canAddAnswers?: boolean;
  isRevoteDisabled?: boolean;
  shouldShuffleAnswers?: boolean;
  shouldHideResultsUntilClose?: boolean;
  isCreator?: boolean;
  isRestrictedToSubscribers?: boolean;
  allowedCountryCodes?: string[];
  closePeriod?: number;
  closeDate?: number;
  results: {
    totalVoters: number;
    answers: { option: string; voters: number; isChosen: boolean; isCorrect: boolean }[];
    solution: string | null;
    solutionEntities?: unknown[];
  } | null;
}

/** Кто голосовал в публичном опросе */
export interface PollVotesDto {
  count: number;
  nextOffset: string | null;
  votes: (PeerBriefDto & { date: number })[];
}

/** Пункт чек-листа: номер не меняется при правке списка */
export interface TodoItemDto {
  id: number;
  title: string;
  entities: unknown[];
}

/** Стикер, найденный по описанию (Telegram 2026) */
export interface StickerSearchDto {
  accountId: string;
  stickers: CatalogDocumentDto[];
  nextOffset: number | null;
}

/** GIF, найденные через @gif */
export interface GifSearchDto {
  accountId: string;
  gifs: CatalogDocumentDto[];
  nextOffset: string | null;
}

/** Чек-лист сообщения (Telegram 2026) */
export interface TodoDto {
  title: string;
  titleEntities: unknown[];
  items: TodoItemDto[];
  othersCanAppend?: boolean;
  othersCanComplete?: boolean;
  completions?: { itemId: number; completedBy: number; date: number }[];
}

/** Встроенный стиль AI-редактора */
export interface AiToneDto {
  tone: string;
  title: string;
  emojiId: string | null;
}

export interface AiTonesDto {
  hash: string | null;
  tones: AiToneDto[];
}

/** Результат AI-редактора: текст с разметкой; у исправления — готовая разница */
export interface AiComposedDto {
  text: string;
  entities: unknown[];
  diffText?: { text: string; entities: unknown[] };
}

export interface MessageDto {
  permissions?: Permissions;
  /** Speech-to-text of a voice or round message; pending — Telegram is still recognizing it */
  transcription?: { id: string; text: string; pending: boolean } | null;
  isMediaUnavailable?: boolean;
  accountId: string;
  peerId: number;
  msgId: number;
  topicId: number | null;
  senderId: number | null;
  date: string;
  editDate: string | null;
  text: string;
  entities: unknown[];
  media: MediaSummaryDto | null;
  /** Заголовок ответа в виде TL (messageReplyHeader); сообщение темы форума отвечает на её первое сообщение */
  replyTo: { replyToMsgId?: number; replyToTopId?: number; forumTopic?: boolean; quoteText?: string } | null;
  fwdFrom: unknown;
  /** Реакции в виде TL (messageReactions) */
  reactions: { results?: ReactionCountDto[]; recentReactions?: PeerReactionDto[]; canSeeList?: boolean } | null;
  /** The guest's own message got a reaction the guest has not seen yet */
  hasUnreadReaction?: boolean;
  /** Profiles of those who reacted last */
  reactors?: PeerBriefDto[];
  groupedId: string | null;
  isOutgoing: boolean;
  isPost: boolean;
  isService: boolean;
  ttlExpiresAt: string | null;
  version: number;
  changeSeq: string;
  /** byName — кто из гостей удалил; только в надгробиях для владельца */
  deleted: { at: string; reason: 'delegate' | 'external'; byName?: string | null } | null;
  /** Пересланное: имя автора оригинала */
  forwardName?: string | null;
  /** Встроенные кнопки бота; data и варианты опроса — base64, гость отправляет их обратно серверу */
  buttons?: InlineButtonDto[][];
  poll?: PollDto;
  /** Чек-лист Telegram 2026 */
  todo?: TodoDto;
  /** Форматированный текст Telegram 2026: блоки в том же виде, что понимает Web A */
  richMessage?: { blocks: Record<string, unknown>[]; isRtl?: boolean };
  sentByUserId: string | null;
  /** The name of that guest */
  sentByName?: string | null;
  /** Имя отправителя, если аккаунт его знает (участник группы, собеседник) */
  senderName?: string | null;
  /** ID фото профиля отправителя — аватар через media.avatar */
  senderPhotoId?: string | null;
  senderBadges?: PeerBadgesDto | null;
  /** Служебное сообщение: что произошло */
  action?: ServiceActionDto;
  /** Pinned in the chat */
  isPinned?: boolean;
  /** Counters and signature of a channel post, as of the last archive write */
  post?: {
    views?: number;
    forwards?: number;
    author?: string;
    /** Comments the guest can see */
    replies?: number;
    /** The discussion group, only when it is shared with the guest too */
    commentsPeerId?: number;
    lastReplyId?: number;
    /** The guest has read the thread before and new comments came since */
    hasUnreadComments?: boolean;
    /** The latest distinct commenters, newest first */
    recentRepliers?: PeerBriefDto[];
  };
  /** Link preview; its picture is not served to guests yet */
  webPage?: { url: string; displayUrl: string; siteName?: string; title?: string; description?: string };
  /** Telegram's own content protection: the message cannot be forwarded, copied or saved */
  isProtected?: boolean;
  isSilent?: boolean;
  effectId?: string;
  /** Telegram can summarize this message; the original language */
  summaryLanguage?: string;
  /** The author's label in a group */
  senderRank?: string;
  /** Sent through an inline bot */
  viaBot?: { peerId: number; username: string };
  /** The owner was mentioned, and the guest has not read it yet */
  hasUnreadMention?: boolean;
  attachment?: AttachmentDto;
}

/** A scheduled message: it reaches the archive when Telegram sends it */
export interface ScheduledMessageDto {
  msgId: number;
  date: number;
  text: string;
  entities: unknown[];
  mediaKind: string | null;
  fileName: string | null;
  replyToMsgId: number | null;
  topicId: number | null;
  /** Repeats with this period, seconds */
  repeatPeriod: number | null;
}

/** An attachment without a file; the ones a guest cannot open come with their kind only */
export type AttachmentDto =
  | { type: 'geo'; lat: number; long: number; accuracyRadius?: number }
  | {
    type: 'venue'; lat: number; long: number; accuracyRadius?: number; title: string; address: string;
    provider: string; venueId: string; venueType: string;
  }
  | { type: 'geoLive'; lat: number; long: number; accuracyRadius?: number; heading?: number; period: number }
  | { type: 'contact'; firstName: string; lastName: string; phoneNumber: string; userId: number }
  | { type: 'dice'; emoji: string; value: number }
  | { type: 'game'; title: string; description: string }
  | { type: 'other'; kind: AttachmentKind };

export type AttachmentKind = 'giveaway' | 'story' | 'invoice' | 'paidMedia' | 'todo' | 'unknown';

export interface ActionUserDto {
  id: number;
  name: string | null;
}

export type ServiceActionDto =
  | { type: 'chatCreate'; title: string; users: ActionUserDto[] }
  | { type: 'channelCreate'; title: string }
  | { type: 'chatEditTitle'; title: string }
  | { type: 'chatEditPhoto' }
  | { type: 'chatDeletePhoto' }
  | { type: 'chatAddUser'; users: ActionUserDto[] }
  | { type: 'chatDeleteUser'; users: ActionUserDto[] }
  | { type: 'chatJoinedByLink'; users: ActionUserDto[] }
  | { type: 'chatJoinedByRequest' }
  | { type: 'channelMigrateFrom'; title: string; chatId: number | null }
  | { type: 'chatMigrateTo'; channelId: number }
  | { type: 'noForwardsToggle'; prevValue: boolean; newValue: boolean }
  | { type: 'pinMessage' }
  | { type: 'historyClear' }
  | { type: 'setMessagesTtl'; period: number }
  | { type: 'contactSignUp' }
  | { type: 'screenshotTaken' }
  | { type: 'customAction'; message: string }
  | { type: 'phoneCall'; isVideo: boolean; duration: number | null; reason: string | null }
  | { type: 'topicCreate'; title: string; iconColor: number; iconEmojiId: string | null }
  | {
    type: 'topicEdit';
    title: string | null;
    iconEmojiId: string | null;
    isClosed: boolean | null;
    isHidden: boolean | null;
  }
  /** Открытый опрос: участник предложил или удалил вариант (Telegram 2026) */
  | { type: 'pollAppendAnswer'; answer: { text: string; option: string } }
  | { type: 'pollDeleteAnswer'; answer: { text: string; option: string } }
  /** Чек-лист: пункты отметили или добавили (Telegram 2026) */
  | { type: 'todoCompletions'; completedIds: number[]; incompletedIds: number[] }
  | { type: 'todoAppendTasks'; items: TodoItemDto[] }
  | { type: 'unsupported' };

/** Тема форума; lastMsgId — последнее видимое гостю сообщение темы */
export interface TopicDto {
  permissions?: Permissions;
  /** The guest's own topic mute, unix seconds; 0 — notify even in a muted chat, null — as the whole chat */
  mutedUntil?: number | null;
  id: number;
  title: string;
  iconColor: number | null;
  iconEmojiId: string | null;
  isClosed: boolean;
  isPinned: boolean;
  isHidden: boolean;
  date: string;
  lastMsgId: number | null;
  isDeleted: boolean;
  /** Свои счётчики гостя */
  unreadCount: number;
  unreadMentionsCount: number;
  unreadReactionsCount: number;
  readMaxId: number;
  /** Up to where others read the account's outgoing messages in this topic */
  readOutboxMaxId?: number | null;
}

/** Свои счётчики непрочитанного гостя по открытому ему чату */
export interface ChatUnreadDto {
  accountId: string;
  peerId: number;
  unreadCount: number;
  readMaxId: number;
  /** The guest marked the chat unread on their own */
  hasUnreadMark: boolean;
  unreadMentionsCount: number;
  unreadReactionsCount: number;
}

/** Where a message of Saved Messages came from: a snapshot taken when it was saved */
export interface SavedOriginDto {
  accountId: string;
  peerId: number;
  msgId: number;
  chatTitle: string | null;
  senderName: string | null;
  date: string;
}

/** A message of the guest's own Saved Messages (packages/protocol SavedMessageDto) */
export interface SavedMessageDto {
  id: number;
  date: string;
  editDate: string | null;
  text: string;
  entities: unknown[];
  media: MessageDto['media'];
  isMediaPending?: boolean;
  groupedId: string | null;
  isPinned: boolean;
  tags: string[];
  origin: SavedOriginDto | null;
  poll?: MessageDto['poll'];
  webPage?: MessageDto['webPage'];
  attachment?: MessageDto['attachment'];
}

/** A message of the owner's chat hidden from guests: from all of them or from these people */
export interface HiddenMessageDto {
  msgId: number;
  all: boolean;
  users: { id: string; name: string }[];
}

export interface SavedTagDto {
  tag: string;
  title: string | null;
  count: number;
}

export interface SavedDialogDto {
  origin: {
    accountId: string;
    peerId: number;
    chatTitle: string | null;
    peerType: 'user' | 'bot' | 'chat' | 'channel' | 'megagroup' | 'forum' | null;
  } | null;
  count: number;
  lastId: number;
  lastDate: string;
}

export interface DraftDto {
  accountId: string;
  peerId: number;
  topicId: number | null;
  text: string;
  entities: ApiMessageEntity[];
  replyToMsgId: number | null;
  date: number;
}

/** Comments of a channel post: a thread of replies to the post's copy in the discussion group */
export interface DiscussionDto {
  peerId: number;
  threadId: number;
  /** The copy of the post the thread starts with; an album brings all its parts */
  messages: MessageDto[];
  count: number;
  lastMsgId: number | null;
  /** Up to where others read the account's outgoing comments in this thread */
  readOutboxMaxId?: number | null;
  /** Up to where the guest read the thread; null until the first reading */
  readMaxId?: number | null;
  /** Incoming comments past the guest's pointer, all of them before the first reading */
  unreadCount?: number;
}

export interface TopicsListResult {
  topics: TopicDto[];
  messages: MessageDto[];
  count: number;
}

/** Краткое описание вложения из архива (packages/tg, summarizeMedia) */
export interface MediaSummaryDto {
  kind: string;
  key: string;
  /** Telegram ID of the file; media without a file (polls, previews, locations) has none */
  id?: string;
  mimeType?: string;
  size?: number;
  fileName?: string;
  flags?: string[];
  width?: number;
  height?: number;
  duration?: number;
}

export interface ReactionCountDto {
  reaction: { _: string; emoticon?: string; documentId?: string; paid?: boolean };
  count: number;
  /** Есть — значит, эту реакцию поставил владелец аккаунта */
  chosenOrder?: number;
}

/** A page of "who reacted", as the owner sees it in Telegram */
export interface ReactorsDto {
  count: number;
  nextOffset: string | null;
  reactions: (PeerBriefDto & {
    reaction: { emoticon?: string; documentId?: string };
    date: number;
    isBig: boolean;
    isOwn: boolean;
  })[];
}

/** A reaction as Telegram sends it, newest first; a channel has no `userId` */
export interface PeerReactionDto {
  peerId: { userId?: number };
  reaction: ReactionCountDto['reaction'];
  date: number;
  big?: boolean;
}

export interface AttributionDto {
  msgId: number;
  userId: string;
  name: string;
  tgUserId?: number;
  username?: string | null;
  date?: string;
  share?: {
    id: string;
    scope: 'chat' | 'topic' | 'folder';
    label: string | null;
    topicId: number | null;
    folderId: number | null;
  } | null;
}

export interface CatalogDocumentDto {
  id: string;
  kind: 'sticker' | 'gif' | 'emoji' | 'reaction' | 'inline';
  setId: string | null;
  emoji: string | null;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  /** A custom emoji recolored to the text color */
  textColor: boolean;
  isFree?: boolean;
  /** A Premium sticker with a full-screen animation */
  hasEffect?: boolean;
}

export type ReactionAnimation = 'staticIcon' | 'appearAnimation' | 'selectAnimation' | 'activateAnimation'
  | 'effectAnimation' | 'aroundAnimation' | 'centerIcon';

/** Telegram's reaction with its animations, read by the provider's account */
export type AvailableReactionDto = {
  emoticon: string;
  title: string;
  isInactive: boolean;
  isPremium: boolean;
} & Partial<Record<ReactionAnimation, CatalogDocumentDto>>;

export interface AvailableReactionsDto {
  accountId: string;
  reactions: AvailableReactionDto[];
}

export interface AvailableEffectDto {
  id: string;
  emoticon: string;
  isPremium: boolean;
  staticIcon?: CatalogDocumentDto;
  effectSticker: CatalogDocumentDto;
  effectAnimation?: CatalogDocumentDto;
}

export interface CatalogSetDto {
  id: string;
  title: string;
  shortName: string;
  count: number;
  thumbDocumentId: string | null;
  /** The version of the set's contents: when it matches the stored one, stickers.set is not needed */
  hash: string;
}

/** Стикеры и GIF владельца аккаунта, которые гость может отправлять (право useOwnerStickers) */
export interface StickerCatalogDto {
  accountId: string;
  /** Premium of the owner's account: only then a guest sends custom emoji */
  isPremium: boolean;
  sets: CatalogSetDto[];
  /** The owner's custom emoji packs; empty without Premium */
  emojiSets: CatalogSetDto[];
  recent: CatalogDocumentDto[];
  faved: CatalogDocumentDto[];
  gifs: CatalogDocumentDto[];
}

export interface HashedResult<T> {
  hash: string;
  /** Absent when the contents match the hash of the request */
  data?: T;
}

export interface SponsoredMessageDto {
  randomId: string;
  title: string;
  text: string;
  entities: unknown[];
  url: string;
  buttonText: string;
  sponsorInfo: string | null;
  additionalInfo: string | null;
  isRecommended: boolean;
}

export interface ArchiveSearchResult {
  count: number;
  messages: {
    peerId: number;
    peerTitle: string | null;
    msgId: number;
    date: string;
    text: string;
    mediaKind: string | null;
    version: number;
    deletedAt: string | null;
  }[];
}

export interface ReactionLogEntryDto {
  at: string;
  reaction: { emoji: string } | { documentId: string } | null;
  isRemoved: boolean;
  guestName: string | null;
  peerName: string | null;
}

export interface VersionFileDto {
  kind: string;
  fileName?: string;
}

export interface MessageVersionDto {
  version: number;
  text: string;
  media: VersionFileDto | null;
  /** The next version's file, when it differs; on the last row it is the current file */
  replacedBy: VersionFileDto | null;
  editDate: string | null;
  capturedAt: string;
}

export interface AccountDto {
  id: string;
  tgUserId: number | null;
  displayName: string | null;
  status: 'connecting' | 'active' | 'paused' | 'auth_lost' | 'flood' | 'revoked';
  statusReason: string | null;
  connectedAt: string | null;
  /** The last change in this account's archive */
  lastMessageAt?: string | null;
  thinMode: boolean;
  importState: ImportStateDto | null;
}

/** Импорт истории после подключения: сколько чатов обработано */
export interface ImportStateDto {
  status: 'running' | 'done';
  doneCount: number;
  total: number;
  imported: number;
}

export interface SrpChallengeDto {
  srpId: string;
  srpB: string;
  salt1: string;
  salt2: string;
  g: number;
  p: string;
  hint: string | null;
}

export type ConnectStepDto =
  | { status: 'token'; token: string; expiresAt: string }
  | { status: 'password'; password: SrpChallengeDto; invalid: boolean }
  | { status: 'waiting' }
  | { status: 'connected'; account: { id: string; tgUserId: number; displayName: string } };

export interface UserLookup {
  registered: boolean;
  knownToBot: boolean;
  /** `isPending`: the account was created in advance and the person has not signed in yet */
  user: { id: string; tgUserId: number; username: string | null; firstName: string | null; isPending: boolean } | null;
  /** Not signed in yet, but their Telegram ID is known, so access can be opened in advance */
  candidate?: GuestCandidate | null;
}

export interface GuestCandidate {
  tgUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export type AdminTopic = 'presence' | 'sessions' | 'users' | 'accounts' | 'shares' | 'outbox' | 'requests';

/** Запрос доступа в админке: владелец, аккаунт и контекст видны только администратору */
export interface AdminAccessRequestDto {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  requester: { id: string; tgUserId: number; name: string; username: string | null };
  ownerName: string;
  ownerUserId: string;
  accountName: string | null;
  accountId: string | null;
  peerId: number | null;
  peerTitle: string | null;
  query: string | null;
  originTitle: string | null;
  reason: string | null;
  shareId: string | null;
  createdAt: string;
  decidedAt: string | null;
  context: { commonGroups: number; hasChat: boolean } | null;
}

/** Named as Web A names its typing statuses */
export type TypingActionDto = Exclude<ApiTypingStatus['type'], 'watchingAnimations'> | 'cancel';

export interface ChatTypingDto {
  accountId: string;
  peerId: number;
  topicId?: number;
  userId: number;
  name: string | null;
  action: TypingActionDto;
}

export interface UserStatusDto {
  type: 'online' | 'offline' | 'recently' | 'lastWeek' | 'lastMonth' | 'empty';
  expires?: number;
  wasOnline?: number;
}

export type ServerEvent =
  | { e: 'draft.changed'; d: { accountId: string; peerId: number; topicId: number | null; draft: DraftDto | null } }
  | { e: 'chat.typing'; d: ChatTypingDto }
  | { e: 'chat.readOutbox'; d: { accountId: string; peerId: number; maxId: number; threadId?: number } }
  | { e: 'user.status'; d: { accountId: string; userId: number; status: UserStatusDto } }
  | {
    e: 'archive.change';
    d: { accountId: string; peerId: number; msgId: number; kind: string; changeSeq?: string | null };
  }
  | { e: 'access.changed'; d: Record<string, never> }
  | { e: 'outbox.done'; d: OutboxDoneDto }
  | { e: 'admin.changed'; d: { topics: AdminTopic[] } }
  | { e: 'session.revoked'; d: Record<string, never> }
  | { e: 'accounts.changed'; d: { accountId: string; status: AccountDto['status'] } }
  | { e: 'topics.changed'; d: { accountId: string; peerId: number } }
  | {
    e: 'read.changed';
    d: { accountId: string; peerId: number; topicId: number | null; threadId?: number; maxId?: number };
  }
  | { e: 'share.expiring'; d: { target: string; expiresAt: string } }
  | { e: 'saved.changed'; d: Record<string, never> }
  | { e: 'hidden.changed'; d: { accountId: string; peerId: number } }
  | { e: 'requests.changed'; d: Record<string, never> }
  | { e: 'share.granted'; d: { accountId: string; peerId: number | null; target: string; from: string } }
  | { e: 'guest.burst'; d: { accountId: string; guestName: string; reason: GuestBurstReason } }
  | { e: 'chats.state'; d: ChatStateDto }
  | { e: 'folders.changed' | 'settings.changed' | 'shares.changed'; d: Record<string, never> };

/** Итог действия из очереди сервера; приходит только тому, кто его запросил */
export interface OutboxDoneDto {
  id: string;
  accountId: string;
  kind: 'send' | 'edit' | 'delete' | 'react' | 'forward' | 'callback' | 'vote' | 'read' | 'typing' | 'history'
    | 'pin' | 'admin' | 'scheduled' | 'transcribe' | 'translate' | 'seenBy' | 'reactors' | 'sendAs';
  /** delayed — Telegram попросил подождать (FLOOD_WAIT), итог придёт позже */
  status: 'done' | 'failed' | 'delayed';
  /** delayed: через сколько секунд повтор */
  retryInSeconds?: number;
  /** history: { imported, complete } */
  result: unknown;
  error: string | null;
  peerId: number;
}

export type ReachablePerson = {
  accountId: string;
  tgUserId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoId: string | null;
  hasChat: boolean;
  /** Доступ разрешает написать первой */
  canStartChats: boolean;
  sources: { peerId: number; title: string | null; scope: 'chat_members' | 'folder_members' }[];
};

export type ReachablePage = {
  people: ReachablePerson[];
  total: number;
};

export class PxgError extends Error {
  readonly code: string;

  /** Why the server refused (packages/protocol/src/errors.ts): the text comes from the client's strings */
  readonly reason?: string;

  readonly params?: Record<string, string | number>;

  constructor(code: string, message?: string, reason?: string, params?: Record<string, string | number>) {
    super(message ?? code);
    this.code = code;
    this.reason = reason;
    this.params = params;
  }
}
