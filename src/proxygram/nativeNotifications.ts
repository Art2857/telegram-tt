import type { ActionPerformed, Options } from '@tauri-apps/plugin-notification';

import { IS_TAURI } from '../util/browser/globalEnvironment';
import { IS_ANDROID } from '../util/browser/windowEnvironment';
import { ACCOUNT_SLOT } from '../util/multiaccount';

/**
 * Уведомления приложения (APK и Windows) — как в Telegram: одно уведомление на чат с последними сообщениями,
 * нажатие открывает этот чат. Web A показывал их через `new Notification`, который плагин Tauri подменяет:
 * без номера и данных чата каждое сообщение приходило отдельным уведомлением, а нажатие только открывало
 * приложение (2026-11-15).
 */

export type NotificationTarget = { chatId: string; messageId?: number; slot: number };

/** Сколько последних сообщений чата видно в развёрнутом уведомлении Android */
const MAX_LINES = 6;
const GROUP = 'pxg-messages';

const linesByChat = new Map<string, string[]>();
let pluginPromise: Promise<typeof import('@tauri-apps/plugin-notification')> | undefined;
let isListening = false;

function getPlugin() {
  pluginPromise ??= import('@tauri-apps/plugin-notification');
  return pluginPromise;
}

export function isNativeNotifications() {
  return IS_TAURI;
}

/** Номер уведомления чата: 32-битное число, одно и то же для чата в этом слоте — новое сообщение заменяет прежнее */
export function getChatNotificationId(chatId: string, slot = ACCOUNT_SLOT || 1) {
  const key = `${slot}:${chatId}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  }
  return hash || 1;
}

/** Строки развёрнутого уведомления: последние сообщения чата, самое новое внизу */
export function appendChatLine(chatId: string, line: string) {
  const lines = [...(linesByChat.get(chatId) || []), line].slice(-MAX_LINES);
  linesByChat.set(chatId, lines);
  return lines;
}

export function buildNativeNotification({
  chatId, messageId, title, body, lines, isSilent, newCount,
}: {
  chatId: string;
  messageId: number;
  title: string;
  body: string;
  lines: string[];
  isSilent?: boolean;
  /** Сколько новых сообщений чата собрано в уведомлении */
  newCount: number;
}): Options {
  return {
    id: getChatNotificationId(chatId),
    title,
    body,
    ...(IS_ANDROID && lines.length > 1 ? { inboxLines: lines, summary: String(newCount) } : {}),
    ...(IS_ANDROID ? { group: GROUP } : {}),
    autoCancel: true,
    silent: isSilent || undefined,
    extra: { chatId, messageId, slot: ACCOUNT_SLOT || 1 },
  };
}

const countByChat = new Map<string, number>();
/** Самое новое сообщение, о котором уведомление: прочтение до него убирает уведомление */
const lastIdByChat = new Map<string, number>();

export async function showNativeMessageNotification(params: {
  chatId: string; messageId: number; title: string; body: string; isSilent?: boolean;
}) {
  const lines = appendChatLine(params.chatId, params.body);
  const newCount = (countByChat.get(params.chatId) || 0) + 1;
  countByChat.set(params.chatId, newCount);
  lastIdByChat.set(params.chatId, Math.max(params.messageId, lastIdByChat.get(params.chatId) || 0));
  const plugin = await getPlugin();
  plugin.sendNotification(buildNativeNotification({ ...params, lines, newCount }));
}

/**
 * Чат прочитан до последнего сообщения уведомления (здесь или на другом устройстве): уведомление убирается (Android;
 * на Windows система убирает его сама). Без номера прочитанного — только при нажатии на уведомление
 */
export function clearNativeChatNotifications(chatId: string, lastReadInboxMessageId?: number) {
  if (!IS_TAURI || !linesByChat.has(chatId)) return;
  const lastId = lastIdByChat.get(chatId) || 0;
  if (lastReadInboxMessageId === undefined || lastReadInboxMessageId < lastId) return;
  forgetChat(chatId);
  if (!IS_ANDROID) return;
  void getPlugin().then((plugin) => plugin.removeActive([{ id: getChatNotificationId(chatId) }])).catch(() => {
    // Нет разрешения или уведомление уже убрано
  });
}

/** Что открыть по нажатию: только уведомления этого слота, со своим чатом */
export function parseNotificationTarget(event: Pick<ActionPerformed, 'actionId' | 'notification'>) {
  if (event.actionId && event.actionId !== 'tap') return undefined;
  const extra = event.notification?.extra;
  const chatId = typeof extra?.chatId === 'string' ? extra.chatId : undefined;
  if (!chatId) return undefined;
  const messageId = Number(extra?.messageId) || undefined;
  const slot = Number(extra?.slot) || 1;
  return { chatId, messageId, slot } satisfies NotificationTarget;
}

/**
 * Нажатие на уведомление: окно выходит вперёд (из трея тоже), открывается чат. Окно другого аккаунта своё
 * уведомление обработает само
 */
export async function listenNativeNotificationClicks(onOpen: (target: NotificationTarget) => void) {
  if (!IS_TAURI || isListening) return;
  isListening = true;
  try {
    const plugin = await getPlugin();
    await plugin.onAction((event) => {
      const target = parseNotificationTarget(event);
      if (!target || target.slot !== (ACCOUNT_SLOT || 1)) return;
      forgetChat(target.chatId);
      void bringWindowToFront();
      onOpen(target);
    });
  } catch {
    isListening = false;
  }
}

function forgetChat(chatId: string) {
  linesByChat.delete(chatId);
  countByChat.delete(chatId);
  lastIdByChat.delete(chatId);
}

async function bringWindowToFront() {
  if (IS_ANDROID) return;
  try {
    const tauriWindow = await window.tauri?.getCurrentWindow();
    await tauriWindow?.unminimize();
    await tauriWindow?.show();
    await tauriWindow?.setFocus();
  } catch {
    // Без разрешений на окно уведомление всё равно открывает чат
  }
}
