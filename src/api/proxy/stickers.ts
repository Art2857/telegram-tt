import type {
  AvailableEffectDto, AvailableReactionsDto, CatalogDocumentDto, CatalogSetDto, GifSearchDto, HashedResult,
  InlineResultDto, ReactionAnimation, StickerCatalogDto, StickerSearchDto,
} from '../../proxygram/server/types';
import type { MethodArgs } from '../gramjs/methods/types';
import type {
  ApiAvailableEffect, ApiAvailableReaction, ApiBotInlineMediaResult, ApiBotInlineResult, ApiChat, ApiDocument,
  ApiInlineResultType, ApiSticker, ApiStickerSet, ApiVideo,
} from '../types';
import { PROXY_REACTION_EMOJIS } from './types';

import {
  pruneStoredSets, readStored, readStoredSet, saveStored, saveStoredSet,
} from '../../proxygram/server/catalogCache';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { resolveProxyPeer } from './index';
import { buildProxyCatalogMediaId, parseProxyCatalogId } from './mediaIds';

const REACTION_ANIMATIONS: ReactionAnimation[] = [
  'staticIcon', 'appearAnimation', 'selectAnimation', 'activateAnimation', 'effectAnimation', 'aroundAnimation',
  'centerIcon',
];

const CATALOG_TTL_MS = 60_000;
const SET_ID_PREFIX = 'pxgset_';
const PROXY_SET_ID = /^pxgset_([0-9a-f-]{36})_(\d+)$/;
const EMPTY_HASH = '0';
const DEFAULT_RESULT_SIZE = 512;

let cached: { userId: string; at: number; catalog: Promise<StickerCatalogDto[]> } | undefined;

/**
 * Chat used for Telegram-wide sticker and GIF search: the global search needs the owner's session,
 * and the proxy has no chat of its own. The first open chat with the owner's stickers wins, otherwise any writable one
 */
let stickerSearchChat: { accountId: string; peerId: number } | undefined;
let gifSearchChat: { accountId: string; peerId: number } | undefined;

export function rememberSearchChat(chat: ApiChat) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  const permissions = chat.pxgProxy?.permissions;
  if (!permissions) return;
  if (!gifSearchChat && permissions.write) gifSearchChat = { accountId: peer.accountId, peerId: peer.peerId };
  if (!stickerSearchChat && permissions.useOwnerStickers) {
    stickerSearchChat = { accountId: peer.accountId, peerId: peer.peerId };
  }
}

/** После перезагрузки доступов или смены гостя старый чат поиска может быть уже недоступен */
export function resetSearchChats() {
  stickerSearchChat = undefined;
  gifSearchChat = undefined;
}

/** One request feeds the sticker panel, recent, favorite and GIF tabs opened together */
function getCatalog(): Promise<StickerCatalogDto[]> {
  const userId = getPxgState().session?.user.id;
  if (!userId) return Promise.resolve([]);
  if (cached?.userId !== userId || Date.now() - cached.at > CATALOG_TTL_MS) {
    const catalog = loadCatalog(userId);
    cached = { userId, at: Date.now(), catalog };
    catalog.catch(() => {
      if (cached?.catalog === catalog) cached = undefined;
    });
  }
  return cached.catalog;
}

/** The server compares hashes under the guest's current rights, so stored data never outlives them */
async function loadHashed<T>(userId: string, method: string) {
  const stored = await readStored<T>(userId, method);
  const { hash, data } = await pxgRpc.call<HashedResult<T>>(method, { hash: stored?.hash });
  if (data === undefined) return stored?.data;
  void saveStored(userId, method, { hash, data });
  return data;
}

async function loadCatalog(userId: string) {
  const catalogs = await loadHashed<StickerCatalogDto[]>(userId, 'stickers.catalog') || [];
  void pruneStoredSets(userId, catalogs);
  return catalogs;
}

async function loadSetDocuments(userId: string, accountId: string, { id: setId, hash }: CatalogSetDto) {
  const stored = await readStoredSet(userId, accountId, setId);
  if (stored?.hash === hash) return stored.data;
  const documents = await pxgRpc.call<CatalogDocumentDto[]>('stickers.set', { accountId, setId });
  void saveStoredSet(userId, accountId, setId, { hash, data: documents });
  return documents;
}

export function buildProxyStickerSetId(accountId: string, setId: string) {
  return `${SET_ID_PREFIX}${accountId}_${setId}`;
}

export function parseProxyStickerSetId(id: string) {
  const match = id.match(PROXY_SET_ID);
  return match ? { accountId: match[1], setId: match[2] } : undefined;
}

