// PXG: методы Proxygram, которым нужна сессия Telegram этого устройства (работают в воркере GramJS)
import { Api as GramJs } from '../../../lib/gramjs';
import { generateRandomBigInt } from '../../../lib/gramjs/Helpers';

import type { SrpChallengeDto } from '../../../proxygram/server/types';

import { computeSrpAnswer } from '../../../proxygram/srp';
import { invokeRequest } from './client';

function fromBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Подтвердить вход сервера Proxygram своей сессией — как сканирование QR, только без QR (PLAN.md, 7.4).
 * Токен выдал наш сервер: подтверждаем только его, по защищённому соединению.
 */
export async function pxgAcceptLoginToken(token: string) {
  const result = await invokeRequest(new GramJs.auth.AcceptLoginToken({ token: fromBase64(token) }), {
    shouldThrow: true,
  });
  return Boolean(result);
}

/** Ответ SRP на 2FA сервера: пароль остаётся на устройстве, на сервер уходит только доказательство */
export function pxgComputeSrp(challenge: SrpChallengeDto, password: string) {
  return computeSrpAnswer(challenge, password);
}

/** Нажать Start у бота Proxygram своей сессией: так сервер узнаёт, кто вошёл (PLAN.md, 7.3) */
export async function pxgStartBot(username: string, startParam: string) {
  const resolved = await invokeRequest(new GramJs.contacts.ResolveUsername({ username }), { shouldThrow: true });
  const bot = resolved?.users.find((user): user is GramJs.User => user instanceof GramJs.User && Boolean(user.bot));
  if (!bot?.accessHash) throw new Error('BOT_NOT_FOUND');

  const inputUser = new GramJs.InputUser({ userId: bot.id, accessHash: bot.accessHash });
  await invokeRequest(new GramJs.messages.StartBot({
    bot: inputUser,
    peer: new GramJs.InputPeerUser({ userId: bot.id, accessHash: bot.accessHash }),
    randomId: generateRandomBigInt(),
    startParam,
  }), { shouldThrow: true });
  return true;
}
