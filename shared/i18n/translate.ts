import type { AppLocale } from '../../types';
import { en } from './locales/en';
import { fa } from './locales/fa';
import type { TranslationKey, TranslationVars } from './types';

export const i18nDictionaries: Record<AppLocale, Record<TranslationKey, string>> = { en, fa };

const interpolate = (template: string, vars?: TranslationVars) => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, varName: string) => {
    const value = vars[varName];
    return value === undefined ? '' : String(value);
  });
};

export const translate = (locale: AppLocale, key: TranslationKey | string, vars?: TranslationVars) => {
  const source = i18nDictionaries[locale] as Record<string, string>;
  const fallback = i18nDictionaries.en as Record<string, string>;
  const template = source[key] ?? fallback[key] ?? key;
  return interpolate(template, vars);
};
