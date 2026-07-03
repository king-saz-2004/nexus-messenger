import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;
const REDACTED_VALUE = '[REDACTED]';
const SECRET_KEY_PATTERN = /(authorization|cookie|token|secret|password|csrf)/i;

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const currentLevel = env.logLevel;
const currentRank = levelRank[currentLevel];

const resolvedFilePath = path.resolve(process.cwd(), env.logFilePath);
let errorFileStream: fs.WriteStream | null = null;

const ensureFileStream = () => {
  if (!env.logFileEnabled) return null;
  if (errorFileStream) return errorFileStream;

  fs.mkdirSync(path.dirname(resolvedFilePath), { recursive: true });
  errorFileStream = fs.createWriteStream(resolvedFilePath, { flags: 'a' });
  return errorFileStream;
};

const writeLine = (line: string) => {
  process.stdout.write(`${line}\n`);
};

const writeErrorLine = (line: string) => {
  process.stderr.write(`${line}\n`);
};

const serializeError = (error: unknown) => {
  if (!(error instanceof Error)) return undefined;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
};

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        sanitized[key] = REDACTED_VALUE;
        continue;
      }
      sanitized[key] = sanitizeValue(nested, depth + 1);
    }
    return sanitized;
  }
  return value;
};

const logInternal = (level: LogLevel, message: string, context?: LogContext) => {
  if (levelRank[level] < currentRank) return;

  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message
  };

  if (context && Object.keys(context).length > 0) {
    payload.context = sanitizeValue(context);
  }

  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'warn') {
    writeErrorLine(line);
  } else {
    writeLine(line);
  }

  if (level === 'error') {
    const stream = ensureFileStream();
    stream?.write(`${line}\n`);
  }
};

export const logger = {
  debug: (message: string, context?: LogContext) => logInternal('debug', message, context),
  info: (message: string, context?: LogContext) => logInternal('info', message, context),
  warn: (message: string, context?: LogContext) => logInternal('warn', message, context),
  error: (message: string, context?: LogContext & { error?: unknown }) =>
    logInternal('error', message, {
      ...(context ?? {}),
      ...(context?.error ? { error: serializeError(context.error) } : {})
    }),
  flushAndClose: async () => {
    if (!errorFileStream) return;

    await new Promise<void>(resolve => {
      errorFileStream?.end(() => resolve());
    });
    errorFileStream = null;
  },
  config: {
    level: currentLevel,
    fileEnabled: env.logFileEnabled,
    filePath: resolvedFilePath
  }
};
