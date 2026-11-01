import type { MessageDto } from '../../proxygram/server/types';
import type { MethodArgs } from '../gramjs/methods/types';
import type { MediaContent } from '../types';
import { PxgError } from '../../proxygram/server/types';
import { ApiMediaFormat } from '../types';

import { pause } from '../../util/schedulers';
import { PXG_SERVER_URL } from '../../proxygram/server/http';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { resolveProxyPeer } from './index';
import { buildProxyMediaId, parseProxyMediaHash } from './mediaIds';

const DEFAULT_MEDIA_SIZE = 512;
const MEDIA_WAIT_ATTEMPTS = 15;
const MEDIA_WAIT_INTERVAL_MS = 2000;

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

/** Byte ranges use the same inclusive end as GramJS and the service worker */
export async function downloadMedia(
  { url, mediaFormat, start, end }: MethodArgs<'downloadMedia'>[0],
  onProgress?: MethodArgs<'downloadMedia'>[1],
) {
  const target = parseProxyMediaHash(url);
  if (!target || target.userId !== getPxgState().session?.user.id) return undefined;
  const peer = resolveProxyPeer(target.chatId);
  if (!peer || onProgress?.isCanceled) return undefined;
  let signed: { url: string; mimeType: string; size: number } | undefined;
  for (let attempt = 0; attempt < MEDIA_WAIT_ATTEMPTS; attempt++) {
    if (onProgress?.isCanceled || target.userId !== getPxgState().session?.user.id) return undefined;
    try {
      signed = await pxgRpc.call('media.url', { ...peer, msgId: target.msgId });
      break;
    } catch (err) {
      if (!(err instanceof PxgError) || err.code !== 'media_pending' || attempt === MEDIA_WAIT_ATTEMPTS - 1) throw err;
      await pause(MEDIA_WAIT_INTERVAL_MS);
    }
  }
  if (!signed) return undefined;
  const headers: Record<string, string> = {};
  if (start !== undefined || end !== undefined) {
    headers.Range = `bytes=${start || 0}-${end ?? ''}`;
  }
  const response = await fetch(`${PXG_SERVER_URL}${signed.url}`, { headers });
  if (!response.ok) throw new PxgError(`http_${response.status}`);
  const buffer = await response.arrayBuffer();
  if (onProgress?.isCanceled || target.userId !== getPxgState().session?.user.id) return undefined;
  onProgress?.(1);
  const mimeType = signed.mimeType || response.headers.get('content-type') || 'application/octet-stream';
  const isBuffer = mediaFormat === ApiMediaFormat.Progressive || mediaFormat === ApiMediaFormat.DownloadUrl;
  const dataBlob = mediaFormat === ApiMediaFormat.Text ? new TextDecoder().decode(buffer)
    : isBuffer ? '' : new Blob([buffer], { type: mimeType });
  return { dataBlob, arrayBuffer: isBuffer ? buffer : undefined, mimeType, fullSize: signed.size };
}
