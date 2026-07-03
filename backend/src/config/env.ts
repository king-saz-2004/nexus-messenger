import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const parsedPort = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const required = (key: string, fallback?: string) => {
  const value = (process.env[key] ?? fallback)?.trim();
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
};

const validateSecret = (key: string, value: string) => {
  if (value.length < 16) {
    throw new Error(`${key} must be at least 16 characters long for security`);
  }
  return value;
};

const parseBoolean = (key: string, fallback: boolean) => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new Error(`${key} must be "true" or "false"`);
};

const parsePositiveInt = (key: string, fallback: number, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return parsed;
};

const parseEnum = <T extends readonly string[]>(key: string, fallback: T[number], allowed: T): T[number] => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;

  const normalized = raw.trim().toLowerCase();
  const match = allowed.find(value => value === normalized);
  if (!match) {
    throw new Error(`${key} must be one of: ${allowed.join(', ')}`);
  }
  return match;
};

export const normalizeOrigin = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const clientOriginRaw = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const clientOrigins = Array.from(
  new Set(
    clientOriginRaw
      .split(',')
      .map(origin => normalizeOrigin(origin))
      .filter(Boolean)
  )
);

if (clientOrigins.length === 0) {
  throw new Error('CLIENT_ORIGIN must contain at least one origin');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parsedPort,
  clientOrigin: clientOriginRaw,
  clientOrigins,
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: validateSecret('JWT_SECRET', required('JWT_SECRET')),
  jwtRefreshSecret: validateSecret('JWT_REFRESH_SECRET', required('JWT_REFRESH_SECRET')),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '7d',
  cookieSecure: parseBoolean('COOKIE_SECURE', false),
  cookieSameSite: parseEnum('COOKIE_SAME_SITE', 'lax', ['lax', 'strict', 'none'] as const),
  csrfCookieName: process.env.CSRF_COOKIE_NAME?.trim() || 'csrfToken',
  defaultRootUsername: required('DEFAULT_ROOT_USERNAME'),
  defaultRootPassword: required('DEFAULT_ROOT_PASSWORD'),
  resetRootPasswordOnBoot: parseBoolean('RESET_ROOT_PASSWORD_ON_BOOT', false),
  defaultRootEmail: process.env.DEFAULT_ROOT_EMAIL?.trim().toLowerCase() || null,
  registrationMode: parseEnum('REGISTRATION_MODE', 'public', ['public', 'private'] as const),
  linkPreviewEnabled: parseBoolean('LINK_PREVIEW_ENABLED', false),
  linkPreviewMetadataCacheTtlSeconds: parsePositiveInt('LINK_PREVIEW_METADATA_CACHE_TTL_SECONDS', 3600, { min: 10, max: 86400 }),
  linkPreviewNegativeCacheTtlSeconds: parsePositiveInt('LINK_PREVIEW_NEGATIVE_CACHE_TTL_SECONDS', 5, { min: 1, max: 60 }),
  linkPreviewFetchTimeoutMs: parsePositiveInt('LINK_PREVIEW_FETCH_TIMEOUT_MS', 4000, { min: 500, max: 30000 }),
  linkPreviewHtmlMaxBytes: parsePositiveInt('LINK_PREVIEW_HTML_MAX_BYTES', 262144, { min: 8192, max: 1048576 }),
  linkPreviewMaxRedirects: parsePositiveInt('LINK_PREVIEW_MAX_REDIRECTS', 3, { min: 0, max: 10 }),
  linkPreviewRateLimitWindowMs: parsePositiveInt('LINK_PREVIEW_RATE_LIMIT_WINDOW_MS', 60000, { min: 1000, max: 3600000 }),
  linkPreviewRateLimitMax: parsePositiveInt('LINK_PREVIEW_RATE_LIMIT_MAX', 30, { min: 1, max: 1000 }),

  linkPreviewImageCacheEnabled: parseBoolean('LINK_PREVIEW_IMAGE_CACHE_ENABLED', true),
  linkPreviewImageCacheDir: (() => {
    const raw = process.env.LINK_PREVIEW_IMAGE_CACHE_DIR?.trim();
    const defaultDir = path.join(process.cwd(), 'storage', 'link-preview-cache');
    if (!raw) return defaultDir;
    const resolved = path.resolve(raw);
    const unsafeDirs = new Set([
      path.resolve('/'),
      path.resolve('/app'),
      path.resolve('/app/storage'),
      path.resolve(process.cwd()),
      path.resolve(process.cwd(), 'storage')
    ]);
    if (unsafeDirs.has(resolved)) {
      throw new Error(`LINK_PREVIEW_IMAGE_CACHE_DIR cannot be a parent or root system directory: ${resolved}`);
    }
    return resolved;
  })(),
  linkPreviewImageCacheTtlSeconds: parsePositiveInt('LINK_PREVIEW_IMAGE_CACHE_TTL_SECONDS', 86400, { min: 60, max: 604800 }),
  linkPreviewImageCacheMaxTotalBytes: parsePositiveInt('LINK_PREVIEW_IMAGE_CACHE_MAX_TOTAL_BYTES', 524288000, { min: 1048576, max: 10737418240 }),
  linkPreviewImageCacheMaxFileBytes: parsePositiveInt('LINK_PREVIEW_IMAGE_CACHE_MAX_FILE_BYTES', 2097152, { min: 10240, max: 10485760 }),
  linkPreviewImageCacheCleanupIntervalSeconds: parsePositiveInt('LINK_PREVIEW_IMAGE_CACHE_CLEANUP_INTERVAL_SECONDS', 3600, { min: 60, max: 86400 }),
  trustProxy: parseBoolean('TRUST_PROXY', false),
  strictProductionSecurity: parseBoolean('STRICT_PRODUCTION_SECURITY', true),
  enforceHttps: parseBoolean('ENFORCE_HTTPS', true),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT ?? '256kb',
  urlencodedBodyLimit: process.env.URLENCODED_BODY_LIMIT ?? '64kb',
  globalRateLimitWindowMs: parsePositiveInt('GLOBAL_RATE_LIMIT_WINDOW_MS', 60_000),
  globalRateLimitMax: parsePositiveInt('GLOBAL_RATE_LIMIT_MAX', 300),
  authRateLimitWindowMs: parsePositiveInt('AUTH_RATE_LIMIT_WINDOW_MS', 900_000),
  authRateLimitMax: parsePositiveInt('AUTH_RATE_LIMIT_MAX', 10),
  userLookupRateLimitWindowMs: parsePositiveInt('USER_LOOKUP_RATE_LIMIT_WINDOW_MS', 60_000),
  userLookupRateLimitMax: parsePositiveInt('USER_LOOKUP_RATE_LIMIT_MAX', 60),
  uploadRateLimitWindowMs: parsePositiveInt('UPLOAD_RATE_LIMIT_WINDOW_MS', 600_000),
  uploadRateLimitMax: parsePositiveInt('UPLOAD_RATE_LIMIT_MAX', 20),
  socketTypingLimitPer10s: parsePositiveInt('SOCKET_TYPING_LIMIT_PER_10S', 20),
  socketPresenceLimitPerMin: parsePositiveInt('SOCKET_PRESENCE_LIMIT_PER_MIN', 20),
  socketJoinLeaveLimitPerMin: parsePositiveInt('SOCKET_JOIN_LEAVE_LIMIT_PER_MIN', 60),
  socketMarkReadLimitPerMin: parsePositiveInt('SOCKET_MARK_READ_LIMIT_PER_MIN', 120),
  authLockWindowSeconds: parsePositiveInt('AUTH_LOCK_WINDOW_SECONDS', 900, { min: 30, max: 86_400 }),
  authLockMaxAttempts: parsePositiveInt('AUTH_LOCK_MAX_ATTEMPTS', 10, { min: 3, max: 100 }),
  dbConnectionLimit: parsePositiveInt('DB_CONNECTION_LIMIT', 25, { min: 1, max: 200 }),
  dbPoolTimeoutSeconds: parsePositiveInt('DB_POOL_TIMEOUT_SECONDS', 15, { min: 1, max: 120 }),
  cacheProvider: parseEnum('CACHE_PROVIDER', 'redis', ['redis', 'memory'] as const),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  cacheFallbackToMemory: parseBoolean('CACHE_FALLBACK_TO_MEMORY', true),
  cacheDefaultTtlSeconds: parsePositiveInt('CACHE_DEFAULT_TTL_SECONDS', 30, { min: 1, max: 3600 }),
  cacheMaxEntries: parsePositiveInt('CACHE_MAX_ENTRIES', 5000, { min: 100, max: 1_000_000 }),
  cacheChatsTtlSeconds: parsePositiveInt('CACHE_CHATS_TTL_SECONDS', 10, { min: 1, max: 3600 }),
  cacheUsersTtlSeconds: parsePositiveInt('CACHE_USERS_TTL_SECONDS', 30, { min: 1, max: 3600 }),
  cacheLookupTtlSeconds: parsePositiveInt('CACHE_LOOKUP_TTL_SECONDS', 60, { min: 1, max: 3600 }),
  cacheContactsTtlSeconds: parsePositiveInt('CACHE_CONTACTS_TTL_SECONDS', 15, { min: 1, max: 3600 }),
  cacheMembersTtlSeconds: parsePositiveInt('CACHE_MEMBERS_TTL_SECONDS', 10, { min: 1, max: 3600 }),
  logLevel: parseEnum('LOG_LEVEL', 'info', ['debug', 'info', 'warn', 'error'] as const),
  logFileEnabled: parseBoolean('LOG_FILE_ENABLED', true),
  logFilePath: process.env.LOG_FILE_PATH ?? '../logs/backend-error.log'
};

