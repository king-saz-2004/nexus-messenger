import React, { createContext, useContext, useMemo } from 'react';
import type { AppLocale } from '../types';
import {
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleTime,
  localizeApiError as localizeApiErrorMessage,
  localizeApiMessage as localizeApiMessageText,
  normalizeLocale,
  translate,
  type TranslationKey,
  type TranslationVars,
  formatLastSeenRelative
} from '../services/i18n';

type I18nContextValue = {
  locale: AppLocale;
  t: (key: TranslationKey | string, vars?: TranslationVars) => string;
  formatDateTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  localizeApiError: (error: unknown, fallbackKey?: TranslationKey) => string;
  localizeApiMessage: (message: string | null | undefined, fallbackKey?: TranslationKey) => string;
  formatLastSeen: (value: string | number | Date | null | undefined) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

type I18nProviderProps = {
  locale: string | null | undefined;
  children: React.ReactNode;
};

export const I18nProvider = ({ locale, children }: I18nProviderProps) => {
  const normalizedLocale = normalizeLocale(locale);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale: normalizedLocale,
      t: (key, vars) => translate(normalizedLocale, key, vars),
      formatDateTime: (value, options) => formatLocaleDateTime(normalizedLocale, value, options),
      formatDate: (value, options) => formatLocaleDate(normalizedLocale, value, options),
      formatTime: (value, options) => formatLocaleTime(normalizedLocale, value, options),
      localizeApiError: (error, fallbackKey) => localizeApiErrorMessage(normalizedLocale, error, fallbackKey),
      localizeApiMessage: (message, fallbackKey) => localizeApiMessageText(normalizedLocale, message, fallbackKey),
      formatLastSeen: (value) => formatLastSeenRelative(normalizedLocale, value)
    }),
    [normalizedLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return value;
};
