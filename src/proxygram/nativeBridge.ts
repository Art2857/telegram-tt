import { getActions } from '../global';

/**
 * The Android app's own bridge (`tauri/gen/android/.../NativeBridge.kt`). Its web view neither opens links outside
 * nor saves `<a download>` files, and Tauri's `shell.open` does not work on Android. Missing in APK 1.0.6 and older
 */
type NativeBridge = {
  openUrl: (url: string) => boolean;
  saveBegin: (name: string, mimeType: string) => string;
  saveChunk: (id: string, base64: string) => boolean;
  saveFinish: (id: string) => string;
  saveCancel: (id: string) => void;
};

/** Bytes per call: the bridge passes strings, so a chunk travels as base64 */
const CHUNK_BYTES = 512 * 1024;

export function getNativeBridge() {
  return (window as { PxgNative?: NativeBridge }).PxgNative;
}

export function openUrlNatively(url: string) {
  return getNativeBridge()?.openUrl(url) ?? false;
}

/** The file goes to the device's Downloads; the person sees where it went */
export async function saveFileNatively(url: string, filename: string) {
  const bridge = getNativeBridge();
  if (!bridge) return false;
  const { showNotification } = getActions();
  let id = '';
  try {
    const blob = await fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    });
    id = bridge.saveBegin(filename, blob.type);
    if (id === 'storage') {
      showNotification({ message: { key: 'PxgFileSavePermission' } });
      return true;
    }
    if (!id) throw new Error('saveBegin');
    for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
      const base64 = await readBase64(blob.slice(offset, offset + CHUNK_BYTES));
      if (!bridge.saveChunk(id, base64)) throw new Error('saveChunk');
    }
    const savedName = bridge.saveFinish(id);
    id = '';
    if (!savedName) throw new Error('saveFinish');
    showNotification({ message: { key: 'PxgFileSaved', variables: { name: savedName } } });
  } catch {
    if (id && id !== 'storage') bridge.saveCancel(id);
    showNotification({ message: { key: 'PxgFileSaveFailed' } });
  }
  return true;
}

function readBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
