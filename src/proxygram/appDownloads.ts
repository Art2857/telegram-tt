import { IS_TAURI } from '../util/browser/globalEnvironment';
import { IS_ANDROID, IS_WINDOWS } from '../util/browser/windowEnvironment';

/**
 * One manifest for every server: the apps are the same everywhere and only open the chosen server's client.
 * The Tauri updater reads `platforms`; the Android shell and the download offer read `android` as well
 */
export const RELEASES_URL = import.meta.env.TG_PXG_RELEASES_URL
  || 'https://proxygram.azhuleev.ru/downloads/latest.json';
export const DEFAULT_SERVER_HOST = new URL(RELEASES_URL).host;

const FETCH_TIMEOUT_MS = 8000;

export type ReleaseManifest = {
  version: string;
  notes?: string;
  platforms?: Record<string, { url: string; signature?: string }>;
  android?: { url: string; sha256?: string };
};

export type AppDownload = { platform: 'windows' | 'android'; version: string; url: string };

export async function fetchReleaseManifest(): Promise<ReleaseManifest | undefined> {
  try {
    const response = await fetch(RELEASES_URL, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return response.ok ? await response.json() as ReleaseManifest : undefined;
  } catch {
    return undefined;
  }
}

/** The app for the device this browser runs on; nothing inside the app itself or where there is none */
export function getAppDownload(manifest: ReleaseManifest): AppDownload | undefined {
  if (IS_TAURI) return undefined;
  if (IS_WINDOWS) {
    const url = manifest.platforms?.['windows-x86_64']?.url;
    return url ? { platform: 'windows', version: manifest.version, url } : undefined;
  }
  if (IS_ANDROID && manifest.android?.url) {
    return { platform: 'android', version: manifest.version, url: manifest.android.url };
  }
  return undefined;
}

/** `1.10.0` is newer than `1.9.3`; a missing part counts as zero */
export function isNewerVersion(candidate: string, current: string) {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return false;
}
