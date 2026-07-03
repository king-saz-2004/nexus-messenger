import { useCallback, useEffect, useState } from 'react';
import type { AppLocale, ThemeMode } from '../../types';
import { normalizeLocale } from '../../services/i18n';

const THEME_STORAGE_KEY = 'telegram_clone.theme';
const LANGUAGE_STORAGE_KEY = 'telegram_clone.language';

export type FrontendLanguage = AppLocale;

export type UserSettingsDto = {
  userId: string;
  theme: 'light' | 'dark' | 'system';
  chatWallpaper?: string;
  fontSize: number;
  messageCorner: number;
  showStickersTab: boolean;
  autoDownloadPhoto: boolean;
  autoDownloadVideo: boolean;
  autoDownloadDoc: boolean;
  autoPlayGif: boolean;
  notificationEnabled: boolean;
  notificationSound: boolean;
  notificationPreview: boolean;
  notificationCountBadge: boolean;
  language: string;
  timeFormat: '12h' | '24h';
  updatedAt: string;
};

const readStoredLanguage = (): FrontendLanguage => {
  if (typeof window === 'undefined') return 'en';
  try {
    return normalizeLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return 'en';
  }
};

const readStoredTheme = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // ignore
  }
  return 'dark';
};

export const useThemeLanguage = () => {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [language, setLanguage] = useState<FrontendLanguage>(() => readStoredLanguage());

  const applyThemeSetting = useCallback((value: UserSettingsDto['theme']) => {
    if (value === 'light' || value === 'dark') {
      setTheme(value);
    }
  }, []);

  const applyLanguageSetting = useCallback((value: string | null | undefined) => {
    setLanguage(normalizeLocale(value));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('dir', language === 'fa' ? 'rtl' : 'ltr');
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  return {
    theme,
    setTheme,
    language,
    setLanguage,
    applyThemeSetting,
    applyLanguageSetting
  };
};
