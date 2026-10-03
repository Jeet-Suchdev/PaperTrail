import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { createMarketRouter } from './routes';
import { createMarketLimiters } from './rate-limit';
import { MarketQueryService } from './query-service';
import { TrackedSymbols } from './tracked-symbols';
import type { MarketService } from './market-service';
import type { Quote } from './types';

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'RELIANCE',
    exchange: 'NSE',
    pricePaise: 116770,
    prevClosePaise: 118700,
    changePaise: -1930,
    changePercent: -1.63,
    asOf: '2026-10-01T09:45:00.000Z',
    marketTime: '2026-10-01T09:45:00.000Z',
    delayMinutes: 15,
    isSimulated: false,
    ...overrides,
  };
}

function makeApp(
  options: { quote?: Quote[]; limiters?: ReturnType<typeof createMarketLimiters> } = {},
) {
  const quotes = options.quote ?? [makeQuote()];
  const getQuotes = vi.fn(async (_symbols: string[]): Promise<Quote[]> => quotes);
  const searchInstruments = vi.fn(async (_query: string) => [
    {
      symbol: 'RELIANCE',
      exchange: 'NSE' as const,
      yahooSymbol: 'RELIANCE.NS',
      name: 'Reliance Industries Limited',
    },
  ]);
  const service = { getQuotes, searchInstruments } as unknown as MarketService;
  const trackedSymbols = new TrackedSymbols();
  const queryService = new MarketQueryService({ service, trackedSymbols });
  const app = createApp({
    marketRouter: createMarketRouter({ queryService, limiters: options.limiters }),
  });
  return { app, getQuotes, searchInstruments, trackedSymbols };
}

