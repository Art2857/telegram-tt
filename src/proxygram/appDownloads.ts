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

export type AppPlatform = 'windows' | 'android';
export type AppDownload = { platform: AppPlatform; version: string; url: string };

export async function fetchReleaseManifest(): Promise<ReleaseManifest | undefined> {
  try {
    const response = await fetch(RELEASES_URL, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return response.ok ? await response.json() as ReleaseManifest : undefined;
  } catch {
    return undefined;
  }
}

/** Which app fits the device this browser runs on */
export function getDevicePlatform(): AppPlatform | undefined {
  if (IS_WINDOWS) return 'windows';
  if (IS_ANDROID) return 'android';
  return undefined;
}

/** Every app of the release, the one for this device first; nothing inside the app itself */
export function getAppDownloads(manifest: ReleaseManifest): AppDownload[] {
  if (IS_TAURI) return [];
  const { version } = manifest;
  const downloads: AppDownload[] = [];
  const windowsUrl = manifest.platforms?.['windows-x86_64']?.url;
  if (windowsUrl) downloads.push({ platform: 'windows', version, url: windowsUrl });
  if (manifest.android?.url) downloads.push({ platform: 'android', version, url: manifest.android.url });
  const own = getDevicePlatform();
  return downloads.sort((a, b) => Number(b.platform === own) - Number(a.platform === own));
}

/** Tauri mobile cannot update itself: the Android shell offers the newer APK from the manifest */
export async function getAndroidAppUpdate(currentVersion: string) {
  const manifest = await fetchReleaseManifest();
  const url = manifest?.android?.url;
  return manifest && url && isNewerVersion(manifest.version, currentVersion)
    ? { version: manifest.version, url }
    : undefined;
}

/** The system downloads the file and offers to install it */
export async function openAppDownload(url: string) {
  const { open } = await import('@tauri-apps/plugin-shell');
  await open(url);
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
