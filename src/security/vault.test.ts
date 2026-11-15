import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getSettings, wipeEverything } from '@/data';
import { base64ToBytes } from './encoding';
import { updateSettings } from '@/data';
import {
  API_KEY_ORIGIN_KEY,
  decryptSecret,
  DEVICE_KEY_ID,
  encryptSecret,
  getApiKey,
  getApiKeyFor,
  getApiKeyOrigin,
  hasApiKey,
  keepApiKeyOrigin,
  serviceOrigin,
  setApiKey,
} from './vault';

const SECRET = 'sk-test-ĀЖ🦄-1234567890';

function isCryptoKeyValue(value: unknown): value is CryptoKey {
  return typeof value === 'object' && value !== null && (value as CryptoKey).type === 'secret';
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', async () => {
    const blob = await encryptSecret(SECRET);
    expect(await decryptSecret(blob)).toBe(SECRET);
  });

  it('round-trips an empty string', async () => {
    expect(await decryptSecret(await encryptSecret(''))).toBe('');
  });

  it('produces base64 with a 12-byte IV and no trace of the plain text', async () => {
    const blob = await encryptSecret(SECRET);

    expect(base64ToBytes(blob.iv)).toHaveLength(12);
    // AES-GCM: cipher text is as long as the plain text plus a 16-byte tag.
    expect(base64ToBytes(blob.data)).toHaveLength(new TextEncoder().encode(SECRET).length + 16);
    expect(JSON.stringify(blob)).not.toContain('sk-test');
    expect(atob(blob.data)).not.toContain('sk-test');
  });

  it('uses a fresh IV for every encryption', async () => {
    const blobs = await Promise.all(Array.from({ length: 20 }, () => encryptSecret(SECRET)));
    expect(new Set(blobs.map((b) => b.iv)).size).toBe(20);
    expect(new Set(blobs.map((b) => b.data)).size).toBe(20);
  });

  it('keeps one non-extractable AES-GCM 256 key in db.kv', async () => {
    await encryptSecret('a');
    await encryptSecret('b');

    expect(await db.kv.count()).toBe(1);
    const stored = (await db.kv.get(DEVICE_KEY_ID))?.value;
    expect(isCryptoKeyValue(stored)).toBe(true);
    const key = stored as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('creates a single key when the first encryptions run at the same time', async () => {
    const blobs = await Promise.all([encryptSecret('one'), encryptSecret('two'), encryptSecret('three')]);

    expect(await db.kv.count()).toBe(1);
    expect(await Promise.all(blobs.map(decryptSecret))).toEqual(['one', 'two', 'three']);
  });

  it('still decrypts after the database is reopened', async () => {
    const blob = await encryptSecret(SECRET);
    db.close();
    await db.open();
    expect(await decryptSecret(blob)).toBe(SECRET);
  });

  it('rejects tampered cipher text, a tampered IV and malformed blobs', async () => {
    const blob = await encryptSecret(SECRET);
    const data = base64ToBytes(blob.data);
    data[0] = (data[0] ?? 0) ^ 1;
    const tampered = btoa(String.fromCharCode(...data));
    const otherIv = (await encryptSecret('x')).iv;

    await expect(decryptSecret({ iv: blob.iv, data: tampered })).rejects.toThrow();
    await expect(decryptSecret({ iv: otherIv, data: blob.data })).rejects.toThrow();
    await expect(decryptSecret({ iv: 'AAAA', data: blob.data })).rejects.toThrow(/damaged/);
    await expect(decryptSecret({ iv: '***', data: '***' })).rejects.toThrow();
  });

  it('cannot decrypt with another device key, and does not create one while trying', async () => {
    const blob = await encryptSecret(SECRET);
    await db.kv.clear();

    await expect(decryptSecret(blob)).rejects.toThrow(/device key/);
    expect(await db.kv.count()).toBe(0);

    await encryptSecret('new key now');
    await expect(decryptSecret(blob)).rejects.toThrow();
  });

  it('replaces an unusable stored key', async () => {
    await db.kv.put({ key: DEVICE_KEY_ID, value: { broken: true } });
    const blob = await encryptSecret(SECRET);
    expect(await decryptSecret(blob)).toBe(SECRET);
    expect(isCryptoKeyValue((await db.kv.get(DEVICE_KEY_ID))?.value)).toBe(true);
  });
});

