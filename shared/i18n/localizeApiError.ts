import type { AppLocale } from '../../types';
import { translate } from './translate';
import type { TranslationKey } from './types';

export const apiErrorMessageMap: Record<string, TranslationKey> = {
  Unauthorized: 'Unauthorized',
  'Invalid token': 'Invalid token',
  'Invalid credentials': 'Invalid credentials',
  'Missing CSRF token': 'Missing CSRF token',
  'Invalid CSRF token': 'Invalid CSRF token',
  'Rate limit exceeded': 'Rate limit exceeded',
  'Missing file': 'Missing file',
  'Upload failed': 'Upload failed',
  'Invalid input': 'Invalid input',
  'Payload too large': 'Payload too large',
  'Server error': 'Server error',
  'User not found': 'User not found',
  'Chat not found': 'Chat not found',
  'Group not found': 'Group not found',
  'Message not found': 'Message not found',
  'Contact not found': 'Contact not found',
  'Not found': 'Not found',
  'Database request failed': 'Database request failed',
  'Request failed': 'Request failed',
  'Authentication failed': 'Authentication failed',
  'Unsupported media type. Allowed: image, video, audio': 'Unsupported media type. Allowed: image, video, audio',
  'Invalid media file signature': 'Invalid media file signature',
  'Unsupported media signature': 'Unsupported media signature',
  'Media MIME type does not match file content': 'Media MIME type does not match file content',
  'Voice messages must be uploaded as audio': 'Voice messages must be uploaded as audio',
  'Voice recording is too short': 'Voice recording is too short',
  'Voice recording is too long': 'Voice recording is too long'
};

export const localizeApiMessage = (
  locale: AppLocale,
  message: string | null | undefined,
  fallbackKey: TranslationKey = 'Something went wrong. Please try again.'
) => {
  const normalized = typeof message === 'string' ? message.trim() : '';
  if (normalized) {
    // Dynamic matching for too large files (413 errors)
    const tooLargeMatch = normalized.match(/File is too large for (voice|photo|audio|video)\. Maximum size is (\d+)MB/i);
    if (tooLargeMatch) {
      const type = tooLargeMatch[1].toLowerCase();
      const size = tooLargeMatch[2];
      if (locale === 'fa') {
        const typeFa = type === 'voice' ? 'پیام صوتی' : type === 'photo' ? 'عکس' : type === 'audio' ? 'فایل صوتی' : 'ویدیو';
        return `اندازه فایل برای ${typeFa} بسیار بزرگ است. حداکثر اندازه مجاز ${size} مگابایت می‌باشد.`;
      } else {
        return `File is too large for ${type}. Maximum size is ${size}MB.`;
      }
    }

    const mappedKey = apiErrorMessageMap[normalized];
    if (mappedKey) {
      return translate(locale, mappedKey);
    }
  }

  if (locale === 'fa') {
    return translate(locale, 'An unexpected error occurred. Please try again.');
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return translate(locale, fallbackKey);
};

export const localizeApiError = (
  locale: AppLocale,
  error: unknown,
  fallbackKey: TranslationKey = 'Something went wrong. Please try again.'
) => {
  if (error instanceof Error) {
    const code = (error as any).code;
    if (code === 'REGISTRATION_PENDING') {
      return locale === 'fa' ? 'ثبت نام در انتظار تایید است.' : 'Registration is pending approval.';
    }
    if (code === 'REGISTRATION_REJECTED') {
      return locale === 'fa' ? 'ثبت نام رد شده است.' : 'Registration has been rejected.';
    }
    return localizeApiMessage(locale, error.message, fallbackKey);
  }
  if (typeof error === 'string') {
    return localizeApiMessage(locale, error, fallbackKey);
  }
  return localizeApiMessage(locale, '', fallbackKey);
};
