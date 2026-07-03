import type { en } from './locales/en';

export type TranslationVars = Record<string, string | number>;

export type TranslationKey = keyof typeof en;
