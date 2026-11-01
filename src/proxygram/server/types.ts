// Зеркало типов из packages/protocol: клиент живёт вне pnpm workspace и не тянет zod.
// Меняя протокол на сервере — поменяйте и здесь.

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
  | 'markRead' | 'typing' | 'seePhones' | 'admin';

export type Permissions = Record<PermissionKey, boolean>;

export type PresetKey = 'readOnly' | 'assistant' | 'full';

export interface AccessChat {
  accountId: string;
  peerId: number;
  title: string | null;
  username: string | null;
  type: 'user' | 'bot' | 'chat' | 'channel' | 'megagroup' | 'forum' | null;
  /** ID текущего фото чата или собеседника; сам аватар — через media.avatar */
  photoId: string | null;
  permissions: Permissions;
  shareIds: string[];
  /** Только архив: чат пропал у владельца, аккаунт недоступен или Telegram ограничил отправку */
  restricted: AccessRestriction | null;
  /** Гость заглушил чат у себя, unix-секунды */
  mutedUntil: number | null;
}

export type AccessRestriction = 'source_lost' | 'account_unavailable' | 'flood';

export type InlineButtonDto =
  | { kind: 'callback'; text: string; data: string }
  | { kind: 'url'; text: string; url: string }
  | { kind: 'unsupported'; text: string };

export interface PollDto {
  id: string;
  question: string;
  questionEntities: unknown[];
  answers: { text: string; option: string }[];
  isClosed: boolean;
  isPublic: boolean;
  isMultipleChoice: boolean;
  isQuiz: boolean;
  results: {
    totalVoters: number;
    answers: { option: string; voters: number; isChosen: boolean; isCorrect: boolean }[];
    solution: string | null;
  } | null;
}

export interface MessageDto {
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
  reactions: { results?: ReactionCountDto[] } | null;
  groupedId: string | null;
  isOutgoing: boolean;
  isPost: boolean;
  isService: boolean;
  ttlExpiresAt: string | null;
  version: number;
  changeSeq: string;
  deleted: { at: string; reason: 'delegate' | 'external' } | null;
  /** Пересланное: имя автора оригинала */
  forwardName?: string | null;
  /** Встроенные кнопки бота; data и варианты опроса — base64, гость отправляет их обратно серверу */
  buttons?: InlineButtonDto[][];
  poll?: PollDto;
  sentByUserId: string | null;
  /** Имя отправителя, если аккаунт его знает (участник группы, собеседник) */
  senderName?: string | null;
  /** ID фото профиля отправителя — аватар через media.avatar */
  senderPhotoId?: string | null;
  /** Служебное сообщение: что произошло */
  action?: ServiceActionDto;
}

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
  | { type: 'channelMigrateFrom'; title: string }
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
  | { type: 'unsupported' };

/** Тема форума; lastMsgId — последнее видимое гостю сообщение темы */
export interface TopicDto {
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
  readMaxId: number;
}

/** Свои счётчики непрочитанного гостя по открытому ему чату */
export interface ChatUnreadDto {
  accountId: string;
  peerId: number;
  unreadCount: number;
  readMaxId: number;
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
  reaction: { _: string; emoticon?: string; documentId?: string };
  count: number;
  /** Есть — значит, эту реакцию поставил владелец аккаунта */
  chosenOrder?: number;
}

export interface AttributionDto {
  msgId: number;
  userId: string;
  name: string;
}

export interface CatalogDocumentDto {
  id: string;
  kind: 'sticker' | 'gif';
  setId: string | null;
  emoji: string | null;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface CatalogSetDto {
  id: string;
  title: string;
  shortName: string;
  count: number;
  thumbDocumentId: string | null;
}

/** Стикеры и GIF владельца аккаунта, которые гость может отправлять (право useOwnerStickers) */
export interface StickerCatalogDto {
  accountId: string;
  sets: CatalogSetDto[];
  recent: CatalogDocumentDto[];
  faved: CatalogDocumentDto[];
  gifs: CatalogDocumentDto[];
}

export interface MessageVersionDto {
  version: number;
  text: string;
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
  user: { id: string; tgUserId: number; username: string | null; firstName: string | null } | null;
}

export type AdminTopic = 'presence' | 'sessions' | 'users' | 'accounts' | 'shares' | 'outbox';

export type ServerEvent =
  | { e: 'archive.change'; d: { accountId: string; peerId: number; msgId: number; kind: string } }
  | { e: 'access.changed'; d: Record<string, never> }
  | { e: 'outbox.done'; d: OutboxDoneDto }
  | { e: 'admin.changed'; d: { topics: AdminTopic[] } }
  | { e: 'session.revoked'; d: Record<string, never> }
  | { e: 'accounts.changed'; d: { accountId: string; status: AccountDto['status'] } }
  | { e: 'topics.changed'; d: { accountId: string; peerId: number } }
  | { e: 'read.changed'; d: { accountId: string; peerId: number; topicId: number | null } };

/** Итог действия из очереди сервера; приходит только тому, кто его запросил */
export interface OutboxDoneDto {
  id: string;
  accountId: string;
  kind: 'send' | 'edit' | 'delete' | 'react' | 'read' | 'typing' | 'history';
  status: 'done' | 'failed';
  /** history: { imported, complete } */
  result: unknown;
  error: string | null;
  peerId: number;
}

export class PxgError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}
