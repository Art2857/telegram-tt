import type { LangPack } from '../api/types';

import { buildFallbackStrings } from '../util/data/readFallbackStrings';
import ruStrings from './lang/ru.strings?raw';

// Строки Proxygram (`Pxg*`) отсутствуют в языковых пакетах Telegram. Английские лежат в
// `fallback.strings` (там их видит генератор типов `lang:ts`), переводы — здесь
const PACKS: Record<string, LangPack['strings']> = {
  ru: buildFallbackStrings(ruStrings).langPack.strings,
};

const KEY_PREFIX = 'Pxg';

export function getProxygramString(langKey: string, langCode: string | undefined) {
  if (!langCode || !langKey.startsWith(KEY_PREFIX)) return undefined;

  return PACKS[langCode.split('-')[0]]?.[langKey];
}
