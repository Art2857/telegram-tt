import type { CatalogDocumentDto, CatalogSetDto, StickerCatalogDto } from '../../proxygram/server/types';
import type { MethodArgs } from '../gramjs/methods/types';
import type { ApiSticker, ApiStickerSet, ApiVideo } from '../types';

import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { buildProxyCatalogMediaId, parseProxyCatalogId } from './mediaIds';

const CATALOG_TTL_MS = 60_000;
const SET_ID_PREFIX = 'pxgset_';
const PROXY_SET_ID = /^pxgset_([0-9a-f-]{36})_(\d+)$/;
const EMPTY_HASH = '0';

let cached: { userId: string; at: number; catalog: Promise<StickerCatalogDto[]> } | undefined;

/** One request feeds the sticker panel, recent, favorite and GIF tabs opened together */
function getCatalog(): Promise<StickerCatalogDto[]> {
  const userId = getPxgState().session?.user.id;
  if (!userId) return Promise.resolve([]);
  if (cached?.userId !== userId || Date.now() - cached.at > CATALOG_TTL_MS) {
    const catalog = pxgRpc.call<StickerCatalogDto[]>('stickers.catalog');
    cached = { userId, at: Date.now(), catalog };
    catalog.catch(() => {
      if (cached?.catalog === catalog) cached = undefined;
    });
  }
  return cached.catalog;
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

export function fetchCustomEmojiSets() {
  return Promise.resolve({ hash: EMPTY_HASH, sets: [] });
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
  if (!parsed) return undefined;
  const [catalogs, documents] = await Promise.all([
    getCatalog(),
    pxgRpc.call<CatalogDocumentDto[]>('stickers.set', parsed),
  ]);
  const set = catalogs.find((item) => item.accountId === parsed.accountId)?.sets
    .find((item) => item.id === parsed.setId);
  if (!set) return undefined;
  const stickers = buildStickers(parsed.accountId, documents);
  const packs: Record<string, ApiSticker[]> = {};
  stickers.forEach((sticker) => {
    if (sticker.emoji) (packs[sticker.emoji] ||= []).push(sticker);
  });
  return { set: buildStickerSet(parsed.accountId, set, stickers), stickers, packs };
}

/** Emoji suggestions come from the owner's catalog: Telegram's global search needs the owner's session */
export async function fetchStickersForEmoji({ emoji }: MethodArgs<'fetchStickersForEmoji'>[0]) {
  const catalogs = await getCatalog();
  const stickers = catalogs.flatMap(({ accountId, recent, faved }) => (
    buildStickers(accountId, [...faved, ...recent].filter((doc) => doc.emoji === emoji))
  ));
  return { stickers, hash: EMPTY_HASH };
}

function buildStickerSet(accountId: string, set: CatalogSetDto, stickers?: ApiSticker[]): ApiStickerSet {
  return {
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
  return documents.filter((doc) => doc.kind === 'sticker').map((doc) => ({
    mediaType: 'sticker',
    id: buildProxyCatalogMediaId(userId, accountId, doc.id),
    stickerSetInfo: doc.setId
      ? { id: buildProxyStickerSetId(accountId, doc.setId), accessHash: accountId }
      : { isMissing: true },
    emoji: doc.emoji || undefined,
    // The owner's installed sets are available without the viewer's own Premium
    isFree: true,
    isLottie: doc.mimeType === 'application/x-tgsticker',
    isVideo: doc.mimeType === 'video/webm',
    width: doc.width || undefined,
    height: doc.height || undefined,
  }));
}

function buildCustomEmoji(accountId: string, doc: CatalogDocumentDto, id: string): ApiSticker {
  return {
    mediaType: 'sticker',
    id,
    // Emoji packs are not browsable through the provider
    stickerSetInfo: { isMissing: true },
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
