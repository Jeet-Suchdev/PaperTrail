import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Make DATABASE_URL_TEST available when the workers start.
dotenv.config({ path: '.env' });

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    'DATABASE_URL_TEST is not set. Copy server/.env.example to server/.env ' +
      '(it points at the papertrail_test database from docker-compose.yml).',
  );
}

export default defineConfig({
  test: {
    environment: 'node',
    // Applies migrations to the test DB (papertrail_test) once before
    // any test file runs — see src/test/globalSetup.ts.
    globalSetup: './src/test/globalSetup.ts',
    env: {
      // Every test runs against the dedicated test database, never dev data.
      DATABASE_URL: process.env.DATABASE_URL_TEST,
    },
  },
});
