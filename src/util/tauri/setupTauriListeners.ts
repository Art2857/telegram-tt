import { getActions } from '../../global';

import { DEBUG } from '../../config';
import { IS_ANDROID, MouseButton } from '../browser/windowEnvironment';

type DownloadFinishedEvent = {
  success: boolean;
  url: string;
};

let isSetup = false;
export default function setupTauriListeners() {
  if (isSetup) return;
  isSetup = true;

  // Disable default tauri context menu in production build
  if (!DEBUG) {
    document.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
  }

  const eventPromise = import('@tauri-apps/api/event');
  eventPromise.then(({ listen }) => {
    listen<DownloadFinishedEvent>('download-finished', (event) => {
      if (event.payload.success) return;

      getActions().showNotification({
        message: { key: 'NativeDownloadFailed' },
      });
    });
  });

  // Disable Backspace handling as back navigation
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Backspace' || event.code === 'Backspace') {
      const target = event.target as HTMLElement | null;
      const isInputField = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;

      if (!isInputField) {
        event.preventDefault();
      }
    }
  }, true);

  window.open = (url: string | URL | undefined, target?: string, features?: string) => {
    if (url) openLink(url);
    // eslint-disable-next-line no-null/no-null
    return null;
  };

  function handleClick(event: MouseEvent) {
    if (event.defaultPrevented) return;

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest<HTMLAnchorElement>('a[href]');

    if (!anchor) return;

    if (anchor.target === '_blank'
      || event.ctrlKey
      || event.metaKey
      || event.button === MouseButton.Auxiliary
    ) {
      event.preventDefault();

      const href = anchor.getAttribute('href')!;
      openLink(href);
    }
  }

  // Run after Teact's delegated handlers so links can require confirmation
  window.addEventListener('click', handleClick);
  window.addEventListener('auxclick', handleClick);
}

async function openLink(url: string | URL) {
  try {
    const urlObject = url instanceof URL ? url : new URL(url, window.location.href);
    // A second app window only makes sense for the client itself and only on desktop: Android has no extra
    // windows (the tap was silently lost), and app files (/downloads/: APK, installer, release notes) are for
    // the system browser to download
    const isAppPage = window.location.origin === urlObject.origin && !urlObject.pathname.startsWith('/downloads/');
    if (isAppPage && !IS_ANDROID) {
      await window.tauri.openNewWindow(urlObject.toString());
    } else {
      const shellPlugin = await import('@tauri-apps/plugin-shell');
      await shellPlugin.open(urlObject.toString());
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to open link:', url, e);
  }
}
