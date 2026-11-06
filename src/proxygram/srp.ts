import { computeCheck } from '../lib/gramjs/Password';
import Api from '../lib/gramjs/tl/api';

import type { SrpChallengeDto } from './server/types';

function fromBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/**
 * Ответ SRP на 2FA серверной авторизации Proxygram: пароль остаётся на устройстве, на сервер уходит только
 * доказательство. Считается и в воркере GramJS (подключение своей сессией), и в главном потоке у гостя без
 * Telegram на устройстве (подключение по QR) — там модуль подгружается, только когда спрошен пароль
 */
export async function computeSrpAnswer(challenge: SrpChallengeDto, password: string) {
  const request = new Api.account.Password({
    currentAlgo: new Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow({
      salt1: fromBase64(challenge.salt1),
      salt2: fromBase64(challenge.salt2),
      g: challenge.g,
      p: fromBase64(challenge.p),
    }),
    srp_B: fromBase64(challenge.srpB),
    srpId: BigInt(challenge.srpId),
    // для расчёта ответа не нужны, но обязательны в конструкторе
    newAlgo: new Api.PasswordKdfAlgoUnknown(),
    newSecureAlgo: new Api.SecurePasswordKdfAlgoUnknown(),
    secureRandom: new Uint8Array(),
  });
  const check = await computeCheck(request, password);
  return { srpId: check.srpId.toString(), A: toBase64(check.A), M1: toBase64(check.M1) };
}
