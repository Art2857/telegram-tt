import { isTauri } from '@tauri-apps/api/core';

// eslint-disable-next-line no-shadow-restricted-names
declare const globalThis: ServiceWorkerGlobalScope & WorkerGlobalScope & SharedWorkerGlobalScope & Window;

export const IS_SHARED_WORKER_SUPPORTED = 'SharedWorker' in globalThis;
const IS_ANDROID_UA = /Android/.test(navigator.userAgent);
/**
 * Web A keeps account slots in the URL and local storage. Android WebView has no `SharedWorker`,
 * but one open account still needs slots: the app runs a single tab, so the worker is only used
 * for cross-tab state and is optional here.
 */
export const IS_MULTIACCOUNT_SUPPORTED = IS_SHARED_WORKER_SUPPORTED || (isTauri() && IS_ANDROID_UA);
export const IS_INTL_LIST_FORMAT_SUPPORTED = 'ListFormat' in Intl;
export const IS_BAD_URL_PARSER = new URL('tg://host').host !== 'host';

export const IS_TAURI = isTauri();
// @ts-expect-error no types for electron
export const IS_ELECTRON = Boolean(globalThis.electron);
