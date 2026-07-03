import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { sql, joinSql, emptySql, type SqlFragment, type JsonValue, type JsonObject } from '../config/sql.js';
import { runAsUser, runForAuthLookup, runForRootAdmin } from '../config/dbContext.js';
import { env } from '../config/env.js';
import { getAvatarColorIndex } from './authUser.js';
import { assertBcryptHash } from '../utils/passwordHash.js';
import { isUniqueViolation } from '../utils/errors.js';

const BCRYPT_COST = 12;

type SeedUser = {
  username: string;
  firstName: string;
  lastName?: string;
  email?: string;
  password: string;
  isRoot?: boolean;
};

type ExistingUserRow = {
  id: string;
};

type RootCandidateRow = {
  id: string;
  username: string;
  is_root: boolean;
};

const hashSeedPassword = async (seedUser: SeedUser) => {
  const normalizedUsername = seedUser.username.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(seedUser.password, BCRYPT_COST);
  assertBcryptHash(passwordHash, `adminSeed.upsertUser.${normalizedUsername}`);
  return passwordHash;
};

const upsertUser = async (seedUser: SeedUser) => {
  const normalizedUsername = seedUser.username.trim().toLowerCase();
  const normalizedEmail = seedUser.email?.trim().toLowerCase() ?? null;

  const existingRows = await runForAuthLookup(tx =>
    tx.$queryRaw<ExistingUserRow[]>`
      SELECT id
      FROM users
      WHERE username = ${normalizedUsername}
      LIMIT 1
    `
  );

  const existing = existingRows[0];
  if (existing) {
    const updateClauses: SqlFragment[] = [
      sql`is_root = ${seedUser.isRoot ?? false}`,
      sql`is_active = true`,
      sql`is_deleted = false`,
      sql`deleted_at = NULL`
    ];

    if (seedUser.isRoot) {
      updateClauses.push(sql`registration_status = 'active'`);
    }

    if (env.resetRootPasswordOnBoot) {
      const passwordHash = await hashSeedPassword(seedUser);
      updateClauses.push(sql`password_hash = ${passwordHash}`);
    }

    await runAsUser(existing.id, tx =>
      tx.$executeRaw(
        sql`
          UPDATE users
          SET ${joinSql(updateClauses, ', ')}
          WHERE id = ${existing.id}::uuid
        `
      )
    );
    return 'updated';
  }

  const id = randomUUID();
  const avatarColor = getAvatarColorIndex(id);
  const passwordHash = await hashSeedPassword(seedUser);

  await runAsUser(id, tx =>
    tx.$executeRaw`
      INSERT INTO users (
        id,
        username,
        email,
        password_hash,
        first_name,
        last_name,
        avatar_color,
        status,
        is_root,
        is_active,
        is_deleted,
        registration_status
      )
      VALUES (
        ${id}::uuid,
        ${normalizedUsername},
        ${normalizedEmail},
        ${passwordHash},
        ${seedUser.firstName},
        ${seedUser.lastName ?? null},
        ${avatarColor},
        'offline',
        ${seedUser.isRoot ?? false},
        true,
        false,
        'active'
      )
    `
  );

  return 'created';
};



const enforceSingleRoot = async (normalizedRootUsername: string) => {
  const candidates = await runForAuthLookup(tx =>
    tx.$queryRaw<RootCandidateRow[]>`
      SELECT id, username, is_root
      FROM users
      WHERE is_root = true
         OR LOWER(username) = ${normalizedRootUsername}
    `
  );

  const rootRow = candidates.find(row => row.username.trim().toLowerCase() === normalizedRootUsername);
  if (!rootRow) {
    throw new Error(`Root user "${normalizedRootUsername}" not found during root enforcement`);
  }

  for (const row of candidates) {
    const targetIsRoot = row.id === rootRow.id;
    if (row.is_root === targetIsRoot) {
      continue;
    }

    await runAsUser(row.id, tx =>
      tx.$executeRaw`
        UPDATE users
        SET is_root = ${targetIsRoot}
        WHERE id = ${row.id}::uuid
      `
    );
  }
};

export const ensureRootAdmin = async () => {
  const normalizedRootUsername = env.defaultRootUsername.trim().toLowerCase();
  const normalizedRootEmail = env.defaultRootEmail?.trim().toLowerCase() ?? undefined;
  const rootSeed: SeedUser = {
    username: normalizedRootUsername,
    firstName: 'Root',
    lastName: 'Operator',
    ...(normalizedRootEmail ? { email: normalizedRootEmail } : {}),
    password: env.defaultRootPassword,
    isRoot: true
  };

  try {
    await upsertUser(rootSeed);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  await enforceSingleRoot(normalizedRootUsername);

  const rootUsers = await runForAuthLookup(tx =>
    tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE username = ${normalizedRootUsername} LIMIT 1
    `
  );
  const rootId = rootUsers[0]?.id;

  if (rootId) {
    await runForRootAdmin(rootId, tx =>
      tx.$executeRaw`
        INSERT INTO app_settings (key, value, updated_by)
        VALUES ('registration_mode', ${JSON.stringify(env.registrationMode)}::jsonb, NULL)
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value
        WHERE app_settings.updated_by IS NULL
      `
    );

    await runForRootAdmin(rootId, tx =>
      tx.$executeRaw`
        INSERT INTO app_settings (key, value, updated_by)
        VALUES ('registration_required_fields', '{"lastName":false,"email":false,"phone":false}'::jsonb, NULL)
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value
        WHERE app_settings.updated_by IS NULL
      `
    );

    await runForRootAdmin(rootId, tx =>
      tx.$executeRaw`
        INSERT INTO app_settings (key, value, updated_by)
        VALUES ('media_limits', '{"voice":0.03,"audio":0.03,"photo":0.03,"video":0.03}'::jsonb, NULL)
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value
        WHERE app_settings.updated_by IS NULL
      `
    );
  }
};
