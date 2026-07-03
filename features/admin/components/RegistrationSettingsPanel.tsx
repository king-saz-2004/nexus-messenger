import React from 'react';

type RegistrationRequiredFields = {
  lastName: boolean;
  email: boolean;
  phone: boolean;
};

type RegistrationSettingsPanelProps = {
  registrationMode: 'public' | 'private';
  registrationRequiredFields: RegistrationRequiredFields;
  isRegistrationModeSaving: boolean;
  isRegistrationFieldsSaving: boolean;
  onSetRegistrationMode: (mode: 'public' | 'private') => Promise<void>;
  onUpdateRegistrationRequiredFields: (field: 'lastName' | 'email' | 'phone', value: boolean) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function RegistrationSettingsPanel({
  registrationMode,
  registrationRequiredFields,
  isRegistrationModeSaving,
  isRegistrationFieldsSaving,
  onSetRegistrationMode,
  onUpdateRegistrationRequiredFields,
  t
}: RegistrationSettingsPanelProps) {
  return (
    <>
      <div className="rounded-xl bg-tg-bg-input-field/40 p-2.5 border border-tg-border/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-tg-text-primary">
            {t('Registration Mode')}
          </span>
          {isRegistrationModeSaving ? (
            <span className="text-[9px] text-tg-text-secondary animate-pulse">{t('Saving...')}</span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-tg-bg-input-field p-0.5">
          <button
            type="button"
            disabled={isRegistrationModeSaving}
            onClick={() => void onSetRegistrationMode('public')}
            className={`focus-ring rounded px-2 py-1 text-[10px] font-medium transition ${
              registrationMode === 'public'
                ? 'bg-tg-accent text-white shadow-sm'
                : 'text-tg-text-secondary hover:bg-tg-hover'
            }`}
          >
            {t('Public')}
          </button>
          <button
            type="button"
            disabled={isRegistrationModeSaving}
            onClick={() => void onSetRegistrationMode('private')}
            className={`focus-ring rounded px-2 py-1 text-[10px] font-medium transition ${
              registrationMode === 'private'
                ? 'bg-tg-accent text-white shadow-sm'
                : 'text-tg-text-secondary hover:bg-tg-hover'
            }`}
          >
            {t('Private')}
          </button>
        </div>

        <p className="mt-1 text-[9px] leading-relaxed text-tg-text-tertiary">
          {registrationMode === 'public'
            ? t('Public: Anyone can sign up and immediately start messaging.')
            : t('Private: New users are registered as pending until approved by the Root operator.')}
        </p>
      </div>

      <div className="rounded-xl bg-tg-bg-input-field/40 p-2.5 border border-tg-border/50 space-y-1.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-tg-text-primary">
            {t('Required registration fields')}
          </span>
          {isRegistrationFieldsSaving ? (
            <span className="text-[9px] text-tg-text-secondary animate-pulse">{t('Saving...')}</span>
          ) : null}
        </div>
        <div className="space-y-1.5">
          {[
            { key: 'lastName' as const, label: t('Last name (required)') },
            { key: 'email' as const, label: t('Email (required)') },
            { key: 'phone' as const, label: t('Phone (required)') }
          ].map(field => (
            <label key={field.key} className="flex items-center justify-between text-[10px] text-tg-text-secondary cursor-pointer py-0.5 hover:text-tg-text-primary">
              <span>{field.label}</span>
              <input
                type="checkbox"
                disabled={isRegistrationFieldsSaving}
                checked={registrationRequiredFields[field.key]}
                onChange={e => void onUpdateRegistrationRequiredFields(field.key, e.target.checked)}
                className="rounded border-tg-border text-tg-accent focus:ring-tg-accent h-3.5 w-3.5 bg-tg-bg-input-field"
              />
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
