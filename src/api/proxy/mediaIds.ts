import { isProxyPeerId } from './ids';

const MEDIA_HASH = /^(?:photo|document|sticker)pxg_([^_]+)_(-?\d+)_(\d+)(?:[?:]|$)/;

export function buildProxyMediaId(userId: string, chatId: string, msgId: number): string {
  return `pxg_${userId}_${chatId}_${msgId}`;
}

export function parseProxyMediaHash(url: string) {
  // The service worker requests absolute /progressive/ and /download/ URLs
  let hash = url;
  if (/^https?:\/\//.test(url)) {
    try {
      const { pathname } = new URL(url);
      hash = pathname.slice(pathname.lastIndexOf('/') + 1);
    } catch {
      return undefined;
    }
  }
  const match = hash.match(MEDIA_HASH);
  if (!match || !isProxyPeerId(match[2])) return undefined;
  const msgId = Number(match[3]);
  if (!Number.isSafeInteger(msgId) || msgId <= 0) return undefined;
  return { userId: match[1], chatId: match[2], msgId };
}
