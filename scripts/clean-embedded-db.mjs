import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const backendDir = path.resolve(rootDir, 'backend');
const backendDataDir = path.resolve(backendDir, '.embedded-postgres');
const rootDataDir = path.resolve(rootDir, '.embedded-postgres');
const isWindows = process.platform === 'win32';

if (!backendDataDir.startsWith(backendDir + path.sep)) {
  throw new Error(`Refusing to delete path outside backend directory: ${backendDataDir}`);
}

const runCommand = (label, command, args, cwd, ignoreFailure = false) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows
    });

    proc.stdout?.on('data', chunk => {
      process.stdout.write(`[${label}] ${chunk.toString()}`);
    });
    proc.stderr?.on('data', chunk => {
      process.stderr.write(`[${label}] ${chunk.toString()}`);
    });

    proc.on('exit', code => {
      if (code === 0 || ignoreFailure) {
        resolve(undefined);
      } else {
        reject(new Error(`${label} failed with exit code ${code ?? 1}`));
      }
    });
  });

await runCommand('Docker compose down', 'docker', ['compose', 'down', '-v', '--remove-orphans'], rootDir, true);
await fs.rm(backendDataDir, { recursive: true, force: true });
await fs.rm(rootDataDir, { recursive: true, force: true });
console.log(`[clean] Removed stale embedded postgres directories: ${backendDataDir}, ${rootDataDir}`);
