import type { MessageDto } from '../../proxygram/server/types';
import type { MethodArgs } from '../gramjs/methods/types';
import type { MediaContent } from '../types';
import { PxgError } from '../../proxygram/server/types';
import { ApiMediaFormat } from '../types';

import { MEDIA_CACHE_DISABLED, MEDIA_CACHE_MAX_BYTES, MEDIA_CACHE_NAME, MEDIA_CACHE_NAME_AVATARS } from '../../config';
import * as cacheApi from '../../util/cacheApi';
import { pause } from '../../util/schedulers';
import { PXG_SERVER_URL } from '../../proxygram/server/http';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { resolveProxyPeer } from './index';
import {
  buildProxyArchiveMediaId, buildProxyMapToken, buildProxyMediaId, parseProxyArchiveHash, parseProxyAvatarHash,
  parseProxyCatalogHash, parseProxyMapHash, parseProxyMediaHash,
} from './mediaIds';
import { isSavedPeer } from './saved';

const DEFAULT_MEDIA_SIZE = 512;
const ANIMATED_STICKER_MIME = 'application/x-tgsticker';
const UNREGISTERED_CONTACT_ID = '0';
// The server keeps fetching a file while it is wanted: after a restart, a VPN switch or a FLOOD_WAIT of the owner's
// account it may take minutes, and giving up earlier leaves the picture empty until a reload
const MEDIA_WAIT_MS = 10 * 60_000;
const MEDIA_WAIT_INTERVAL_MS = 1000;
const MEDIA_WAIT_MAX_INTERVAL_MS = 8000;
/** Signed links live 10 minutes on the server (MEDIA_TOKEN_TTL_MS): reuse them a bit less */
const SIGNED_LINK_TTL_MS = 8 * 60_000;
const SIGNED_LINKS_LIMIT = 2000;
/** 1×1 transparent PNG: an animated sticker has no static thumbnail, its animation replaces the placeholder */
const EMPTY_THUMBNAIL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function buildProxyMedia(dto: MessageDto, chatId: string): Partial<MediaContent> | undefined {
  const userId = getPxgState().session?.user.id;
  if (!dto.media || !userId) return undefined;
  return buildMediaContent(dto, dto.media, buildProxyMediaId(userId, chatId, dto.msgId));
}

/** The attachment of a tombstone comes from the owner's own archive */
export function buildProxyArchiveMedia(dto: MessageDto): Partial<MediaContent> | undefined {
  if (!dto.media) return undefined;
  return buildMediaContent(dto, dto.media, buildProxyArchiveMediaId(dto.accountId, dto.peerId, dto.msgId));
}

function buildMediaContent(
  dto: MessageDto, media: NonNullable<MessageDto['media']>, id: string,
): Partial<MediaContent> | undefined {
  const width = media.width || DEFAULT_MEDIA_SIZE;
  const height = media.height || DEFAULT_MEDIA_SIZE;
  const size = media.size || 0;
  const duration = media.duration || 0;
  const thumbnail = buildStrippedThumbnail(media.strippedThumb, width, height);
  switch (media.kind) {
    case 'photo':
      return { photo: {
        mediaType: 'photo', id, date: Math.floor(Date.parse(dto.date) / 1000),
        sizes: [{ type: 'x', width, height }], thumbnail,
      } };
    case 'sticker':
      return { sticker: {
        mediaType: 'sticker', id, width, height, stickerSetInfo: { isMissing: true },
        isLottie: media.mimeType === 'application/x-tgsticker', isVideo: media.mimeType === 'video/webm',
        hasEffect: media.flags?.includes('premium') || undefined,
      } };
    case 'video':
    case 'round':
    case 'gif':
      return { video: {
        mediaType: 'video', id, width, height, size, duration,
        mimeType: media.mimeType || 'video/mp4', fileName: media.fileName || 'video.mp4',
        isRound: media.kind === 'round', isGif: media.kind === 'gif', supportsStreaming: true, thumbnail,
      } };
    case 'voice':
      return { voice: { mediaType: 'voice', id, duration, size } };
    case 'audio':
      return { audio: {
        mediaType: 'audio', id, duration, size, mimeType: media.mimeType || 'audio/mpeg',
        fileName: media.fileName || 'audio.mp3',
      } };
    case 'document':
      return { document: {
        mediaType: 'document', id, size, fileName: media.fileName || 'file',
        mimeType: media.mimeType || 'application/octet-stream',
      } };
    default:
      return undefined;
  }
}