describe('degraded fallback when IndexedDB cannot store a CryptoKey', () => {
  it('stores raw key bytes when storing the CryptoKey throws', async () => {
    const realPut = db.kv.put.bind(db.kv);
    vi.spyOn(db.kv, 'put').mockImplementation((item, key) => {
      if (isCryptoKeyValue(item.value)) throw new DOMException('CryptoKey could not be cloned.', 'DataCloneError');
      return realPut(item, key);
    });

    const blob = await encryptSecret(SECRET);

    const stored = (await db.kv.get(DEVICE_KEY_ID))?.value as { format: string; bytes: Uint8Array };
    expect(stored.format).toBe('raw');
    expect(stored.bytes).toHaveLength(32);
    expect(await decryptSecret(blob)).toBe(SECRET);
    expect(await decryptSecret(await encryptSecret('again'))).toBe('again');
    expect(await db.kv.count()).toBe(1);
  });

  it('stores raw key bytes when the CryptoKey does not survive the round trip', async () => {
    const realPut = db.kv.put.bind(db.kv);
    vi.spyOn(db.kv, 'put').mockImplementation((item, key) =>
      // Some environments silently store an empty object in place of a CryptoKey.
      realPut(isCryptoKeyValue(item.value) ? { ...item, value: {} } : item, key),
    );

    const blob = await encryptSecret(SECRET);

    const stored = (await db.kv.get(DEVICE_KEY_ID))?.value as { format: string };
    expect(stored.format).toBe('raw');
    expect(await decryptSecret(blob)).toBe(SECRET);
  });
});

describe('API key', () => {
  it('has no key at first', async () => {
    expect(await hasApiKey()).toBe(false);
    expect(await getApiKey()).toBeNull();
  });

  it('stores the key encrypted in settings.ai.apiKeyCipher', async () => {
    await setApiKey(SECRET);

    const cipher = (await getSettings()).ai.apiKeyCipher;
    expect(cipher).toEqual({ iv: expect.any(String), data: expect.any(String) });
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('sk-test');
    expect(await hasApiKey()).toBe(true);
    expect(await getApiKey()).toBe(SECRET);
  });

  it('trims the key and leaves the other AI settings alone', async () => {
    const before = (await getSettings()).ai;
    await setApiKey('  sk-padded \n');

    expect(await getApiKey()).toBe('sk-padded');
    expect((await getSettings()).ai).toMatchObject({ ...before, apiKeyCipher: expect.anything() });
  });

  it('replaces an existing key', async () => {
    await setApiKey('sk-first');
    await setApiKey('sk-second');
    expect(await getApiKey()).toBe('sk-second');
  });

  it.each([[null], [''], ['   ']])('removes the key for %j', async (value) => {
    await setApiKey(SECRET);
    await setApiKey(value);

    expect((await getSettings()).ai.apiKeyCipher).toBeNull();
    expect(await hasApiKey()).toBe(false);
    expect(await getApiKey()).toBeNull();
  });

  it('returns null instead of throwing when the key cannot be decrypted', async () => {
    await setApiKey(SECRET);
    await db.kv.clear();

    await expect(getApiKey()).resolves.toBeNull();
    expect(await hasApiKey()).toBe(false);
  });

  it('returns null for a damaged cipher record', async () => {
    await setApiKey(SECRET);
    const settings = await getSettings();
    await db.settings.put({ ...settings, ai: { ...settings.ai, apiKeyCipher: { iv: '***', data: 'junk' } } });

    await expect(getApiKey()).resolves.toBeNull();
  });

  it('is gone after a full reset, and a new key works afterwards', async () => {
    await setApiKey(SECRET);
    await wipeEverything();

    expect(await getApiKey()).toBeNull();
    await setApiKey('sk-after-reset');
    expect(await getApiKey()).toBe('sk-after-reset');
  });
});