export async function fetchStickerSets() {
  const catalogs = await getCatalog();
  const sets = catalogs.flatMap(({ accountId, sets: items }) => items.map((set) => buildStickerSet(accountId, set)));
  return { hash: EMPTY_HASH, sets };
}

/** The owner's emoji packs, only for a Premium owner: otherwise Telegram turns custom emoji into plain ones */
export async function fetchCustomEmojiSets() {
  const catalogs = await getCatalog();
  const sets = catalogs.flatMap(({ accountId, emojiSets }) => (
    emojiSets.map((set) => buildStickerSet(accountId, set, undefined, true))
  ));
  return { hash: EMPTY_HASH, sets };
}

/** Custom emoji of shared messages: the provider's account reads the documents, grouped by account */
export async function fetchCustomEmoji({ documentId: ids }: MethodArgs<'fetchCustomEmoji'>[0]) {
  const userId = getPxgState().session?.user.id;
  if (!userId) return undefined;
  const idsByAccount = new Map<string, Map<string, string>>();
  ids.forEach((id) => {
    const parsed = parseProxyCatalogId(id);
    if (parsed?.userId !== userId) return;
    if (!idsByAccount.has(parsed.accountId)) idsByAccount.set(parsed.accountId, new Map());
    idsByAccount.get(parsed.accountId)!.set(parsed.documentId, id);
  });
  const results = await Promise.all([...idsByAccount].map(async ([accountId, byDocumentId]) => {
    try {
      const documents = await pxgRpc.call<CatalogDocumentDto[]>('stickers.customEmoji', {
        accountId, documentIds: [...byDocumentId.keys()],
      });
      return documents.map((doc) => buildCustomEmoji(accountId, doc, byDocumentId.get(doc.id)!));
    } catch {
      // Emoji of a revoked or unavailable account stay as their fallback characters
      return [];
    }
  }));
  return results.flat();
}

export async function fetchRecentStickers() {
  const catalogs = await getCatalog();
  return { hash: EMPTY_HASH, stickers: catalogs.flatMap(({ accountId, recent }) => buildStickers(accountId, recent)) };
}

export async function fetchFavoriteStickers() {
  const catalogs = await getCatalog();
  return { hash: EMPTY_HASH, stickers: catalogs.flatMap(({ accountId, faved }) => buildStickers(accountId, faved)) };
}

export async function fetchSavedGifs() {
  const catalogs = await getCatalog();
  return {
    hash: EMPTY_HASH,
    gifs: catalogs.flatMap(({ accountId, gifs }) => gifs.map((doc) => buildProxyGif(accountId, doc))),
  };
}

export async function fetchStickers({ stickerSetInfo }: MethodArgs<'fetchStickers'>[0]) {
  const parsed = 'id' in stickerSetInfo ? parseProxyStickerSetId(stickerSetInfo.id) : undefined;
  const userId = getPxgState().session?.user.id;
  if (!parsed || !userId) return undefined;
  const catalogs = await getCatalog();
  const catalog = catalogs.find((item) => item.accountId === parsed.accountId);
  const emojiSet = catalog?.emojiSets.find((item) => item.id === parsed.setId);
  const set = emojiSet || catalog?.sets.find((item) => item.id === parsed.setId);
  if (!set) return undefined;
  const documents = await loadSetDocuments(userId, parsed.accountId, set);
  const stickers = buildStickers(parsed.accountId, documents);
  const packs: Record<string, ApiSticker[]> = {};
  stickers.forEach((sticker) => {
    if (sticker.emoji) (packs[sticker.emoji] ||= []).push(sticker);
  });
  return { set: buildStickerSet(parsed.accountId, set, stickers, Boolean(emojiSet)), stickers, packs };
}

/** Emoji suggestions come from the owner's catalog: Telegram's global search needs the owner's session */
export async function fetchStickersForEmoji({ emoji }: MethodArgs<'fetchStickersForEmoji'>[0]) {
  const catalogs = await getCatalog();
  const stickers = catalogs.flatMap(({ accountId, recent, faved }) => (
    buildStickers(accountId, [...faved, ...recent].filter((doc) => doc.emoji === emoji))
  ));
  return { stickers, hash: EMPTY_HASH };
}