/** The blurred picture Telegram keeps in the message itself: Web A shows it until the file arrives (docs/spec/11 S4) */
function buildStrippedThumbnail(stripped: string | undefined, width: number, height: number) {
  // The server sends a complete JPEG: the header Telegram strips is added there, not in the bundle
  return stripped ? { dataUri: `data:image/jpeg;base64,${stripped}`, width, height } : undefined;
}

/**
 * Attachments without a file. Web A draws a dice from Telegram's own sticker sets and a game from its preview, which
 * only a Telegram session can load, so both are shown as text
 */
export function buildProxyAttachment(dto: MessageDto, chatId: string): Partial<MediaContent> | undefined {
  const { attachment } = dto;
  if (!attachment) return undefined;
  const geo = 'lat' in attachment ? {
    lat: attachment.lat,
    long: attachment.long,
    accessHash: buildProxyMapToken(chatId, dto.msgId),
    accuracyRadius: attachment.accuracyRadius,
  } : undefined;
  switch (attachment.type) {
    case 'geo':
      return { location: { mediaType: 'geo', geo: geo! } };
    case 'venue':
      return { location: {
        mediaType: 'venue', geo: geo!, title: attachment.title, provider: attachment.provider,
        address: attachment.address, venueId: attachment.venueId, venueType: attachment.venueType,
      } };
    case 'geoLive':
      return { location: { mediaType: 'geoLive', geo: geo!, heading: attachment.heading, period: attachment.period } };
    case 'contact':
      return { contact: {
        mediaType: 'contact', firstName: attachment.firstName, lastName: attachment.lastName,
        phoneNumber: attachment.phoneNumber,
        // The contact's Telegram profile belongs to the owner's session: a guest sees only what the message says
        userId: UNREGISTERED_CONTACT_ID,
      } };
    case 'dice':
      return { text: { text: `${attachment.emoji} ${attachment.value}` } };
    case 'game':
      return { text: { text: [`🎮 ${attachment.title}`, attachment.description].filter(Boolean).join('\n') } };
    default:
      return undefined;
  }
}

/** Ссылка истории в любом виде, каким её передаёт Web A: с origin и служебным `/progressive/` */
function normalizeStoryUrl(url: string) {
  const path = url
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/(?:progressive|download)\//i, '/')
    .replace(/^\/+/, '/');
  return path.startsWith('/pxg/stories/') || path.startsWith('/stories/') ? path : undefined;
}

/** Byte ranges use the same inclusive end as GramJS and the service worker */
export async function downloadMedia(
  { url, mediaFormat, start, end }: MethodArgs<'downloadMedia'>[0],
  onProgress?: MethodArgs<'downloadMedia'>[1],
) {
  const userId = getPxgState().session?.user.id;
  // История приходит с сервера готовой data: URL — качать через RPC нечего
  if (url.startsWith('data:')) {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return {
      dataBlob: new Blob([buffer], { type: response.headers.get('content-type') || 'application/octet-stream' }),
      arrayBuffer: undefined,
      mimeType: response.headers.get('content-type') || 'application/octet-stream',
      fullSize: buffer.byteLength,
    };
  }
  // Медиа истории: подписанная ссылка сервера, качать через RPC нечего.
  // Web A просит видео потоком и добавляет `/progressive/` перед путём — ссылку надо узнать и в таком виде
  const storyUrl = normalizeStoryUrl(url);
  if (storyUrl) {
    const response = await fetch(`${PXG_SERVER_URL}${storyUrl}`, {
      headers: start !== undefined || end !== undefined ? { Range: `bytes=${start || 0}-${end ?? ''}` } : {},
    });
    if (!response.ok) throw new PxgError(`http_${response.status}`);
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    return {
      dataBlob: new Blob([buffer], { type: mimeType }),
      arrayBuffer: undefined,
      mimeType,
      fullSize: buffer.byteLength,
    };
  }
  const catalog = parseProxyCatalogHash(url);
  const request = userId && buildMediaRequest(url, userId, catalog);
  if (!request) return undefined;
  const fileHash = parseProxyMediaHash(url) || parseProxyArchiveHash(url);
  // The preview of a video, GIF or file is Telegram's own small picture of it, never the whole file (spec/11 S4)
  const isCover = Boolean(fileHash?.isPreview && isDocumentHash(url));
  if (isCover) {
    if (request[0] !== 'media.url') return undefined;
    request[1] = { ...request[1], preview: true };
  }
  const isCanceled = () => Boolean(onProgress?.isCanceled) || userId !== getPxgState().session?.user.id;
  const range = start !== undefined || end !== undefined ? `bytes=${start || 0}-${end ?? ''}` : undefined;
  let loaded: LoadedFile | undefined;
  try {
    loaded = await loadFile(request, range, onProgress, isCanceled);
  } catch (err) {
    // A document without a Telegram thumbnail gets an empty preview, so Web A keeps the emoji fallback
    if (catalog?.isThumbnail && err instanceof PxgError && err.code === 'not_found') return buildEmptyPreview();
    // No cover in Telegram: Web A keeps the blurred thumbnail that came with the message
    if (isCover && err instanceof PxgError && err.code === 'not_found') return undefined;
    throw err;
  }
  if (!loaded || isCanceled()) return undefined;
  const { signed, buffer, contentType } = loaded;
  // The server has only the sticker's animation for a message: it is no picture, and it plays over the placeholder
  if (signed.mimeType === ANIMATED_STICKER_MIME && fileHash?.isPreview) return buildEmptyPreview();
  onProgress?.(1);
  const mimeType = signed.mimeType || contentType || 'application/octet-stream';
  const isBuffer = mediaFormat === ApiMediaFormat.Progressive || mediaFormat === ApiMediaFormat.DownloadUrl;
  const dataBlob = mediaFormat === ApiMediaFormat.Text ? new TextDecoder().decode(buffer)
    : isBuffer ? '' : new Blob([buffer], { type: mimeType });
  // As GramJS does: documents by ID, avatars keyed by photo ID and maps of a point never change, so a reload takes
  // them from the cache instead of asking the server again. Message files are not kept — the access can be revoked
  const isImmutable = Boolean(catalog) || request[0] === 'media.avatar' || request[0] === 'media.map';
  if (!MEDIA_CACHE_DISABLED && isImmutable && !isBuffer && buffer.byteLength <= MEDIA_CACHE_MAX_BYTES) {
    void cacheApi.save(url.startsWith('avatar') ? MEDIA_CACHE_NAME_AVATARS : MEDIA_CACHE_NAME, url, dataBlob);
  }
  return {
    dataBlob, arrayBuffer: isBuffer ? buffer : undefined, mimeType, fullSize: signed.size ?? buffer.byteLength,
  };
}

