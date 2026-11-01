import { isProxyPeerId } from './ids';

const MEDIA_HASH = /^(?:photo|document|sticker)pxg_([^_]+)_(-?\d+)_(\d+)(?:[?:]|$)/;
const CATALOG_HASH = /^documentpxgs_([^_]+)_([0-9a-f-]{36})_(\d+)(\?size=\w+|\?download)?(?:[?&:]|$)/;

export function buildProxyMediaId(userId: string, chatId: string, msgId: number): string {
  return `pxg_${userId}_${chatId}_${msgId}`;
}

/** Owner's stickers and GIFs are not tied to a message, so their IDs name the provider account */
export function buildProxyCatalogMediaId(userId: string, accountId: string, documentId: string): string {
  return `pxgs_${userId}_${accountId}_${documentId}`;
}

export function parseProxyMediaHash(url: string) {
  const match = getHash(url)?.match(MEDIA_HASH);
  if (!match || !isProxyPeerId(match[2])) return undefined;
  const msgId = Number(match[3]);
  if (!Number.isSafeInteger(msgId) || msgId <= 0) return undefined;
  return { userId: match[1], chatId: match[2], msgId };
}

export function parseProxyCatalogHash(url: string) {
  const match = getHash(url)?.match(CATALOG_HASH);
  if (!match) return undefined;
  return {
    userId: match[1], accountId: match[2], documentId: match[3], isThumbnail: match[4]?.startsWith('?size='),
  };
}

export function parseProxyCatalogId(id: string) {
  return parseProxyCatalogHash(`document${id}`);
}

function getHash(url: string) {
  // The service worker requests absolute /progressive/ and /download/ URLs
  if (!/^https?:\/\//.test(url)) return url;
  try {
    const { pathname } = new URL(url);
    return pathname.slice(pathname.lastIndexOf('/') + 1);
  } catch {
    return undefined;
  }
}
