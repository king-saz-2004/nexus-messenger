import React, { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  UserRound
} from 'lucide-react';
import { useI18n } from '../hooks/useI18n';
import { apiClient, RegisterResponse } from '../services/apiClient';

type RegisterPayload = {
  username: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  password: string;
};

interface AuthScreenProps {
  isLoading: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (payload: RegisterPayload) => Promise<RegisterResponse | undefined>;
}

const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

export default function AuthScreen({ isLoading, onLogin, onRegister }: AuthScreenProps) {
  const { t, localizeApiError } = useI18n();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [errorText, setErrorText] = useState('');
  const [infoText, setInfoText] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [registrationRequiredFields, setRegistrationRequiredFields] = useState<{
    lastName: boolean;
    email: boolean;
    phone: boolean;
  }>({
    lastName: false,
    email: false,
    phone: false
  });

  useEffect(() => {
    apiClient.getRegistrationSettings()
      .then(settings => {
        if (settings && settings.registrationRequiredFields) {
          setRegistrationRequiredFields(settings.registrationRequiredFields);
        }
      })
      .catch(err => {
        console.error('Failed to load registration settings:', err);
      });
  }, []);

  const canSubmit = useMemo(() => {
    if (mode === 'login') {
      return loginUsername.trim().length > 0 && loginPassword.trim().length > 0;
    }

    const hasLastName = !registrationRequiredFields.lastName || lastName.trim().length > 0;
    const hasEmail = !registrationRequiredFields.email || email.trim().length > 0;
    const hasPhone = !registrationRequiredFields.phone || phone.trim().length > 0;

    return (
      username.trim().length > 0 &&
      firstName.trim().length > 0 &&
      hasLastName &&
      hasEmail &&
      hasPhone &&
      registerPassword.length >= 8 &&
      confirmPassword.length >= 8
    );
  }, [
    confirmPassword,
    firstName,
    loginPassword,
    loginUsername,
    mode,
    registerPassword,
    username,
    registrationRequiredFields,
    lastName,
    email,
    phone
  ]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorText('');
    setInfoText('');

    try {
      if (mode === 'login') {
        await onLogin(loginUsername.trim(), loginPassword.trim());
        return;
      }

      const trimmedUsername = username.trim();
      const trimmedFirstName = firstName.trim();
      const trimmedLastName = lastName.trim();
      const trimmedEmail = email.trim();
      const trimmedPhone = phone.trim();

      if (!USERNAME_REGEX.test(trimmedUsername)) {
        throw new Error(
          t('Username must be 4-32 chars, start with a letter, and use only letters, numbers, underscore')
        );
      }
      if (registerPassword.length < 8) {
        throw new Error(t('Password must be at least 8 characters'));
      }
      if (registerPassword !== confirmPassword) {
        throw new Error(t('Passwords do not match'));
      }
      if (trimmedFirstName.length < 1) {
        throw new Error(t('First name is required'));
      }
      if (registrationRequiredFields.lastName && trimmedLastName.length < 1) {
        throw new Error(t('Last name is required'));
      }
      if (registrationRequiredFields.email && trimmedEmail.length < 1) {
        throw new Error(t('Email is required'));
      }
      if (registrationRequiredFields.phone && trimmedPhone.length < 1) {
        throw new Error(t('Phone number is required'));
      }

      const res = await onRegister({
        username: trimmedUsername,
        firstName: trimmedFirstName,
        ...(trimmedLastName ? { lastName: trimmedLastName } : {}),
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        ...(trimmedPhone ? { phone: trimmedPhone } : {}),
        password: registerPassword
      });

      setRegisterPassword('');
      setConfirmPassword('');

      if (res && 'status' in res && res.status === 'pending_approval') {
        setMode('login');
        setLoginUsername(trimmedUsername);
        setLoginPassword('');
        setInfoText(res.message || t('Registration submitted and pending approval.'));
      } else {
        setMode('login');
        setLoginUsername(trimmedUsername);
        setLoginPassword('');
      }
    } catch (error) {
      setErrorText(localizeApiError(error, 'Authentication failed'));
    }
  };

  return (
    <div className="auth-backdrop relative flex min-h-[100dvh] w-full items-start justify-center overflow-x-hidden overflow-y-auto px-4 py-6 sm:items-center sm:py-8">
      <div className="auth-orb auth-orb-left" aria-hidden="true" />
      <div className="auth-orb auth-orb-right" aria-hidden="true" />

      <section className="relative my-auto w-full max-w-5xl overflow-hidden rounded-[2rem] border border-tg-border bg-tg-bg-surface/80 shadow-[0_35px_90px_-45px_rgba(0,0,0,0.75)] backdrop-blur-xl">
        <div className="grid md:grid-cols-[1.1fr,0.9fr]">
          <aside className="auth-hero hidden p-8 md:flex md:flex-col md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/90">
                <MessageCircle size={14} />
                {t('Nexus Messenger')}
              </div>
              <h1 className="mt-6 text-4xl font-bold leading-tight text-white">
                {t('Welcome back to your')}
                <span className="block text-[#8fc7ff]">{t('private conversations')}</span>
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-white/75">
                {t('Fast, secure, and clean messaging with the same visual language as the rest of your app.')}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-white/80">
                <ShieldCheck size={15} />
                {t('Encrypted and authenticated sessions')}
              </div>
              <div className="flex items-center gap-2 text-sm text-white/80">
                <MessageCircle size={15} />
                {t('Real-time messaging and groups')}
              </div>
            </div>
          </aside>

          <div className="flex flex-col justify-center p-6 sm:p-10">
            <div className="mb-4 hidden md:block">
              <h2 className="text-2xl font-bold text-tg-text-primary">
                {mode === 'login' ? t('Sign in') : t('Create account')}
              </h2>
              <p className="mt-1 text-sm text-tg-text-secondary">
                {mode === 'login' ? t('Access your chats and groups instantly') : t('Register and start secure messaging')}
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-tg-border bg-tg-bg-input-field p-1">
              <button
                type="button"
                className={`focus-ring rounded-lg px-3 py-2 text-sm transition ${
                  mode === 'login' ? 'bg-tg-accent text-white' : 'text-tg-text-secondary hover:bg-tg-hover'
                }`}
                onClick={() => {
                  setMode('login');
                  setErrorText('');
                  setInfoText('');
                }}
              >
                {t('Sign in')}
              </button>
              <button
                type="button"
                className={`focus-ring rounded-lg px-3 py-2 text-sm transition ${
                  mode === 'register' ? 'bg-tg-accent text-white' : 'text-tg-text-secondary hover:bg-tg-hover'
                }`}
                onClick={() => {
                  setMode('register');
                  setErrorText('');
                  setInfoText('');
                }}
              >
                {t('Register')}
              </button>
            </div>

            <form onSubmit={submit} className="flex flex-col">
              {mode === 'login' ? (
                <>
                  <label className="mb-4 block text-sm">
                    <span className="mb-1.5 block text-tg-text-secondary">{t('Username')}</span>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute inset-y-0 left-3 my-auto text-tg-text-tertiary" size={16} />
                      <input
                        value={loginUsername}
                        onChange={event => setLoginUsername(event.target.value)}
                        placeholder={t('Enter username')}
                        type="text"
                        autoComplete="username"
                        required
                        className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-10 pr-4 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                      />
                    </div>
                  </label>

                  <label className="mb-5 block text-sm">
                    <span className="mb-1.5 block text-tg-text-secondary">{t('Password')}</span>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute inset-y-0 left-3 my-auto text-tg-text-tertiary" size={16} />
                      <input
                        value={loginPassword}
                        onChange={event => setLoginPassword(event.target.value)}
                        placeholder={t('Enter your password')}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-10 pr-12 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(prev => !prev)}
                        className="focus-ring absolute inset-y-0 right-2 my-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-tg-text-tertiary hover:bg-tg-hover hover:text-tg-text-primary"
                        aria-label={showPassword ? t('Hide password') : t('Show password')}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>
                </>
              ) : (
                <div className="max-h-[360px] overflow-y-auto pr-1 space-y-4 mb-4">
                  <label className="block text-sm">
                    <span className="mb-1.5 block text-tg-text-secondary">{t('Username')}</span>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute inset-y-0 left-3 my-auto text-tg-text-tertiary" size={16} />
                      <input
                        value={username}
                        onChange={event => setUsername(event.target.value)}
                        placeholder={t('Choose a username')}
                        type="text"
                        autoComplete="username"
                        required
                        className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-10 pr-4 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                      />
                    </div>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1.5 block text-tg-text-secondary">{t('First name')}</span>
                      <input
                        value={firstName}
                        onChange={event => setFirstName(event.target.value)}
                        placeholder={t('First name')}
                        type="text"
                        required
                        className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-4 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                      />
                    </label>

                    <label className="block text-sm">
                      <span className="mb-1.5 block text-tg-text-secondary">
                        {registrationRequiredFields.lastName ? t('Last name (required)') : t('Last name (optional)')}
                      </span>
                      <input
                        value={lastName}
                        onChange={event => setLastName(event.target.value)}
                        placeholder={registrationRequiredFields.lastName ? t('Last name (required)') : t('Last name (optional)')}
                        type="text"
                        required={registrationRequiredFields.lastName}
                        className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-4 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1.5 block text-tg-text-secondary">
                        {registrationRequiredFields.email ? t('Email (required)') : t('Email (optional)')}
                      </span>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute inset-y-0 left-3 my-auto text-tg-text-tertiary" size={16} />
                        <input
                          value={email}
                          onChange={event => setEmail(event.target.value)}
                          placeholder="email@example.com"
                          type="email"
                          autoComplete="email"
                          required={registrationRequiredFields.email}
                          className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-10 pr-4 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                        />
                      </div>
                    </label>

                    <label className="block text-sm">
                      <span className="mb-1.5 block text-tg-text-secondary">
                        {registrationRequiredFields.phone ? t('Phone (required)') : t('Phone (optional)')}
                      </span>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute inset-y-0 left-3 my-auto text-tg-text-tertiary" size={16} />
                        <input
                          value={phone}
                          onChange={event => setPhone(event.target.value)}
                          placeholder="+1234567890"
                          type="tel"
                          autoComplete="tel"
                          required={registrationRequiredFields.phone}
                          className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-10 pr-4 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                        />
                      </div>
                    </label>
                  </div>

                  <label className="block text-sm">
                    <span className="mb-1.5 block text-tg-text-secondary">{t('Password')}</span>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute inset-y-0 left-3 my-auto text-tg-text-tertiary" size={16} />
                      <input
                        value={registerPassword}
                        onChange={event => setRegisterPassword(event.target.value)}
                        placeholder={t('At least 8 characters')}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-10 pr-12 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(prev => !prev)}
                        className="focus-ring absolute inset-y-0 right-2 my-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-tg-text-tertiary hover:bg-tg-hover hover:text-tg-text-primary"
                        aria-label={showPassword ? t('Hide password') : t('Show password')}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>

                  <label className="block text-sm">
                    <span className="mb-1.5 block text-tg-text-secondary">{t('Confirm password')}</span>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute inset-y-0 left-3 my-auto text-tg-text-tertiary" size={16} />
                      <input
                        value={confirmPassword}
                        onChange={event => setConfirmPassword(event.target.value)}
                        placeholder={t('Repeat password')}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        className="focus-ring h-11 w-full rounded-xl border border-tg-border bg-tg-bg-input-field pl-10 pr-12 text-sm text-tg-text-primary placeholder:text-tg-text-tertiary transition hover:bg-tg-hover"
                      />
                    </div>
                  </label>
                </div>
              )}

              {infoText ? (
                <p dir="auto" className="mb-4 rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-3 py-2 text-xs text-emerald-200 text-start bidi-text">
                  {infoText}
                </p>
              ) : null}

              {errorText ? (
                <p dir="auto" className="mb-4 rounded-xl border border-rose-500/35 bg-rose-500/12 px-3 py-2 text-xs text-rose-200 text-start bidi-text">
                  {errorText}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isLoading || !canSubmit}
                className="focus-ring mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-tg-accent px-4 text-sm font-semibold text-white transition hover:bg-tg-accent-hover active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                {isLoading
                  ? mode === 'login'
                    ? t('Signing in...')
                    : t('Creating account...')
                  : mode === 'login'
                    ? t('Sign in')
                    : t('Create account')}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
