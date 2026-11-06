import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import ruStrings from './lang/ru.strings?raw';
import { PXG_ERROR_REASON_KEYS } from './errorReasons';
import { getProxygramString } from './lang';

import fallbackStrings from '../assets/localization/fallback.strings?raw';

const KEY_LINE = /^"(Pxg[^"]*)"\s*=\s*"((?:[^"\\]|\\.)*)";\s*$/;
const CYRILLIC = /[Ѐ-ӿ]/;
const PLACEHOLDER = /\{(\w+)\}/g;
/** Russian translations that are the same word in both languages */
const LATIN_IN_RUSSIAN = new Set(['PxgAuthChoiceTitle', 'PxgStatusFlood', 'PxgMediaGif']);

/** Proxygram's own strings with their keys, in file order: duplicates stay visible */
function readPxgLines(file: string) {
  return file.split(/\r?\n/).flatMap((line) => {
    const match = line.match(KEY_LINE);
    return match ? [{ key: match[1], value: match[2] }] : [];
  });
}

function placeholdersOf(value: string) {
  return [...value.matchAll(PLACEHOLDER)].map(([, name]) => name).sort();
}

function duplicatesOf(keys: string[]) {
  return keys.filter((key, index) => keys.indexOf(key) !== index);
}

describe('getProxygramString', () => {
  it('returns Russian strings for Pxg keys', () => {
    expect(getProxygramString('PxgDeleted', 'ru')).toBe('удалено');
    expect(getProxygramString('PxgDeleted', 'ru-RU')).toBe('удалено');
  });

  it('leaves non-Proxygram keys and unknown languages to the regular language packs', () => {
    expect(getProxygramString('SavedMessages', 'ru')).toBeUndefined();
    expect(getProxygramString('PxgDeleted', 'de')).toBeUndefined();
    expect(getProxygramString('PxgDeleted', undefined)).toBeUndefined();
  });

  it('tolerates a missing key, as the upstream lookup does', () => {
    expect(getProxygramString(undefined, 'ru')).toBeUndefined();
  });
});

describe('Proxygram strings', () => {
  const english = readPxgLines(fallbackStrings);
  const russian = readPxgLines(ruStrings);
  const englishByKey = new Map(english.map(({ key, value }) => [key, value]));
  const russianByKey = new Map(russian.map(({ key, value }) => [key, value]));

  it('every line with a Pxg key is well-formed', () => {
    const malformed = (file: string) => file.split(/\r?\n/)
      .filter((line) => line.startsWith('"Pxg') && !KEY_LINE.test(line));

    expect(malformed(fallbackStrings)).toEqual([]);
    expect(malformed(ruStrings)).toEqual([]);
    expect(english.length).toBeGreaterThan(0);
  });

  it('has no duplicate keys', () => {
    expect(duplicatesOf(english.map(({ key }) => key))).toEqual([]);
    expect(duplicatesOf(russian.map(({ key }) => key))).toEqual([]);
  });

  it('has a Russian translation for every English string and nothing extra', () => {
    expect([...englishByKey.keys()].filter((key) => !russianByKey.has(key))).toEqual([]);
    expect([...russianByKey.keys()].filter((key) => !englishByKey.has(key))).toEqual([]);
  });

  it('keeps the same placeholders in both languages', () => {
    const mismatched = [...englishByKey].filter(([key, value]) => (
      russianByKey.has(key) && placeholdersOf(value).join() !== placeholdersOf(russianByKey.get(key)!).join()
    )).map(([key]) => key);

    expect(mismatched).toEqual([]);
  });

  it('has no empty strings, English in English and Russian in Russian', () => {
    expect([...englishByKey, ...russianByKey].filter(([, value]) => !value.trim()).map(([key]) => key)).toEqual([]);
    expect([...englishByKey].filter(([, value]) => CYRILLIC.test(value)).map(([key]) => key)).toEqual([]);
    expect([...russianByKey]
      .filter(([key, value]) => !CYRILLIC.test(value) && !LATIN_IN_RUSSIAN.has(key))
      .map(([key]) => key)).toEqual([]);
  });
});

describe('Proxygram code has no hardcoded user-visible text', () => {
  const sources = Object.entries({
    ...import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob<string>('../components/proxygram/**/*.{ts,tsx}', {
      query: '?raw', import: 'default', eager: true,
    }),
    ...import.meta.glob<string>('../api/proxy/**/*.ts', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob<string>('../global/actions/api/proxy.ts', { query: '?raw', import: 'default', eager: true }),
  }).filter(([path]) => !path.endsWith('.test.ts'))
    .map(([path, source]) => [path, withoutComments(source)] as const);
  /** Language names are written in their own language, as in Telegram */
  const allowedCyrillic = [/name: '[^']+' \},$/];
  /** Two Latin words in a row: a phrase, not a product name like «Node.js» or an example like «chat.example.org» */
  const PHRASE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;
  /** Text between JSX tags; `=>` and `->` are not tags */
  const JSX_TEXT = /(?<![=-])>([^<>{}]+)</g;
  const JSX_TEXT_PROP = /\b(?:title|placeholder|label|ariaLabel|aria-label|alt|subtitle|description)="([^"]+)"/g;

  it('has no Russian outside the Pxg strings', () => {
    const offending = sources.flatMap(([path, source]) => source.split('\n').flatMap((line, index) => (
      CYRILLIC.test(line) && !allowedCyrillic.some((pattern) => pattern.test(line.trim()))
        ? [`${path}:${index + 1}: ${line.trim()}`]
        : []
    )));

    expect(sources.length).toBeGreaterThan(50);
    expect(offending).toEqual([]);
  });

  it('has no English phrases written straight into JSX', () => {
    const offending = sources.filter(([path]) => path.endsWith('.tsx')).flatMap(([path, source]) => [
      ...[...source.matchAll(JSX_TEXT)].map(([, text]) => text.trim())
        .filter((text) => PHRASE.test(text) && !/[;(){}=&|?:]/.test(text)),
      ...[...source.matchAll(JSX_TEXT_PROP)].map(([, text]) => text).filter((text) => PHRASE.test(text)),
    ].map((text) => `${path}: ${text}`));

    expect(offending).toEqual([]);
  });
});

/** Blanks out comments and keeps line numbers; strings with `//` inside (URLs) are left as they are */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

describe('server refusal reasons', () => {
  it('every reason of packages/protocol has a string, and no others', () => {
    // Tests run from apps/client
    const protocol = readFileSync(resolve(process.cwd(), '../../packages/protocol/src/errors.ts'), 'utf8');
    const list = protocol.slice(protocol.indexOf('RPC_ERROR_REASONS = ['), protocol.indexOf('] as const'));
    const reasons = [...list.matchAll(/'(\w+)'/g)].map(([, reason]) => reason);

    expect(reasons.length).toBeGreaterThan(50);
    expect(Object.keys(PXG_ERROR_REASON_KEYS).sort()).toEqual([...reasons].sort());
  });
});
