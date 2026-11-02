import { isProxyPeerId } from './ids';

const MEDIA_HASH = /^(?:photo|document|sticker)pxg_([^_]+)_(-?\d+)_(\d+)(?:[?:]|$)/;
// Reaction animations are requested as `sticker<id>` too
const CATALOG_HASH = /^(?:document|sticker)pxgs_([^_]+)_([0-9a-f-]{36})_(\d+)(\?size=\w+|\?download)?(?:[?&:]|$)/;
const AVATAR_HASH = /^(avatar|profile)(-?\d+)\?\d+$/;
/** A profile photo opened in the viewer: `photo<id>` with the size the viewer asks for */
const PROFILE_PHOTO_HASH = /^photopxgavatar_(-?\d+)_(\d+)(?:\?size=(\w))?$/;
/** Sizes small enough for the avatar's small version */
const SMALL_PHOTO_SIZES = new Set(['a', 'b', 'm', 's']);

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

/**
 * An avatar is the peer's current photo, so its photo ID only keys the client cache; a photo opened in the viewer
 * may be any one from the profile gallery
 */
export function parseProxyAvatarHash(url: string) {
  const hash = getHash(url);
  const avatar = hash?.match(AVATAR_HASH);
  if (avatar) return isProxyPeerId(avatar[2]) ? { peerId: avatar[2], isBig: avatar[1] === 'profile' } : undefined;
  const photo = hash?.match(PROFILE_PHOTO_HASH);
  if (!photo || !isProxyPeerId(photo[1])) return undefined;
  return { peerId: photo[1], photoId: photo[2], isBig: !SMALL_PHOTO_SIZES.has(photo[3] || '') };
}

/** A profile photo of a shared chat or user, as Web A's viewer expects it */
export function buildProxyProfilePhotoId(peerId: string, photoId: string) {
  return `pxgavatar_${peerId}_${photoId}`;
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
