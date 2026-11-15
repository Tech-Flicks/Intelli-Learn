import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getSettings } from '@/data';
import { cryptoAvailable, getApiKey, hasAdminPassword, INSECURE_CONTEXT_MESSAGE, setAdminPassword, setApiKey } from './index';

const realCrypto = globalThis.crypto;

/** What a browser offers on a plain http page that is not localhost: random numbers, but no `crypto.subtle`. */
function openInsecurely(): void {
  vi.stubGlobal('crypto', {
    getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    randomUUID: realCrypto.randomUUID.bind(realCrypto),
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a page that is not a secure context', () => {
  it('is detected', () => {
    expect(cryptoAvailable()).toBe(true);
    openInsecurely();
    expect(cryptoAvailable()).toBe(false);
  });

  it('refuses to set a password with a message a parent can act on, and stores nothing', async () => {
    openInsecurely();
    await expect(setAdminPassword('correct horse', { iterations: 1000 })).rejects.toThrow(INSECURE_CONTEXT_MESSAGE);
    expect(await hasAdminPassword()).toBe(false);
    expect((await getSettings()).auth).toBeNull();
  });

  it('refuses to store an API key the same way, and reads none', async () => {
    openInsecurely();
    await expect(setApiKey('sk-secret')).rejects.toThrow(INSECURE_CONTEXT_MESSAGE);
    expect((await getSettings()).ai.apiKeyCipher).toBeNull();
    expect(await getApiKey()).toBeNull();
  });
});