/** Найденные по описанию стикеры и кастомные эмодзи (Telegram 2026): файлы отдаёт каталог владельца */
export async function searchStickersGlobal({
  query, emoticon, langCode, offset, isEmoji,
}: MethodArgs<'searchStickersGlobal'>[0]) {
  if (!stickerSearchChat) return undefined;
  const result = await pxgRpc.call<StickerSearchDto>('stickers.search', {
    ...stickerSearchChat,
    query,
    emoticon: emoticon || undefined,
    offset: offset ?? 0,
    isEmoji: isEmoji || undefined,
    langCode,
  }).catch(() => undefined);
  if (!result) return undefined;
  return {
    stickers: buildStickers(result.accountId, result.stickers),
    nextOffset: result.nextOffset ?? undefined,
  };
}

/** GIF из @gif от имени владельца: как сам инлайн-бот, только файлы идут через каталог */
export async function searchGifs({ query, offset }: MethodArgs<'searchGifs'>[0]) {
  const chat = gifSearchChat ?? stickerSearchChat;
  if (!chat) return undefined;
  const result = await pxgRpc.call<GifSearchDto>('stickers.searchGifs', {
    ...chat, query, offset,
  }).catch(() => undefined);
  if (!result) return undefined;
  return {
    gifs: result.gifs.map((doc) => buildProxyGif(result.accountId, doc)),
    nextOffset: result.nextOffset ?? undefined,
  };
}

/**
 * Telegram's reactions with their animations, read by a provider's account. Until one has read them,
 * a short list of plain emoji keeps reactions usable
 */
export async function fetchAvailableReactions(): Promise<ApiAvailableReaction[]> {
  const userId = getPxgState().session?.user.id;
  const result = userId
    ? await loadHashed<AvailableReactionsDto | null>(userId, 'reactions.available').catch(() => undefined)
    : undefined;
  if (!userId || !result?.reactions.length) return buildFallbackReactions();
  return result.reactions.map((reaction): ApiAvailableReaction => ({
    reaction: { type: 'emoji', emoticon: reaction.emoticon },
    title: reaction.title,
    isInactive: reaction.isInactive || undefined,
    isPremium: reaction.isPremium || undefined,
    ...Object.fromEntries(REACTION_ANIMATIONS.flatMap((animation) => {
      const doc = reaction[animation];
      return doc ? [[animation, buildCatalogDocument(userId, result.accountId, doc)]] : [];
    })),
  }));
}

/** Message effects: the list is the same for every account, the files come through one the guest can reach */
export async function fetchAvailableEffects() {
  const userId = getPxgState().session?.user.id;
  const result = userId
    ? await loadHashed<{ accountId: string; effects: AvailableEffectDto[] } | null>(userId, 'reactions.effects')
      .catch(() => undefined)
    : undefined;
  if (!userId || !result) return undefined;
  const { accountId } = result;
  const buildId = (doc?: CatalogDocumentDto) => doc && buildProxyCatalogMediaId(userId, accountId, doc.id);
  const buildEffectSticker = (doc: CatalogDocumentDto, isPremium: boolean): ApiSticker => ({
    mediaType: 'sticker',
    id: buildId(doc)!,
    stickerSetInfo: { isMissing: true },
    emoji: doc.emoji || undefined,
    isFree: !isPremium,
    hasEffect: doc.hasEffect || undefined,
    isLottie: doc.mimeType === 'application/x-tgsticker',
    isVideo: doc.mimeType === 'video/webm',
    width: doc.width || undefined,
    height: doc.height || undefined,
  });
  return {
    effects: result.effects.map((effect): ApiAvailableEffect => ({
      id: effect.id,
      emoticon: effect.emoticon,
      isPremium: effect.isPremium || undefined,
      staticIconId: buildId(effect.staticIcon),
      effectAnimationId: buildId(effect.effectAnimation),
      effectStickerId: buildId(effect.effectSticker)!,
    })),
    emojis: result.effects.flatMap(({ effectAnimation, isPremium }) => (
      effectAnimation ? [buildEffectSticker(effectAnimation, isPremium)] : []
    )),
    stickers: result.effects.flatMap(({ effectAnimation, effectSticker, isPremium }) => (
      effectAnimation ? [] : [buildEffectSticker(effectSticker, isPremium)]
    )),
  };
}