describe('the service an API key belongs to', () => {
  const OPENAI = 'https://api.openai.com/v1';

  async function saveDirectAddress(baseUrl: string, provider: 'direct' | 'demo' | 'proxy' = 'direct'): Promise<void> {
    await updateSettings((current) => ({ ...current, ai: { ...current.ai, provider, baseUrl } }));
  }

  it('reads the origin of an address and nothing from text that is not one', () => {
    expect(serviceOrigin(' https://api.openai.com/v1/ ')).toBe('https://api.openai.com');
    expect(serviceOrigin('http://localhost:11434/v1')).toBe('http://localhost:11434');
    expect(serviceOrigin('api.openai.com')).toBeNull();
    expect(serviceOrigin('javascript:alert(1)')).toBeNull();
    expect(serviceOrigin('')).toBeNull();
  });

  it('hands the key out for the address it was entered for, whatever the path', async () => {
    await setApiKey(SECRET, OPENAI);
    expect(await getApiKeyOrigin()).toBe('https://api.openai.com');
    expect(await getApiKeyFor(OPENAI)).toBe(SECRET);
    expect(await getApiKeyFor('https://api.openai.com/v2/other/')).toBe(SECRET);
  });

  it.each([
    ['another host', 'https://collector.example/v1'],
    ['a look-alike host', 'https://api.openai.com.collector.example/v1'],
    ['the same host without TLS', 'http://api.openai.com/v1'],
    ['the same host on another port', 'https://api.openai.com:8443/v1'],
    ['a server on the home network', 'http://192.168.1.20:11434/v1'],
    ['text that is no address', 'api.openai.com'],
  ])('hands out nothing for %s', async (_what, address) => {
    await setApiKey(SECRET, OPENAI);
    expect(await getApiKeyFor(address)).toBeNull();
    // The key itself is still there for its own service.
    expect(await getApiKeyFor(OPENAI)).toBe(SECRET);
  });

  it('does not follow the address in the settings to another service', async () => {
    await saveDirectAddress(OPENAI);
    await setApiKey(SECRET, OPENAI);
    await saveDirectAddress('https://collector.example/v1');
    expect(await getApiKeyFor('https://collector.example/v1')).toBeNull();
    expect(await getApiKeyOrigin()).toBe('https://api.openai.com');
  });

  it('ties a key saved without an address to the Direct address in the settings', async () => {
    await saveDirectAddress(OPENAI);
    await setApiKey(SECRET);
    expect((await db.kv.get(API_KEY_ORIGIN_KEY))?.value).toBeUndefined();
    expect(await getApiKeyFor(OPENAI)).toBe(SECRET);
    expect(await getApiKeyFor('https://collector.example/v1')).toBeNull();

    // Written down before the address changes, it stays with that service.
    await keepApiKeyOrigin();
    await saveDirectAddress('https://collector.example/v1', 'demo');
    expect(await getApiKeyFor('https://collector.example/v1')).toBeNull();
    expect(await getApiKeyFor(OPENAI)).toBe(SECRET);
  });

  it('knows no service for a key without an address in Proxy mode, and writes nothing down then', async () => {
    await saveDirectAddress('/ai', 'proxy');
    await setApiKey(SECRET);
    expect(await getApiKeyOrigin()).toBeNull();
    await keepApiKeyOrigin();
    expect(await db.kv.get(API_KEY_ORIGIN_KEY)).toBeUndefined();
    expect(await getApiKeyFor(OPENAI)).toBeNull();
    expect(await hasApiKey()).toBe(true);
  });

  it('forgets the service with the key, and a new key gets its own', async () => {
    await setApiKey(SECRET, OPENAI);
    await setApiKey(null);
    expect(await db.kv.get(API_KEY_ORIGIN_KEY)).toBeUndefined();
    expect(await getApiKeyOrigin()).toBeNull();

    await setApiKey('sk-first', OPENAI);
    await setApiKey('sk-second', 'https://other.example/v1');
    expect(await getApiKeyFor(OPENAI)).toBeNull();
    expect(await getApiKeyFor('https://other.example/v1')).toBe('sk-second');
  });

  it('has no service when the key can no longer be decrypted', async () => {
    await setApiKey(SECRET, OPENAI);
    await db.kv.delete(DEVICE_KEY_ID);
    expect(await getApiKeyOrigin()).toBeNull();
    expect(await getApiKeyFor(OPENAI)).toBeNull();
  });
});
