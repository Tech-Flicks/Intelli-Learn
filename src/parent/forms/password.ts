/** Password checks in the interface language. `@/security` stays the authority on what is acceptable. */
import type { Translate } from '@/i18n';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblems } from '@/security';

/** A problem with a new password, or null when it is acceptable. */
export function passwordProblemText(password: string, t: Translate): string | null {
  const problem = passwordProblems(password);
  if (problem === null) return null;
  const length = Array.from(password).length;
  if (length === 0) return t('parent.password.error.empty');
  if (length < PASSWORD_MIN_LENGTH) return t('parent.password.error.short', { min: PASSWORD_MIN_LENGTH });
  if (length > PASSWORD_MAX_LENGTH) return t('parent.password.error.long', { max: PASSWORD_MAX_LENGTH });
  if (password.trim().length === 0) return t('parent.password.error.spaces');
  return problem;
}

export interface NewPasswordErrors {
  password?: string;
  confirm?: string;
}

/** Checks a new password and its repetition. Empty object = fine. */
export function validateNewPassword(password: string, confirm: string, t: Translate): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  const problem = passwordProblemText(password, t);
  if (problem !== null) errors.password = problem;
  if (confirm === '') errors.confirm = t('parent.password.error.confirmEmpty');
  else if (confirm !== password) errors.confirm = t('parent.password.error.mismatch');
  return errors;
}