/** A result of an inline bot: its file comes through the owner's account, like a sticker of the owner's panel */
export function buildInlineResult(
  accountId: string, { id, queryId, type, title, description, url, document }: InlineResultDto,
): ApiBotInlineResult | ApiBotInlineMediaResult {
  const base = { id, queryId, type: type as ApiInlineResultType, title, description, sendMessage: { content: {} } };
  const userId = getPxgState().session?.user.id;
  if (!document || !userId) return { ...base, url };
  const mediaId = buildProxyCatalogMediaId(userId, accountId, document.id);
  const size = { width: document.width || DEFAULT_RESULT_SIZE, height: document.height || DEFAULT_RESULT_SIZE };
  if (type === 'photo') {
    return { ...base, photo: { mediaType: 'photo', id: mediaId, date: 0, sizes: [{ type: 'x', ...size }] } };
  }
  if (type === 'sticker') {
    return {
      ...base,
      sticker: {
        mediaType: 'sticker',
        id: mediaId,
        stickerSetInfo: { isMissing: true },
        emoji: document.emoji || undefined,
        isFree: true,
        isLottie: document.mimeType === 'application/x-tgsticker',
        isVideo: document.mimeType === 'video/webm',
        ...size,
      },
    };
  }
  if (type === 'gif' || type === 'mpeg4_gif' || type === 'video') {
    return { ...base, gif: { ...buildProxyGif(accountId, document), ...size } };
  }
  return { ...base, document: buildCatalogDocument(userId, accountId, document) };
}

export function buildFallbackReactions(): ApiAvailableReaction[] {
  return PROXY_REACTION_EMOJIS.map((emoticon) => ({ reaction: { type: 'emoji', emoticon }, title: emoticon }));
}

function buildCatalogDocument(userId: string, accountId: string, doc: CatalogDocumentDto): ApiDocument {
  return {
    mediaType: 'document',
    id: buildProxyCatalogMediaId(userId, accountId, doc.id),
    fileName: doc.id,
    size: doc.size,
    mimeType: doc.mimeType,
    mediaSize: doc.width && doc.height ? { width: doc.width, height: doc.height } : undefined,
  };
}

function buildStickerSet(
  accountId: string, set: CatalogSetDto, stickers?: ApiSticker[], isEmoji?: boolean,
): ApiStickerSet {
  return {
    isEmoji: isEmoji || undefined,
    id: buildProxyStickerSetId(accountId, set.id),
    // The owner's access hash stays on the server
    accessHash: accountId,
    title: set.title,
    shortName: set.shortName,
    count: set.count,
    installedDate: 1,
    stickers,
    covers: stickers?.slice(0, 1),
  };
}

function buildStickers(accountId: string, documents: CatalogDocumentDto[]): ApiSticker[] {
  const userId = getPxgState().session?.user.id;
  if (!userId) return [];
  const emoji = documents.filter((doc) => doc.kind === 'emoji').map((doc) => (
    buildCustomEmoji(accountId, doc, buildProxyCatalogMediaId(userId, accountId, doc.id), true)
  ));
  return [...emoji, ...documents.filter((doc) => doc.kind === 'sticker').map((doc): ApiSticker => ({
    mediaType: 'sticker',
    id: buildProxyCatalogMediaId(userId, accountId, doc.id),
    stickerSetInfo: doc.setId
      ? { id: buildProxyStickerSetId(accountId, doc.setId), accessHash: accountId }
      : { isMissing: true },
    emoji: doc.emoji || undefined,
    // The owner's installed sets are available without the viewer's own Premium, except the Premium stickers themselves
    isFree: true,
    hasEffect: doc.hasEffect || undefined,
    isLottie: doc.mimeType === 'application/x-tgsticker',
    isVideo: doc.mimeType === 'video/webm',
    width: doc.width || undefined,
    height: doc.height || undefined,
  }))];
}

/** `isFromPack`: an emoji of the owner's installed pack; packs of other emoji are not browsable through the provider */
function buildCustomEmoji(accountId: string, doc: CatalogDocumentDto, id: string, isFromPack?: boolean): ApiSticker {
  return {
    mediaType: 'sticker',
    id,
    stickerSetInfo: isFromPack && doc.setId
      ? { id: buildProxyStickerSetId(accountId, doc.setId), accessHash: accountId }
      : { isMissing: true },
    emoji: doc.emoji || undefined,
    isCustomEmoji: true,
    isFree: true,
    isLottie: doc.mimeType === 'application/x-tgsticker',
    isVideo: doc.mimeType === 'video/webm',
    width: doc.width || undefined,
    height: doc.height || undefined,
    shouldUseTextColor: doc.textColor || undefined,
  };
}

function buildProxyGif(accountId: string, doc: CatalogDocumentDto): ApiVideo {
  return {
    mediaType: 'video',
    id: buildProxyCatalogMediaId(getPxgState().session?.user.id || '', accountId, doc.id),
    mimeType: doc.mimeType,
    duration: doc.duration || 0,
    fileName: 'gif.mp4',
    width: doc.width || undefined,
    height: doc.height || undefined,
    size: doc.size,
    isGif: true,
    supportsStreaming: true,
  };
}
