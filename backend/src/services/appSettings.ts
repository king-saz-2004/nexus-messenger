import { runForAuthLookup } from '../config/dbContext.js';
import type { DbExecutor } from '../config/dbContext.js';
import { env } from '../config/env.js';

export type RegistrationMode = 'public' | 'private';

export type RegistrationRequiredFields = {
  lastName: boolean;
  email: boolean;
  phone: boolean;
};

export type PublicRegistrationSettings = {
  registrationMode: RegistrationMode;
  registrationRequiredFields: RegistrationRequiredFields;
};

export function normalizeRegistrationRequiredFields(value: unknown): RegistrationRequiredFields {
  const defaultFields = { lastName: false, email: false, phone: false };
  if (typeof value !== 'object' || value === null) {
    return defaultFields;
  }
  const obj = value as Record<string, unknown>;
  return {
    lastName: typeof obj.lastName === 'boolean' ? obj.lastName : false,
    email: typeof obj.email === 'boolean' ? obj.email : false,
    phone: typeof obj.phone === 'boolean' ? obj.phone : false
  };
}

export async function getRegistrationModeWithClient(tx: DbExecutor): Promise<RegistrationMode> {
  const rows = await tx.$queryRaw<{ value: unknown }[]>`
    SELECT value FROM app_settings WHERE key = 'registration_mode' LIMIT 1
  `;
  if (rows.length === 0) {
    return (env.registrationMode as RegistrationMode) || 'public';
  }
  const val = rows[0].value;
  if (val === 'public' || val === 'private') return val;
  return 'public';
}

export async function getRegistrationRequiredFieldsWithClient(tx: DbExecutor): Promise<RegistrationRequiredFields> {
  const rows = await tx.$queryRaw<{ value: unknown }[]>`
    SELECT value FROM app_settings WHERE key = 'registration_required_fields' LIMIT 1
  `;
  if (rows.length === 0) {
    return { lastName: false, email: false, phone: false };
  }
  return normalizeRegistrationRequiredFields(rows[0].value);
}

export async function getPublicRegistrationSettings(): Promise<PublicRegistrationSettings> {
  return runForAuthLookup(async tx => {
    const registrationMode = await getRegistrationModeWithClient(tx);
    const registrationRequiredFields = await getRegistrationRequiredFieldsWithClient(tx);
    return { registrationMode, registrationRequiredFields };
  });
}

export async function setRegistrationModeWithClient(tx: DbExecutor, mode: RegistrationMode, actorId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES ('registration_mode', ${JSON.stringify(mode)}::jsonb, ${actorId}::uuid)
    ON CONFLICT (key) DO UPDATE
    SET value = ${JSON.stringify(mode)}::jsonb, updated_at = NOW(), updated_by = ${actorId}::uuid
  `;
}

export async function setRegistrationRequiredFieldsWithClient(tx: DbExecutor, fields: RegistrationRequiredFields, actorId: string): Promise<void> {
  const normalized = normalizeRegistrationRequiredFields(fields);
  await tx.$executeRaw`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES ('registration_required_fields', ${JSON.stringify(normalized)}::jsonb, ${actorId}::uuid)
    ON CONFLICT (key) DO UPDATE
    SET value = ${JSON.stringify(normalized)}::jsonb, updated_at = NOW(), updated_by = ${actorId}::uuid
  `;
}

export type MediaLimits = {
  voice: number;
  audio: number;
  photo: number;
  video: number;
};

export function normalizeMediaLimits(value: unknown): MediaLimits {
  const defaultLimits = { voice: 0.03, audio: 0.03, photo: 0.03, video: 0.03 };
  if (typeof value !== 'object' || value === null) {
    return defaultLimits;
  }
  const obj = value as Record<string, unknown>;

  const check = (val: unknown): number => {
    return (typeof val === 'number' && Number.isFinite(val) && val > 0) ? val : 0.03;
  };

  return {
    voice: check(obj.voice),
    audio: check(obj.audio),
    photo: check(obj.photo),
    video: check(obj.video)
  };
}

export async function getMediaLimitsWithClient(tx: DbExecutor): Promise<MediaLimits> {
  const rows = await tx.$queryRaw<{ value: unknown }[]>`
    SELECT value FROM app_settings WHERE key = 'media_limits' LIMIT 1
  `;
  if (rows.length === 0) {
    return { voice: 0.03, audio: 0.03, photo: 0.03, video: 0.03 };
  }
  return normalizeMediaLimits(rows[0].value);
}

export async function getMediaLimits(): Promise<MediaLimits> {
  return runForAuthLookup(async tx => {
    return getMediaLimitsWithClient(tx);
  });
}

export async function setMediaLimitsWithClient(tx: DbExecutor, limits: MediaLimits, actorId: string): Promise<void> {
  const normalized = normalizeMediaLimits(limits);
  await tx.$executeRaw`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES ('media_limits', ${JSON.stringify(normalized)}::jsonb, ${actorId}::uuid)
    ON CONFLICT (key) DO UPDATE
    SET value = ${JSON.stringify(normalized)}::jsonb, updated_at = NOW(), updated_by = ${actorId}::uuid
  `;
}

