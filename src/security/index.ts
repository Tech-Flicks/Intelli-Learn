/**
 * Public API of the security module. Other modules import from `@/security`.
 */
export {
  passwordProblems,
  setAdminPassword,
  verifyAdminPassword,
  changeAdminPassword,
  hasAdminPassword,
  getLockoutState,
  lockoutDurationMs,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PBKDF2_ITERATIONS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_BASE_MS,
  LOCKOUT_MAX_MS,
} from './password';
export type { VerifyResult } from './password';

export { encryptSecret, decryptSecret, setApiKey, getApiKey, hasApiKey } from './vault';

export { useParentGate, PARENT_IDLE_LOCK_MS, PARENT_HIDDEN_LOCK_MS } from './gate';
export type { ParentGateState } from './gate';
