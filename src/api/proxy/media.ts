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
  buildProxyMapToken, buildProxyMediaId, parseProxyAvatarHash, parseProxyCatalogHash, parseProxyMapHash,
  parseProxyMediaHash,
} from './mediaIds';

const DEFAULT_MEDIA_SIZE = 512;
const ANIMATED_STICKER_MIME = 'application/x-tgsticker';
const UNREGISTERED_CONTACT_ID = '0';
// After a server restart the worker takes the account in ~40 s: waiting less leaves media empty until a reload
const MEDIA_WAIT_MS = 120_000;
const MEDIA_WAIT_INTERVAL_MS = 2000;
const MEDIA_WAIT_MAX_INTERVAL_MS = 8000;
/** 1×1 transparent PNG: an animated sticker has no static thumbnail, its animation replaces the placeholder */
const EMPTY_THUMBNAIL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function buildProxyMedia(dto: MessageDto, chatId: string): Partial<MediaContent> | undefined {
  const media = dto.media;
  const userId = getPxgState().session?.user.id;
  if (!media || !userId) return undefined;
  const id = buildProxyMediaId(userId, chatId, dto.msgId);
  const width = media.width || DEFAULT_MEDIA_SIZE;
  const height = media.height || DEFAULT_MEDIA_SIZE;
  const size = media.size || 0;
  const duration = media.duration || 0;
  switch (media.kind) {
    case 'photo':
      return { photo: {
        mediaType: 'photo', id, date: Math.floor(Date.parse(dto.date) / 1000),
        sizes: [{ type: 'x', width, height }],
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
        isRound: media.kind === 'round', isGif: media.kind === 'gif', supportsStreaming: true,
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

/** Byte ranges use the same inclusive end as GramJS and the service worker */
export async function downloadMedia(
  { url, mediaFormat, start, end }: MethodArgs<'downloadMedia'>[0],
  onProgress?: MethodArgs<'downloadMedia'>[1],
) {
  const userId = getPxgState().session?.user.id;
  const catalog = parseProxyCatalogHash(url);
  const request = userId && buildMediaRequest(url, userId, catalog);
  if (!request) return undefined;
  let signed: { url: string; mimeType: string; size?: number } | undefined;
  const deadline = Date.now() + MEDIA_WAIT_MS;
  let interval = MEDIA_WAIT_INTERVAL_MS;
  while (!signed) {
    if (onProgress?.isCanceled || userId !== getPxgState().session?.user.id) return undefined;
    try {
      signed = await pxgRpc.call(...request);
    } catch (err) {
      // A document without a Telegram thumbnail gets an empty preview, so Web A keeps the emoji fallback
      if (catalog?.isThumbnail && err instanceof PxgError && err.code === 'not_found') return buildEmptyPreview();
      if (!(err instanceof PxgError) || err.code !== 'media_pending' || Date.now() + interval > deadline) throw err;
      await pause(interval);
      interval = Math.min(interval * 1.5, MEDIA_WAIT_MAX_INTERVAL_MS);
    }
  }
  if (!signed) return undefined;
  // The server has only the sticker's animation for a message: it is no picture, and it plays over the placeholder
  if (signed.mimeType === ANIMATED_STICKER_MIME && parseProxyMediaHash(url)?.isPreview) return buildEmptyPreview();
  const headers: Record<string, string> = {};
  if (start !== undefined || end !== undefined) {
    headers.Range = `bytes=${start || 0}-${end ?? ''}`;
  }
  const response = await fetch(`${PXG_SERVER_URL}${signed.url}`, { headers });
  if (!response.ok) throw new PxgError(`http_${response.status}`);
  // Files outside the archive arrive while the server is still fetching them from Telegram
  const buffer = await readResponse(response, Number(response.headers.get('content-length')), onProgress);
  if (!buffer || onProgress?.isCanceled || userId !== getPxgState().session?.user.id) return undefined;
  onProgress?.(1);
  const mimeType = signed.mimeType || response.headers.get('content-type') || 'application/octet-stream';
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
  const message = parseProxyMediaHash(url);
  if (message) {
    const peer = message.userId === userId ? resolveProxyPeer(message.chatId) : undefined;
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
