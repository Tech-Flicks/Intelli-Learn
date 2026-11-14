/**
 * Encryption at rest for the AI API key.
 *
 * Secrets are encrypted with AES-GCM 256 under a device key that lives in
 * IndexedDB (`db.kv`, key 'device-key') as a NON-EXTRACTABLE CryptoKey: the
 * browser can use it, but no script, backup or export can read its bytes.
 * Every encryption uses a fresh random 12-byte IV.
 *
 * The device key never leaves the device and is not part of any backup, so a
 * secret encrypted here cannot be decrypted anywhere else.
 */
import type { EncryptedBlob } from '@/core/types';
import { db, getSettings, updateSettings } from '@/data';
import { base64ToBytes, bytesToBase64, randomBytes } from './encoding';

export const DEVICE_KEY_ID = 'device-key';

const ALGORITHM = 'AES-GCM';
const KEY_BITS = 256;
const IV_BYTES = 12;
const USAGES: KeyUsage[] = ['encrypt', 'decrypt'];

/**
 * Degraded fallback form of the stored device key: the raw key bytes.
 * Used only where IndexedDB cannot store a CryptoKey (see `loadDeviceKey`).
 */
interface RawDeviceKey {
  format: 'raw';
  bytes: Uint8Array<ArrayBuffer>;
}

function isCryptoKey(value: unknown): value is CryptoKey {
  if (typeof value !== 'object' || value === null) return false;
  // Duck-typed on purpose: a key read back from IndexedDB can come from another realm, where `instanceof` fails.
  const key = value as Partial<CryptoKey>;
  return (
    key.type === 'secret' &&
    typeof key.algorithm === 'object' &&
    key.algorithm !== null &&
    key.algorithm.name === ALGORITHM &&
    Array.isArray(key.usages) &&
    key.usages.includes('encrypt') &&
    key.usages.includes('decrypt')
  );
}

function isRawDeviceKey(value: unknown): value is RawDeviceKey {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Partial<RawDeviceKey>;
  // `ArrayBuffer.isView` rather than `instanceof`: bytes read back from IndexedDB can belong to another realm.
  return raw.format === 'raw' && ArrayBuffer.isView(raw.bytes) && raw.bytes.byteLength === KEY_BITS / 8;
}

function isStoredKey(value: unknown): value is CryptoKey | RawDeviceKey {
  return isCryptoKey(value) || isRawDeviceKey(value);
}

function toCryptoKey(stored: CryptoKey | RawDeviceKey): Promise<CryptoKey> {
  if (isCryptoKey(stored)) return Promise.resolve(stored);
  return crypto.subtle.importKey('raw', new Uint8Array(stored.bytes), ALGORITHM, false, USAGES);
}

/**
 * Stores `candidate` as the device key unless a usable key is already there
 * (another tab may have created one a moment ago) and returns whichever key
 * is now stored. Returns null when the stored value did not survive the round
 * trip through IndexedDB.
 *
 * No crypto call may be awaited in here: an IndexedDB transaction commits as
 * soon as its callback waits on anything that is not a database request.
 */
function storeIfAbsent(candidate: CryptoKey | RawDeviceKey): Promise<CryptoKey | RawDeviceKey | null> {
  return db.transaction('rw', db.kv, async () => {
    const current = await db.kv.get(DEVICE_KEY_ID);
    if (current && isStoredKey(current.value)) return current.value;
    await db.kv.put({ key: DEVICE_KEY_ID, value: candidate });
    const saved = await db.kv.get(DEVICE_KEY_ID);
    return saved && isStoredKey(saved.value) ? saved.value : null;
  });
}

/** Returns the device key, creating it on first use. */
async function loadDeviceKey(): Promise<CryptoKey> {
  const existing = await db.kv.get(DEVICE_KEY_ID);
  if (existing && isStoredKey(existing.value)) return toCryptoKey(existing.value);

  // Normal path: a non-extractable key, stored as a CryptoKey object.
  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, false, USAGES);
  let stored: CryptoKey | RawDeviceKey | null = null;
  try {
    stored = await storeIfAbsent(key);
  } catch {
    stored = null; // DataCloneError: this environment cannot put a CryptoKey into IndexedDB.
  }

  if (!stored) {
    // DEGRADED FALLBACK. Some environments (a few test runners and old or
    // embedded browsers) cannot structured-clone a CryptoKey into IndexedDB.
    // There the raw key bytes are stored instead. That still keeps the API
    // key out of plain sight and out of backups, but a script with database
    // access could read the key bytes, which the normal path prevents.
    stored = await storeIfAbsent({ format: 'raw', bytes: randomBytes(KEY_BITS / 8) });
    if (!stored) throw new Error('This browser cannot store the device key.');
  }
  return toCryptoKey(stored);
}

/** Encrypts a string with the device key. Each call uses a new random IV. */
export async function encryptSecret(plain: string): Promise<EncryptedBlob> {
  const key = await loadDeviceKey();
  const iv = randomBytes(IV_BYTES);
  const data = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, new TextEncoder().encode(plain));
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) };
}

/**
 * Decrypts a blob made by `encryptSecret` on this device.
 * Throws when the blob is damaged or was encrypted with another device key.
 */
export async function decryptSecret(blob: EncryptedBlob): Promise<string> {
  const stored = (await db.kv.get(DEVICE_KEY_ID))?.value;
  // Never create a key just to decrypt: a new key cannot open an old secret.
  if (!isStoredKey(stored)) throw new Error('The device key is missing.');
  const iv = base64ToBytes(blob.iv);
  if (iv.byteLength !== IV_BYTES) throw new Error('The encrypted value is damaged.');
  const key = await toCryptoKey(stored);
  const plain = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, base64ToBytes(blob.data));
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}

/** Stores the AI API key encrypted in settings.ai.apiKeyCipher. Null or blank removes it. */
export async function setApiKey(plain: string | null): Promise<void> {
  const trimmed = plain?.trim() ?? '';
  const apiKeyCipher = trimmed.length > 0 ? await encryptSecret(trimmed) : null;
  await updateSettings((current) => ({ ...current, ai: { ...current.ai, apiKeyCipher } }));
}

/**
 * The stored API key, or null when none is set or it cannot be decrypted
 * (for example after the device key was reset). Never throws.
 */
export async function getApiKey(): Promise<string | null> {
  try {
    const cipher = (await getSettings()).ai.apiKeyCipher;
    if (!cipher) return null;
    const plain = await decryptSecret(cipher);
    return plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}

/** True when a usable API key is stored. */
export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}
