import React from 'react';
import { Languages, LogOut, Moon, Sun } from 'lucide-react';
import type { ThemeMode, User } from '../../../types';
import { getAvatarColor } from '../../../services/chatAdapter';

type ProfileMenuProps = {
  currentUser: User;
  theme: ThemeMode;
  language: 'en' | 'fa';
  onOpenProfileSettings: () => void;
  onToggleTheme: () => void;
  onToggleLanguage: () => void;
  onLogout: () => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function ProfileMenu({
  currentUser,
  theme,
  language,
  onOpenProfileSettings,
  onToggleTheme,
  onToggleLanguage,
  onLogout,
  t
}: ProfileMenuProps) {
  const avatarName = currentUser.name.slice(0, 2).toUpperCase();

  return (
    <header className="flex items-center justify-between gap-2 border-b border-tg-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenProfileSettings}
          className="focus-ring h-10 w-10 overflow-hidden rounded-full text-center text-sm font-semibold leading-10 text-white hover:opacity-90"
          aria-label={t('Open profile settings')}
          title={t('Open profile settings')}
        >
          {currentUser.avatar ? (
            <img src={currentUser.avatar} alt={`${currentUser.name} avatar`} className="h-full w-full object-cover" />
          ) : (
            <span
              className="block h-full w-full"
              style={{ background: currentUser.avatarColor || getAvatarColor(currentUser.id) }}
            >
              {avatarName}
            </span>
          )}
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-tg-text-primary text-start">
            {currentUser.name}
          </p>
          <p className="text-start truncate text-xs text-tg-text-secondary"><span dir="ltr">@{currentUser.username}</span></p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleTheme}
          className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
          aria-label={t('Toggle theme')}
          title={t('Toggle theme')}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          type="button"
          onClick={onToggleLanguage}
          className="focus-ring inline-flex items-center gap-1 rounded-full px-2 py-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
          aria-label={language === 'fa' ? t('Switch to English') : t('Switch to Persian')}
          title={language === 'fa' ? t('Switch to English') : t('Switch to Persian')}
        >
          <Languages size={16} />
          <span className="text-[10px] font-semibold leading-none">{language.toUpperCase()}</span>
        </button>
        <button
          type="button"
          onClick={() => void onLogout().catch(() => undefined)}
          className="focus-ring rounded-full p-2 text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
          aria-label={t('Logout')}
          title={t('Logout')}
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
