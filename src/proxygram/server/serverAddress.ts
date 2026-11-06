import { IS_TAURI } from '../../util/browser/globalEnvironment';

/** Plain HTTP only for a server on this very machine: everything else carries sessions and needs HTTPS */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i;
const CHECK_TIMEOUT_MS = 8000;
/** The app opens its default server with this parameter when the saved one does not answer */
export const UNREACHABLE_SERVER_PARAM = 'pxg-server-unreachable';

export type ServerAddressError = 'invalid' | 'insecure';

/** A typed address becomes the server's origin: the scheme is optional, a path is ignored */
export function parseServerAddress(input: string): { origin: string } | { error: ServerAddressError } {
  const value = input.trim();
  if (!value) return { error: 'invalid' };
  let url: URL;
  try {
    url = new URL(SCHEME_PATTERN.test(value) ? value : `https://${value}`);
  } catch {
    return { error: 'invalid' };
  }
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { error: 'invalid' };
  if (!isLocal && !url.hostname.includes('.')) return { error: 'invalid' };
  if (url.protocol === 'http:' && !isLocal) return { error: 'insecure' };
  return { origin: url.origin };
}

/** A Proxygram server answers `/pxg/health` with `{ ok: true }` and lets any site ask */
export async function checkProxygramServer(origin: string) {
  try {
    const response = await fetch(`${origin}/pxg/health`, {
      cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    const body = await response.json() as { ok?: boolean };
    return response.ok && body.ok === true;
  } catch {
    return false;
  }
}

/** The app keeps the server for its next starts; a browser opens the other server's own client */
export async function switchServer(origin: string) {
  if (IS_TAURI) {
    await window.tauri.setServer(origin);
    return;
  }
  window.location.assign(origin);
}

/** The saved server the app could not reach and replaced with its default one for this start */
export function getUnreachableServer() {
  return new URLSearchParams(window.location.search).get(UNREACHABLE_SERVER_PARAM) || undefined;
}
