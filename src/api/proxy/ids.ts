export type ProxyPeer = Readonly<{
  accountId: string;
  peerId: number;
}>;

export type ProxyPeerEntry = readonly [string, ProxyPeer];

const USER_ID_BASE = 2 ** 52;
const CHANNEL_ID_BASE = 1e12;
const HASH_BITS = 48;
const HASH_SPACE = 2 ** HASH_BITS;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_BITS = 64;
const SPONSORED_ID_PREFIX = 'pxg-ad:';
const encoder = new TextEncoder();

/** Recognizes reserved IDs even before the registry is restored from storage */
export function isProxyPeerId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^-?[1-9]\d*$/.test(value)) return false;

  const id = Number(value);
  if (!Number.isSafeInteger(id)) return false;

  const rawId = id > 0 ? id : -id - CHANNEL_ID_BASE;
  return rawId >= USER_ID_BASE && rawId < USER_ID_BASE + HASH_SPACE;
}

/** Web A views and clicks an ad knowing only its ID, so the ID also says whose chat the ad came from */
export function getProxySponsoredId({ accountId, peerId }: ProxyPeer, randomId: string) {
  return `${SPONSORED_ID_PREFIX}${accountId}:${peerId}:${randomId}`;
}

export function isProxySponsoredId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SPONSORED_ID_PREFIX);
}

export function parseProxySponsoredId(id: string) {
  if (!isProxySponsoredId(id)) return undefined;
  const [accountId, peerId, randomId] = id.slice(SPONSORED_ID_PREFIX.length).split(':');
  return { accountId, peerId: Number(peerId), randomId };
}

/** A private-chat participant and the same sender share an ID within one provider account */
export class ProxyPeerRegistry {
  private idsByPeer = new Map<string, string>();

  private peersById = new Map<string, ProxyPeer>();

  constructor(entries: readonly ProxyPeerEntry[] = []) {
    entries.forEach(([id, peer]) => {
      validatePeer(peer);
      if (!isProxyPeerId(id) || (peer.peerId > 0) !== (Number(id) > 0)) {
        throw new Error('Invalid proxy peer ID');
      }

      const key = getPeerKey(peer);
      if (this.idsByPeer.has(key) || this.peersById.has(id)) {
        throw new Error('Duplicate proxy peer ID');
      }
      this.idsByPeer.set(key, id);
      this.peersById.set(id, Object.freeze({ ...peer }));
    });
  }

  registerPeer(peer: ProxyPeer): string {
    validatePeer(peer);
    const key = getPeerKey(peer);
    const existing = this.idsByPeer.get(key);
    if (existing) return existing;

    const offset = hashPeerKey(key);
    let candidate = offset;
    do {
      const rawId = USER_ID_BASE + candidate;
      const id = String(peer.peerId > 0 ? rawId : -(CHANNEL_ID_BASE + rawId));
      if (!this.peersById.has(id)) {
        this.idsByPeer.set(key, id);
        this.peersById.set(id, Object.freeze({ ...peer }));
        return id;
      }

      candidate = (candidate + 1) % HASH_SPACE;
    } while (candidate !== offset);
    throw new Error('Proxy peer ID space exhausted');
  }

  getPeer(id: string): ProxyPeer | undefined {
    return this.peersById.get(id);
  }

  getEntries(): ProxyPeerEntry[] {
    return Array.from(this.peersById.entries());
  }
}

function validatePeer({ accountId, peerId }: ProxyPeer) {
  if (typeof accountId !== 'string' || !accountId || !Number.isSafeInteger(peerId) || !peerId) {
    throw new Error('Invalid proxy peer');
  }
}

function getPeerKey({ accountId, peerId }: ProxyPeer) {
  return `${accountId}:${peerId}`;
}

function hashPeerKey(key: string): number {
  let hash = FNV_OFFSET;
  encoder.encode(key).forEach((byte) => {
    hash = BigInt.asUintN(FNV_BITS, (hash ^ BigInt(byte)) * FNV_PRIME);
  });
  return Number(BigInt.asUintN(HASH_BITS, hash));
}