type MediaRequest = [string, Record<string, unknown>];
type SignedFile = { url: string; mimeType: string; size?: number };
type LoadedFile = { signed: SignedFile; buffer: ArrayBuffer; contentType?: string };

/** Errors that pass by themselves: the file is on its way, the network or the server's VPN blinked (docs/spec/11 C1) */
const TRANSIENT_CODES = new Set(['media_pending', 'rate_limited', 'timeout', 'disconnected', 'internal']);
const TRANSIENT_HTTP = /^http_(?:5\d\d|408|429)$/;
/** A link expired or belongs to a previous session: a new one is signed, and the access is checked again */
const STALE_LINK_HTTP = new Set(['http_403', 'http_410']);

/**
 * One signed link per file while it lives: the preview, the picture in the feed and the full size of one message ask
 * for the same link, and the browser takes the bytes from its HTTP cache instead of the server (docs/spec/11 C2)
 */
const signedLinks = new Map<string, { signed: SignedFile; until: number }>();
const signing = new Map<string, Promise<SignedFile>>();

function signFile(request: MediaRequest): Promise<SignedFile> {
  const key = JSON.stringify(request);
  const known = signedLinks.get(key);
  if (known && known.until > Date.now()) return Promise.resolve(known.signed);
  let promise = signing.get(key);
  if (!promise) {
    promise = pxgRpc.call<SignedFile>(...request).then((signed) => {
      if (signedLinks.size >= SIGNED_LINKS_LIMIT) signedLinks.clear();
      signedLinks.set(key, { signed, until: Date.now() + SIGNED_LINK_TTL_MS });
      return signed;
    }).finally(() => signing.delete(key));
    signing.set(key, promise);
  }
  return promise;
}

function forgetSignedLink(request: MediaRequest) {
  signedLinks.delete(JSON.stringify(request));
}

/**
 * Waits while the server says the file is on its way and repeats after anything temporary; gives up only on a refusal
 * (no access, no such file) or after a long time, so a blink of the network does not leave an empty picture
 */