if (!/^[A-Za-z0-9_\-]{3,64}$/.test(env.csrfCookieName)) {
  throw new Error('CSRF_COOKIE_NAME must be 3-64 chars of [A-Za-z0-9_-]');
}

if (env.nodeEnv === 'production' && env.strictProductionSecurity) {
  const weakSecrets = new Set([
    'change-me',
    'change-me-too',
    'secret',
    'jwt-secret',
    'dev-secret',
    'development',
    'password',
    '12345678',
    'change_me_use_at_least_32_random_chars',
    'replace-with-strong-random-secret-at-least-32-chars',
    'replace-with-a-strong-random-secret',
    'replace-with-a-different-strong-random-secret'
  ]);
  const weakRootPasswords = new Set([
    'admin1234',
    'change-me',
    'password',
    '12345678',
    'qwerty123',
    'admin',
    'change-root-password-min-12-chars',
    'replace-root-password',
    'nexus',
    'nexusadmin',
    'telegram',
    'telegramclone'
  ]);
  const placeholderRootUsernames = new Set([
    'change-root-username',
    'replace-root-username'
  ]);

  const jwtSecretWeak = env.jwtSecret.length < 32 || weakSecrets.has(env.jwtSecret.toLowerCase());
  const jwtRefreshSecretWeak = env.jwtRefreshSecret.length < 32 || weakSecrets.has(env.jwtRefreshSecret.toLowerCase());
  if (jwtSecretWeak || jwtRefreshSecretWeak) {
    throw new Error('Refusing to start in production with weak JWT secrets');
  }

  const rootPasswordLower = env.defaultRootPassword.toLowerCase();
  const rootUsernameLower = env.defaultRootUsername.toLowerCase();

  if (
    weakRootPasswords.has(rootPasswordLower) ||
    env.defaultRootPassword.length < 12 ||
    rootPasswordLower === rootUsernameLower ||
    rootPasswordLower.includes(rootUsernameLower)
  ) {
    throw new Error('Refusing to start in production with weak or username-related DEFAULT_ROOT_PASSWORD');
  }

  if (placeholderRootUsernames.has(rootUsernameLower)) {
    throw new Error('Refusing to start in production with default placeholder DEFAULT_ROOT_USERNAME');
  }

  if (env.resetRootPasswordOnBoot) {
    throw new Error('Refusing to start in production with RESET_ROOT_PASSWORD_ON_BOOT=true');
  }

  if (!env.cookieSecure) {
    throw new Error('Refusing to start in production with COOKIE_SECURE=false');
  }

  const hasUnsafeOrigin = env.clientOrigins.some(origin => {
    const normalized = origin.toLowerCase();
    if (normalized.includes('*') || normalized.includes('localhost') || normalized.includes('127.0.0.1')) {
      return true;
    }
    try {
      const parsed = new URL(origin);
      return parsed.protocol !== 'https:';
    } catch {
      return true;
    }
  });

  if (hasUnsafeOrigin) {
    throw new Error('Refusing to start in production with unsafe CLIENT_ORIGIN entries');
  }
}
