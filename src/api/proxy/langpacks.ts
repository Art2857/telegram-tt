import type { MethodArgs } from '../gramjs/methods/types';
import type { ApiLanguage, LangPackStringValue } from '../types';

import { pxgRpc } from '../../proxygram/server/rpc';

type LangpackDto = {
  language: ApiLanguage;
  version: number;
  strings: Record<string, LangPackStringValue>;
};

/** The server leaves out the strings when the client's version is up to date */
type LangpackDifferenceDto = Omit<LangpackDto, 'strings'> & Partial<Pick<LangpackDto, 'strings'>>;

/** A guest has no Telegram session: Telegram's languages and packs come through the Proxygram server */
export function fetchLanguages() {
  // Until a connected account reads the list, the screen keeps its loader instead of an error
  return pxgRpc.call<ApiLanguage[]>('langpack.languages').catch(() => undefined);
}

export async function fetchLanguage({ langCode }: MethodArgs<'fetchLanguage'>[0]) {
  return (await pxgRpc.call<LangpackDto>('langpack.get', { langCode })).language;
}

export async function fetchLangPack({ langCode }: MethodArgs<'fetchLangPack'>[0]) {
  const { version, strings } = await pxgRpc.call<LangpackDto>('langpack.get', { langCode });
  return { langCode, fromVersion: 0, version, strings, keysToRemove: [] };
}

/** The server keeps whole packs, so a newer version arrives in full: every string replaces the cached one */
export async function fetchLangDifference({ langCode, fromVersion }: MethodArgs<'fetchLangDifference'>[0]) {
  const { version, strings } = await pxgRpc.call<LangpackDifferenceDto>('langpack.get', { langCode, fromVersion });
  return strings
    ? { langCode, fromVersion, version, strings, keysToRemove: [] }
    : { langCode, fromVersion, version: fromVersion, strings: {}, keysToRemove: [] };
}
