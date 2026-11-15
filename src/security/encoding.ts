/** Byte helpers shared by the password and vault code. */

/** Shown when the browser gives this page no Web Crypto. Written for a parent to read. */
export const INSECURE_CONTEXT_MESSAGE =
  'This page is not opened securely, so the browser cannot protect the parent password or the API key. Open Intelli-Learn through an https address, or on the device itself (localhost).';

/**
 * Whether Web Crypto can be used. Browsers only offer it in a secure context: https, or
 * localhost. A page opened as plain http from another device on the network has none.
 * The setup wizard should check this first and explain instead of failing.
 */
export function cryptoAvailable(): boolean {
  const api = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  return typeof api === 'object' && api !== null && typeof api.subtle === 'object' && api.subtle !== null && typeof api.getRandomValues === 'function';
}

/** Throws a readable error when Web Crypto is missing, instead of a "cannot read properties of undefined". */
export function requireCrypto(): void {
  if (!cryptoAvailable()) throw new Error(INSECURE_CONTEXT_MESSAGE);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large buffer never overflows the argument list of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Throws when the text is not valid base64. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Compares two byte arrays without stopping at the first difference, so the
 * time taken does not reveal how many leading bytes matched.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
