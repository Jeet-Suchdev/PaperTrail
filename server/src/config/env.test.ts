import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const minimalValidEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/papertrail',
  JWT_SECRET: 'test-secret',
};

describe('parseEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = parseEnv(minimalValidEnv);

    expect(env.PORT).toBe(3001);
    expect(env.STARTING_BALANCE_PAISE).toBe(100000000);
    expect(env.MARKET_PROVIDER).toBe('yahoo');
  });

  it('parses "false" as boolean false (String coercion would say true)', () => {
    const env = parseEnv({
      ...minimalValidEnv,
      COOKIE_SECURE: 'false',
      ALLOW_AFTER_HOURS_TRADING: '0',
    });

    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.ALLOW_AFTER_HOURS_TRADING).toBe(false);
  });

  it('parses "true" as boolean true', () => {
    const env = parseEnv({ ...minimalValidEnv, COOKIE_SECURE: 'true' });

    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('coerces numeric strings to numbers', () => {
    const env = parseEnv({ ...minimalValidEnv, PORT: '4000', STARTING_BALANCE_PAISE: '500' });

    expect(env.PORT).toBe(4000);
    expect(env.STARTING_BALANCE_PAISE).toBe(500);
  });

  it('fails fast with a helpful message when required variables are missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({})).toThrow(/server\/\.env\.example/);
  });

  it('rejects invalid values for enumerated variables', () => {
    expect(() => parseEnv({ ...minimalValidEnv, MARKET_PROVIDER: 'bloomberg' })).toThrow(
      /MARKET_PROVIDER/,
    );
  });
});
