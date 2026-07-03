import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';

const rootDir = process.cwd();
const backendDir = path.join(rootDir, 'backend');
const isWindows = process.platform === 'win32';
const npmCmd = 'npm';
const dockerCmd = 'docker';

const serviceState = new Map();
let shuttingDown = false;
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 1200;

const attachOutput = (child, name) => {
  child.stdout?.on('data', chunk => {
    process.stdout.write(`[${name}] ${chunk.toString()}`);
  });

  child.stderr?.on('data', chunk => {
    process.stderr.write(`[${name}] ${chunk.toString()}`);
  });
};

const canConnect = port =>
  new Promise(resolve => {
    const socket = new net.Socket();
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });

const cleanupConflictingPorts = async ports => {
  if (!isWindows) return;

  const portPids = new Set();
  const netstat = spawn('netstat', ['-ano', '-p', 'tcp'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  let stdout = '';
  await new Promise((resolve, reject) => {
    netstat.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    netstat.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`netstat failed with exit code ${code ?? 1}`));
    });
  }).catch(() => undefined);

  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith('tcp')) continue;
    if (!trimmed.toLowerCase().includes('listening')) continue;
    for (const port of ports) {
      if (!trimmed.includes(`:${port}`)) continue;
      const parts = trimmed.split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        portPids.add(pid);
      }
    }
  }

  for (const pid of portPids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
};

const spawnService = name => {
  const config = name === 'backend'
    ? { cwd: backendDir, args: ['run', 'dev'] }
    : { cwd: rootDir, args: ['run', 'dev'] };
  const existing = serviceState.get(name) ?? { restarts: 0, child: null };
  const child = spawn(npmCmd, config.args, {
    cwd: config.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows
  });

  attachOutput(child, name);
  existing.child = child;
  serviceState.set(name, existing);

  child.on('exit', code => {
    if (shuttingDown) return;
    const exitCode = typeof code === 'number' ? code : 1;
    console.error(`[${name}] exited with code ${exitCode}`);

    if (existing.restarts >= MAX_RESTARTS) {
      console.error(`[${name}] exceeded max restarts (${MAX_RESTARTS}).`);
      shutdown(exitCode);
      return;
    }

    existing.restarts += 1;
    console.log(`[${name}] restarting (${existing.restarts}/${MAX_RESTARTS})...`);
    setTimeout(() => {
      if (!shuttingDown) {
        spawnService(name);
      }
    }, RESTART_DELAY_MS);
  });
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of serviceState.values()) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const { child } of serviceState.values()) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(code);
  }, 1000).unref();
};

const runCommand = (label, command, args, cwd) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows
    });
    attachOutput(proc, label);

    proc.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code ?? 1}`));
      }
    });
  });

const ensureDockerInfra = async () => {
  await runCommand(
    'Docker compose up postgres+redis',
    dockerCmd,
    ['compose', 'up', '-d', 'postgres', 'redis'],
    rootDir
  );
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  await ensureDockerInfra();
  console.log('[startup] Fresh Docker DB is initialized by docker-entrypoint init.sql. Existing DB migrations must be run with: npm --prefix backend run db:migrate');
  await cleanupConflictingPorts([3000, 4000]);

  spawnService('backend');
  spawnService('frontend');

  console.log('All services are running.');
  console.log('Database: docker compose postgres service on localhost:5432');
  console.log('Cache:    docker compose redis service on localhost:6379');
  console.log('Frontend: http://localhost:3000');
  console.log('Backend:  http://localhost:4000');

  setTimeout(async () => {
    if (shuttingDown) return;
    const backendUp = await canConnect(4000);
    if (!backendUp) {
      console.error('[backend] health preflight failed on port 4000. waiting for auto-restart...');
    }
  }, 2500).unref();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  console.error('Ensure Docker Desktop is running and docker compose is available.');
  shutdown(1);
}
