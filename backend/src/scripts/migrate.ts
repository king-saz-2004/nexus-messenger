import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_LOCK_ID = 19283746;

const computeChecksum = (content: string): string => {
  return crypto.createHash('sha256').update(content).digest('hex');
};

const hasTransactionKeywords = (content: string): boolean => {
  // 1. Strip single-line comments (-- ...)
  let clean = content.replace(/--.*$/gm, '');

  // 2. Strip multi-line comments (/* ... */)
  clean = clean.replace(/\/\*[\s\S]*?\*\//g, '');

  // 3. Strip dollar-quoted blocks ($$ ... $$ or $tag$ ... $tag$)
  clean = clean.replace(/\$\$(?:[\s\S]*?)\$\$/g, '');
  clean = clean.replace(/\$([a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, '');

  // 4. Strip single-quoted string literals ('...') (being careful of escaped quotes)
  clean = clean.replace(/'(?:[^'\\]|\\.)*'/g, '');

  // 5. Check for top-level transaction control keywords
  const txWords = /\b(begin|commit|rollback|abort|start\s+transaction|end\s+transaction)\b/i;
  return txWords.test(clean);
};

const getDatabaseUrl = (): string => {
  const isProd = process.env.NODE_ENV === 'production';
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (isProd && !migrationUrl) {
    console.error('ERROR: MIGRATION_DATABASE_URL is required in production because app DATABASE_URL should use the restricted app user.');
    process.exit(1);
  }
  const url = migrationUrl || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: MIGRATION_DATABASE_URL or DATABASE_URL environment variable is required.');
    process.exit(1);
  }
  return url;
};

async function main() {
  const databaseUrl = getDatabaseUrl();
  const migrationsDir = path.resolve(__dirname, '../../sql/migrations');

  console.log(`[migration] Connecting to database...`);
  const client = new pg.Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error('ERROR: Failed to connect to the database:', err);
    process.exit(1);
  }

  console.log(`[migration] Acquiring advisory lock...`);
  try {
    const lockRes = await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    if (!lockRes) {
      throw new Error('Lock query returned no results');
    }
  } catch (err) {
    console.error('ERROR: Failed to acquire advisory lock:', err);
    await client.end();
    process.exit(1);
  }

  try {
    const tableCheck = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
          AND tablename  = 'schema_migrations'
      );
    `);
    const schemaMigrationsExists = tableCheck.rows[0]?.exists;

    const usersCheck = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
          AND tablename  = 'users'
      );
    `);
    const usersExists = usersCheck.rows[0]?.exists;

    console.log(`[migration] Ensuring schema_migrations table exists...`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    if (!schemaMigrationsExists && usersExists) {
      console.log('[migration] Fresh install detected. Seeding migrations table...');
      if (fs.existsSync(migrationsDir)) {
        const files = fs.readdirSync(migrationsDir)
          .filter(f => f.endsWith('.sql'))
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

        for (const filename of files) {
          const filePath = path.join(migrationsDir, filename);
          const content = fs.readFileSync(filePath, 'utf8');
          const checksum = computeChecksum(content);
          const match = filename.match(/^(\d+)/);
          const version = match ? match[1] : filename;

          await client.query(
            'INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [version, filename, checksum]
          );
          console.log(`[migration] Seeded migration version ${version} (${filename}) as applied.`);
        }
      }
    }

    // Get applied migrations
    const { rows: appliedRows } = await client.query<{ version: string; checksum: string; filename: string }>(
      'SELECT version, filename, checksum FROM schema_migrations'
    );
    const appliedMap = new Map(appliedRows.map(r => [r.version, r]));

    console.log(`[migration] Migrations directory: ${migrationsDir}`);
    // Read migration files
    if (!fs.existsSync(migrationsDir)) {
      if (process.env.NODE_ENV === 'production') {
        console.error(`ERROR: Migrations directory not found at: ${migrationsDir}`);
        process.exit(1);
      }
      console.log(`[migration] No migrations directory found at: ${migrationsDir}. Skipping migrations.`);
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    if (files.length === 0) {
      console.log('[migration] No migration files found.');
      return;
    }

    for (const filename of files) {
      const filePath = path.join(migrationsDir, filename);
      const content = fs.readFileSync(filePath, 'utf8');
      const checksum = computeChecksum(content);

      if (hasTransactionKeywords(content)) {
        throw new Error(
          `Migration file ${filename} contains top-level transaction control keywords ` +
          `(BEGIN, COMMIT, ROLLBACK, etc.) which are not allowed because migrations are automatically ` +
          `wrapped in transactions.`
        );
      }

      // Parse version from filename (digits at start, e.g. 002)
      const match = filename.match(/^(\d+)/);
      const version = match ? match[1] : filename;

      const applied = appliedMap.get(version);
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(
            `Checksum mismatch for migration version ${version} (${filename}). ` +
            `Applied checksum: ${applied.checksum}, File checksum: ${checksum}. ` +
            `Database may be in an inconsistent state.`
          );
        }
        console.log(`[migration] Skipped: ${filename} (already applied)`);
        continue;
      }

      console.log(`[migration] Applying: ${filename}...`);
      await client.query('BEGIN');
      try {
        // Run migration statements
        await client.query(content);
        // Record migration
        await client.query(
          'INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
          [version, filename, checksum]
        );
        await client.query('COMMIT');
        console.log(`[migration] Successfully applied: ${filename}`);
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        console.error(`ERROR: Failed to apply migration ${filename}. Rolled back.`);
        throw migrationErr;
      }
    }

    console.log('[migration] All migrations applied successfully.');
  } catch (err) {
    console.error('ERROR: Migration run failed:', err);
    process.exitCode = 1;
  } finally {
    console.log(`[migration] Releasing advisory lock...`);
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } catch (lockErr) {
      console.error('ERROR: Failed to release advisory lock:', lockErr);
    }
    await client.end();
  }
}

main();
