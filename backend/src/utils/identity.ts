import { isUniqueViolation, getPgConstraint } from './errors.js';

export type DuplicateIdentityCode =
  | 'DUPLICATE_USERNAME'
  | 'DUPLICATE_EMAIL'
  | 'DUPLICATE_PHONE';

const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f]/g;

const sanitize = (value: string) => value.replace(CONTROL_CHARS_REGEX, '').trim();

export const normalizeUsername = (username: string) => sanitize(username).toLowerCase();

export const normalizeOptionalEmail = (email: string | null | undefined) => {
  if (email === undefined) return undefined;
  if (email === null) return null;
  const normalized = sanitize(email).toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeOptionalPhone = (phone: string | null | undefined) => {
  if (phone === undefined) return undefined;
  if (phone === null) return null;
  const normalized = sanitize(phone);
  return normalized.length > 0 ? normalized : null;
};

const findCodeInText = (text: string): DuplicateIdentityCode | null => {
  if (!text) return null;
  if (text.includes('users_username_ci_uniq')) return 'DUPLICATE_USERNAME';
  if (text.includes('users_email_ci_uniq')) return 'DUPLICATE_EMAIL';
  if (text.includes('users_phone_nonnull_uniq')) return 'DUPLICATE_PHONE';
  if (/\busername\b/.test(text)) return 'DUPLICATE_USERNAME';
  if (/\bemail\b/.test(text)) return 'DUPLICATE_EMAIL';
  if (/\bphone\b/.test(text)) return 'DUPLICATE_PHONE';
  return null;
};

export const resolveDuplicateIdentityCode = (error: unknown): DuplicateIdentityCode | null => {
  if (!isUniqueViolation(error)) {
    return null;
  }

  // Check the constraint name if available in the PostgreSQL error object
  const constraint = getPgConstraint(error);
  if (constraint) {
    const fromConstraint = findCodeInText(constraint.toLowerCase());
    if (fromConstraint) return fromConstraint;
  }

  // Also check the error message
  const message = (error as { message?: string }).message;
  if (typeof message === 'string') {
    const fromMessage = findCodeInText(message.toLowerCase());
    if (fromMessage) return fromMessage;
  }

  // Default fallback
  const detail = (error as { detail?: string }).detail;
  if (typeof detail === 'string') {
    const fromDetail = findCodeInText(detail.toLowerCase());
    if (fromDetail) return fromDetail;
  }

  return null;
};

export const duplicateIdentityMessage = (code: DuplicateIdentityCode) => {
  if (code === 'DUPLICATE_USERNAME') return 'Username already in use';
  if (code === 'DUPLICATE_EMAIL') return 'Email already in use';
  return 'Phone already in use';
};
