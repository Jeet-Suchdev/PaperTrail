import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prismaBin = path.join(serverRoot, 'node_modules', '.bin', 'prisma');

// Runs once before any test file: applies committed migrations to the
// dedicated test database (papertrail_test), never to dev (papertrail).
// `prisma migrate deploy` applies what's already committed and never
// creates new migrations — safe to run on every test invocation.
//
// DATABASE_URL is overridden only for this child process. Config values
// still come exclusively from config/env.ts (which loads .env itself);
// the process.env spread is PATH plumbing for the spawned CLI, not config
// reading.
export function setup(): void {
  if (!env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST is not set. Copy server/.env.example to server/.env.');
  }

  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL_TEST },
    stdio: 'inherit',
  });
}
