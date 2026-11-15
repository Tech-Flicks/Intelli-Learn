/** The rules for the name a child gives the companion. */
import { localSafetyCheck } from '@/ai';

export const COMPANION_NAME_MAX_LENGTH = 16;

export type CompanionNameProblem = 'chars' | 'long' | 'unsafe';

export type CompanionNameResult = { ok: true; name: string } | { ok: false; problem: CompanionNameProblem };

/** Letters (of any script, with their marks), digits and spaces. */
const ALLOWED = /^[\p{L}\p{M}\p{N} ]*$/u;

/** Visible length closely enough for a limit: code points, not UTF-16 units. */
export function nameLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Tidies and checks a companion name. An empty name is fine: the companion then goes by its
 * species name again. The name stays on the device; it is still checked with the same
 * blocklist as everything else a child can read on the screen.
 */
export function checkCompanionName(raw: string, strictness: 'strict' | 'standard' = 'strict'): CompanionNameResult {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '') return { ok: true, name: '' };
  if (!ALLOWED.test(name)) return { ok: false, problem: 'chars' };
  if (nameLength(name) > COMPANION_NAME_MAX_LENGTH) return { ok: false, problem: 'long' };
  if (!localSafetyCheck(name, strictness).safe) return { ok: false, problem: 'unsafe' };
  return { ok: true, name };
}