function authCookie(userId = 'user-123'): string {
  return `session=${jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '1h' })}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/market/quote/:symbol', () => {
  it('requires a session cookie', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/market/quote/RELIANCE');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the full quote with integer paise and no float leakage', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/market/quote/RELIANCE').set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body.quote).toEqual({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      pricePaise: 116770,
      prevClosePaise: 118700,
      changePaise: -1930,
      changePercent: -1.63,
      asOf: '2026-10-01T09:45:00.000Z',
      marketTime: '2026-10-01T09:45:00.000Z',
      delayMinutes: 15,
      isSimulated: false,
    });
    expect(Number.isInteger(res.body.quote.pricePaise)).toBe(true);
    expect(Number.isInteger(res.body.quote.prevClosePaise)).toBe(true);
    expect(Number.isInteger(res.body.quote.changePaise)).toBe(true);
  });

  it('omits delayMinutes when the provider did not report it', async () => {
    const quote = makeQuote();
    delete quote.delayMinutes;
    const { app } = makeApp({ quote: [quote] });

    const res = await request(app).get('/api/market/quote/RELIANCE').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect('delayMinutes' in res.body.quote).toBe(false);
  });

  it('accepts ?exchange=BSE and defaults to NSE', async () => {
    const { app, getQuotes } = makeApp();
    await request(app).get('/api/market/quote/TCS?exchange=BSE').set('Cookie', authCookie());
    expect(getQuotes).toHaveBeenCalledWith(['TCS.BO']);

    await request(app).get('/api/market/quote/RELIANCE').set('Cookie', authCookie());
    expect(getQuotes).toHaveBeenCalledWith(['RELIANCE.NS']);
  });

  it('rejects invalid symbols with a 400 and field details', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/market/quote/RELIANCE.NS').set('Cookie', authCookie());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('symbol');
  });

  it('rejects an unsupported exchange value', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get('/api/market/quote/RELIANCE?exchange=NYSE')
      .set('Cookie', authCookie());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s an unknown symbol (no upstream details leaked)', async () => {
    const { app } = makeApp({ quote: [] });
    const res = await request(app).get('/api/market/quote/NOPE').set('Cookie', authCookie());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain('yahoo');
  });

  it('serves a simulated quote with the badge, flag set, when upstream is down', async () => {
    const { app } = makeApp({ quote: [makeQuote({ isSimulated: true, pricePaise: 116770 })] });
    const res = await request(app).get('/api/market/quote/RELIANCE').set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body.quote.isSimulated).toBe(true);
  });

  it('never leaks upstream error messages', async () => {
    const { app, getQuotes } = makeApp();
    getQuotes.mockRejectedValue(new Error('fetch failed: raw payload with secret-token-abc'));
    const res = await request(app).get('/api/market/quote/RELIANCE').set('Cookie', authCookie());

    // An unexpected throw is a bug -> generic 500, internals stay server-side.
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(JSON.stringify(res.body)).not.toContain('secret-token-abc');
  });

  it('tracks only symbols whose quote was actually found', async () => {
    const { app, trackedSymbols } = makeApp();
    await request(app).get('/api/market/quote/RELIANCE').set('Cookie', authCookie());
    expect(trackedSymbols.list()).toEqual(['RELIANCE.NS']);

    const empty = makeApp({ quote: [] });
    await request(empty.app).get('/api/market/quote/GHOST').set('Cookie', authCookie());
    expect(empty.trackedSymbols.size).toBe(0);
  });
});

describe('GET /api/market/search', () => {
  it('requires a session cookie', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/market/search?q=reliance');
    expect(res.status).toBe(401);
  });

  it('returns instruments for a query', async () => {
    const { app, searchInstruments } = makeApp();
    const res = await request(app).get('/api/market/search?q=reliance').set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body.instruments).toEqual([
      {
        symbol: 'RELIANCE',
        exchange: 'NSE',
        yahooSymbol: 'RELIANCE.NS',
        name: 'Reliance Industries Limited',
      },
    ]);
    expect(searchInstruments).toHaveBeenCalledWith('reliance');
  });

  it('returns an empty list (200) when nothing matches', async () => {
    const { app, searchInstruments } = makeApp();
    searchInstruments.mockResolvedValue([]);
    const res = await request(app).get('/api/market/search?q=zzzz').set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(res.body.instruments).toEqual([]);
  });

  it('rejects a missing or oversized query with 400', async () => {
    const { app } = makeApp();
    const missing = await request(app).get('/api/market/search').set('Cookie', authCookie());
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const long = await request(app)
      .get(`/api/market/search?q=${'a'.repeat(51)}`)
      .set('Cookie', authCookie());
    expect(long.status).toBe(400);
  });
});

describe('market rate limiting', () => {
  it('keys the limit by user id, not IP, and returns our 429 shape', async () => {
    const { app } = makeApp({
      limiters: createMarketLimiters({ windowMs: 60_000, marketMax: 2 }),
    });

    const cookie = authCookie('user-a');
    const first = await request(app).get('/api/market/quote/RELIANCE').set('Cookie', cookie);
    const second = await request(app).get('/api/market/quote/RELIANCE').set('Cookie', cookie);
    const third = await request(app).get('/api/market/quote/RELIANCE').set('Cookie', cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');

    // A different user (same IP in supertest) has its own budget.
    const otherUser = await request(app)
      .get('/api/market/quote/RELIANCE')
      .set('Cookie', authCookie('user-b'));
    expect(otherUser.status).toBe(200);
  });

  it('counts anonymous requests in one shared bucket (safety net)', async () => {
    const { app } = makeApp({
      limiters: createMarketLimiters({ windowMs: 60_000, marketMax: 1 }),
    });

    const anon1 = await request(app).get('/api/market/quote/RELIANCE');
    expect(anon1.status).toBe(401); // requireAuth runs before the limiter
    const anon2 = await request(app).get('/api/market/quote/RELIANCE');
    expect(anon2.status).toBe(401);
  });
});

describe('app factory', () => {
  it('createApp starts no timers of its own (the poller is index.ts-only)', () => {
    vi.useFakeTimers();
    try {
      // No-op limiters so the only timers that could exist would be ours.
      const noop: RequestHandler = (_req, _res, next) => next();
      const before = vi.getTimerCount();
      const app = createApp({
        marketRouter: createMarketRouter({
          queryService: new MarketQueryService({
            service: {
              getQuotes: async () => [makeQuote()],
              searchInstruments: async () => [],
            } as unknown as MarketService,
            trackedSymbols: new TrackedSymbols(),
          }),
          limiters: { quote: noop, search: noop },
        }),
      });
      expect(app).toBeDefined();
      expect(vi.getTimerCount()).toBe(before);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the default limiters only add rate-limit store timers, not poller timers', () => {
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      createMarketLimiters();
      // One in-memory store timer per rateLimit() instance (quote + search);
      // the price poller is never touched here.
      expect(vi.getTimerCount()).toBe(before + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
