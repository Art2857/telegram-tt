import { describe, expect, it } from 'vitest';

import { getProxygramString } from './lang';

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
