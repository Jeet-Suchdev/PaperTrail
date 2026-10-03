import 'dotenv/config';
import { z } from 'zod';

// Env parsing is fail-fast: if anything is missing or malformed the server
// refuses to start, with a message that says exactly what is wrong.

// z.coerce.boolean("false") is true (any non-empty string is), so booleans
// from .env need an explicit string-to-boolean step.
const envBoolean = z.preprocess((value) => {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Only tests read this (see vitest.config.ts); optional so production
  // deployments don't need a second database.
  DATABASE_URL_TEST: z.string().min(1).optional(),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECURE: envBoolean.default(false),
  // Single source of truth for session lifetime: JWT expiresIn (seconds)
  // and cookie Max-Age (milliseconds) both derive from this.
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),
  // Market routes are keyed by user id (not IP), so this is a per-user cap.
  RATE_LIMIT_MARKET_MAX: z.coerce.number().int().positive().default(120),
  STARTING_BALANCE_PAISE: z.coerce.number().int().positive().default(100000000),
  MARKET_PROVIDER: z.enum(['yahoo', 'simulated']).default('yahoo'),
  PRICE_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  // How long a cached quote may be served (market hours). Kept separate from
  // MAX_PRICE_AGE_SECONDS (order staleness) — a short order window must not
  // thrash the cache. Must be >= 2x the poll interval so a poller tick keeps
  // the cache warm; enforced below.
  MARKET_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  MAX_PRICE_AGE_SECONDS: z.coerce.number().int().positive().default(120),
  ALLOW_AFTER_HOURS_TRADING: envBoolean.default(false),
  LLM_PROVIDER: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  AI_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof envSchema>;

// Cross-field check: a cache TTL shorter than two poll intervals means the
// poller can never keep a row fresh and every request would refetch.
const validatedEnvSchema = envSchema.refine(
  (value) => value.MARKET_CACHE_TTL_SECONDS >= 2 * value.PRICE_POLL_INTERVAL_SECONDS,
  {
    message: 'MARKET_CACHE_TTL_SECONDS must be at least 2x PRICE_POLL_INTERVAL_SECONDS',
    path: ['MARKET_CACHE_TTL_SECONDS'],
  },
);

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = validatedEnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment variables:\n${details}\n` +
        'Copy server/.env.example to server/.env and fill in the values.',
    );
  }
  return result.data;
}

// Imported for its side effect above, so this throws at startup when bad.
export const env = parseEnv(process.env);
