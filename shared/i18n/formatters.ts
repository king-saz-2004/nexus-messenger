import type { AppLocale } from '../../types';
import { translate } from './translate';

export const localeTagByLocale: Record<AppLocale, string> = {
  en: 'en-US',
  fa: 'fa-IR'
};

export const normalizeLocale = (value: string | null | undefined): AppLocale =>
  value?.trim().toLowerCase() === 'fa' ? 'fa' : 'en';

const toDate = (value: string | number | Date) => (value instanceof Date ? value : new Date(value));

export const formatLocaleDateTime = (
  locale: AppLocale,
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions
) => new Intl.DateTimeFormat(localeTagByLocale[locale], options).format(toDate(value));

export const formatLocaleDate = (
  locale: AppLocale,
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions
) => new Intl.DateTimeFormat(localeTagByLocale[locale], options).format(toDate(value));

export const formatLocaleTime = (
  locale: AppLocale,
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions
) => new Intl.DateTimeFormat(localeTagByLocale[locale], options).format(toDate(value));

export const formatLastSeenRelative = (locale: AppLocale, value: string | number | Date | null | undefined): string => {
  if (!value) return translate(locale, 'offline');
  
  const date = toDate(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) {
    return translate(locale, 'last seen just now');
  }
  if (diffMin < 60) {
    return translate(locale, diffMin === 1 ? 'last seen {n} minute ago' : 'last seen {n} minutes ago', { n: diffMin });
  }
  if (diffHour < 24) {
    return translate(locale, diffHour === 1 ? 'last seen {n} hour ago' : 'last seen {n} hours ago', { n: diffHour });
  }

  const timeStr = new Intl.DateTimeFormat(localeTagByLocale[locale], { hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return translate(locale, 'last seen today at {time}', { time: timeStr });
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return translate(locale, 'last seen yesterday at {time}', { time: timeStr });
  }

  const dateStr = new Intl.DateTimeFormat(localeTagByLocale[locale], { month: 'short', day: 'numeric' }).format(date);
  return translate(locale, 'last seen on {date} at {time}', { date: dateStr, time: timeStr });
};