async function loadFile(
  request: MediaRequest, range: string | undefined, onProgress: MethodArgs<'downloadMedia'>[1],
  isCanceled: () => boolean,
): Promise<LoadedFile | undefined> {
  const deadline = Date.now() + MEDIA_WAIT_MS;
  let interval = MEDIA_WAIT_INTERVAL_MS;
  for (;;) {
    if (isCanceled()) return undefined;
    try {
      const signed = await signFile(request);
      if (isCanceled()) return undefined;
      const response = await fetch(`${PXG_SERVER_URL}${signed.url}`, range ? { headers: { Range: range } } : {});
      if (!response.ok) {
        if (STALE_LINK_HTTP.has(`http_${response.status}`)) forgetSignedLink(request);
        throw new PxgError(`http_${response.status}`);
      }
      // Files outside the archive arrive while the server is still fetching them from Telegram
      const buffer = await readResponse(response, Number(response.headers.get('content-length')), onProgress);
      if (!buffer) return undefined;
      return { signed, buffer, contentType: response.headers.get('content-type') || undefined };
    } catch (err) {
      if (!isTransientMediaError(err) || Date.now() + interval > deadline) throw err;
      await waitForRetry(interval);
      interval = Math.min(interval * 1.5, MEDIA_WAIT_MAX_INTERVAL_MS);
    }
  }
}

function isTransientMediaError(err: unknown) {
  if (err instanceof PxgError) {
    return TRANSIENT_CODES.has(err.code) || TRANSIENT_HTTP.test(err.code) || STALE_LINK_HTTP.has(err.code);
  }
  // fetch rejects with a TypeError when the network is gone
  return err instanceof TypeError;
}

/** Without a network there is nothing to ask: wait for it to come back instead of spinning */
async function waitForRetry(interval: number) {
  if (typeof navigator === 'undefined' || navigator.onLine !== false || typeof window === 'undefined') {
    await pause(interval);
    return;
  }
  await new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      resolve();
    };
    window.addEventListener('online', done);
    setTimeout(done, MEDIA_WAIT_MAX_INTERVAL_MS * 4);
  });
}

/** Message media of a video, GIF or file: Web A asks `document…?size=` for its preview picture */
function isDocumentHash(url: string) {
  const hash = /^https?:\/\//.test(url) ? url.slice(url.lastIndexOf('/') + 1) : url;
  return hash.startsWith('documentpxg');
}

function buildEmptyPreview() {
  const bytes = Uint8Array.from(atob(EMPTY_THUMBNAIL), (char) => char.charCodeAt(0));
  const preview = new Blob([bytes], { type: 'image/png' });
  return { dataBlob: preview, arrayBuffer: undefined, mimeType: 'image/png', fullSize: preview.size };
}

/** Message files and owner's stickers are tied to the session that built their IDs; avatars are tied to a peer */
function buildMediaRequest(
  url: string, userId: string, catalog: ReturnType<typeof parseProxyCatalogHash>,
): [string, Record<string, unknown>] | undefined {
  if (catalog) {
    if (catalog.userId !== userId) return undefined;
    // The preview is the document's own Telegram thumbnail, as in the official client
    return ['stickers.url', {
      accountId: catalog.accountId,
      documentId: catalog.documentId,
      thumb: catalog.isThumbnail || undefined,
      effect: catalog.isEffect || undefined,
    }];
  }
  const archived = parseProxyArchiveHash(url);
  if (archived) {
    return ['archive.mediaUrl', { accountId: archived.accountId, peerId: archived.peerId, msgId: archived.msgId }];
  }
  const message = parseProxyMediaHash(url);
  if (message) {
    const peer = message.userId === userId ? resolveProxyPeer(message.chatId) : undefined;
    // A file of one's own Saved Messages: the server keeps its own copy, apart from any chat
    if (isSavedPeer(peer)) return ['saved.mediaUrl', { id: message.msgId }];
    return peer && ['media.url', { ...peer, msgId: message.msgId, effect: message.isEffect || undefined }];
  }
  const map = parseProxyMapHash(url);
  if (map) {
    const mapPeer = resolveProxyPeer(map.chatId);
    const { chatId: _chatId, ...image } = map;
    return mapPeer && ['media.map', { ...mapPeer, ...image }];
  }
  const avatar = parseProxyAvatarHash(url);
  const peer = avatar && resolveProxyPeer(avatar.peerId);
  return peer ? ['media.avatar', { ...peer, big: avatar.isBig || undefined, photoId: avatar.photoId }] : undefined;
}

async function readResponse(
  response: Response, total: number, onProgress?: MethodArgs<'downloadMedia'>[1],
): Promise<ArrayBuffer | undefined> {
  if (!response.body || !onProgress || !total) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onProgress.isCanceled) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
    loaded += value.length;
    onProgress(Math.min(loaded / total, 1));
  }
  const result = new Uint8Array(loaded);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result.buffer;
}
