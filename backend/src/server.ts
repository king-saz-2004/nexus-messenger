import express from 'express';
import http from 'http';
import path from 'node:path';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { connectDb, effectiveDatabaseUrl, stopDb } from './config/db.js';
import { logger } from './config/logger.js';
import { ensureRootAdmin } from './services/adminSeed.js';
import { AVATAR_ROOT_DIR, ensureAvatarRootExists } from './services/avatarStorage.js';
import { initCache, shutdownCache } from './cache/index.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import contactsRoutes from './routes/contacts.js';
import chatsRoutes from './routes/chats.js';
import chatMembersRoutes from './routes/chatMembers.js';
import groupsRoutes from './routes/groups.js';
import messagesRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';
import linkPreviewRoutes from './routes/linkPreview.js';
import {
  ensureLinkPreviewImageCacheDir,
  cleanupLinkPreviewImageCache,
  startLinkPreviewImageCacheCleanup
} from './services/linkPreview/imageCache.js';
import { requestGuards } from './middleware/requestGuards.js';

import { globalRateLimiter } from './middleware/rateLimits.js';
import { corsOptions, securityHeaders, socketCorsOptions } from './middleware/securityHeaders.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { registerSocketHandlers } from './sockets/index.js';

const app = express();
const server = http.createServer(app);

const describeDatabaseTarget = () => {
  try {
    const url = new URL(effectiveDatabaseUrl);
    const dbName = url.pathname.replace(/^\/+/, '') || '(default)';
    return `${url.protocol}//${url.hostname}:${url.port || '(default)'}/${dbName}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
};

const io = new SocketIOServer(server, {
  cors: socketCorsOptions
});

registerSocketHandlers(io);

const apiRoutePrefixes = [
  '/auth',
  '/users',
  '/contacts',
  '/chats',
  '/groups',
  '/messages',
  '/media',
  '/avatars',
  '/health',
  '/socket.io',
  '/admin',
  '/link-preview'
];
const frontendStaticRoot = path.resolve(process.cwd(), 'public');
const frontendIndexPath = path.join(frontendStaticRoot, 'index.html');

app.set('trust proxy', env.trustProxy);
app.use(securityHeaders);

const isApiRoute = (requestPath: string) =>
  apiRoutePrefixes.some(prefix => requestPath === prefix || requestPath.startsWith(`${prefix}/`));

const corsMiddleware = cors(corsOptions);
app.use((req, res, next) => {
  if (!isApiRoute(req.path)) {
    return next();
  }
  return corsMiddleware(req, res, next);
});
app.options('*', (req, res, next) => {
  if (!isApiRoute(req.path)) {
    return res.sendStatus(204);
  }
  return corsMiddleware(req, res, next);
});
app.use(requestGuards);
app.use(requestLogger);
app.use((req, res, next) => {
  if (env.nodeEnv === 'production' && env.enforceHttps && !req.secure) {
    return res.status(400).json({ message: 'HTTPS is required' });
  }
  return next();
});
app.use(express.json({ limit: env.jsonBodyLimit }));
app.use(
  express.urlencoded({
    extended: false,
    limit: env.urlencodedBodyLimit,
    parameterLimit: 40
  })
);
app.use(cookieParser());
ensureAvatarRootExists();
app.use(
  '/avatars',
  express.static(path.resolve(AVATAR_ROOT_DIR), {
    fallthrough: true,
    maxAge: '7d'
  })
);

app.use(globalRateLimiter);
app.use(csrfProtection);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/contacts', contactsRoutes);
app.use('/chats', chatsRoutes);
app.use('/chats', chatMembersRoutes);
app.use('/groups', groupsRoutes);
app.use(messagesRoutes);
app.use(linkPreviewRoutes);
app.use('/admin', adminRoutes);

if (env.nodeEnv === 'production') {
  app.use(
    express.static(frontendStaticRoot, {
      index: false,
      maxAge: '1h'
    })
  );

  app.head('/', (_req, res) => {
    res.status(200).end();
  });

  app.get('*', (req, res, next) => {
    if (
      req.method !== 'GET' ||
      isApiRoute(req.path)
    ) {
      return next();
    }

    return res.sendFile(frontendIndexPath, err => {
      if (err) next(err);
    });
  });
}

app.use(notFound);
app.use(errorHandler);

const start = async () => {
  await connectDb();
  await initCache();
  await ensureRootAdmin();

  // Initialize preview image cache directory and cleanup schedule
  try {
    await ensureLinkPreviewImageCacheDir();
    await cleanupLinkPreviewImageCache();
    startLinkPreviewImageCacheCleanup();
  } catch (err) {
    if (env.linkPreviewEnabled && env.linkPreviewImageCacheEnabled) {
      logger.error('startup_image_cache_initialization_failed_fatal', { error: err });
      throw err;
    } else {
      logger.warn('startup_image_cache_initialization_failed_non_fatal', { error: err });
    }
  }

  logger.info('startup_config', {
    nodeEnv: env.nodeEnv,
    port: env.port,
    trustProxy: env.trustProxy,
    databaseTarget: describeDatabaseTarget(),
    dbConnectionLimit: env.dbConnectionLimit,
    dbPoolTimeoutSeconds: env.dbPoolTimeoutSeconds,
    logLevel: logger.config.level,
    logFileEnabled: logger.config.fileEnabled,
    logFilePath: logger.config.filePath
  });

  server.on('error', err => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logger.error('server_listen_port_in_use', {
        port: env.port,
        error: err
      });
      process.exit(1);
    }
    logger.error('server_error', { error: err });
    process.exit(1);
  });

  server.listen(env.port, () => {
    logger.info('server_started', { port: env.port });
  });
};

start().catch(err => {
  logger.error('startup_failed', { error: err });
  process.exit(1);
});

const gracefulShutdown = async (signal: string) => {
  logger.info('shutdown_begin', { signal });
  try {
    await new Promise<void>(resolve => {
      io.close(() => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
    await stopDb();
    await shutdownCache();
    await logger.flushAndClose();
  } catch (err) {
    logger.error('shutdown_error', { signal, error: err });
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
