import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketService, type MarketServiceOptions } from './market-service';
import { InMemoryPriceCache } from './price-cache';
import type { InstrumentSearchResult, MarketDataProvider, Quote } from './types';

const FIXED_ISO = '2026-10-03T08:00:00.000Z';

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'RELIANCE',
    exchange: 'NSE',
    pricePaise: 116770,
    prevClosePaise: 118700,
    changePaise: -1930,
    changePercent: -1.63,
    asOf: FIXED_ISO,
    marketTime: FIXED_ISO,
    delayMinutes: 15,
    isSimulated: false,
    ...overrides,
  };
}

function namedError(name: string, message = 'boom'): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

interface Stub {
  provider: MarketDataProvider;
  getQuotes: ReturnType<typeof vi.fn>;
  searchInstruments: ReturnType<typeof vi.fn>;
}

function stub(): Stub {
  const getQuotes = vi.fn(async (_symbols: string[]): Promise<Quote[]> => []);
  const searchInstruments = vi.fn(async (_query: string): Promise<InstrumentSearchResult[]> => []);
  return { provider: { getQuotes, searchInstruments }, getQuotes, searchInstruments };
}

type TestOverrides = Partial<
  Omit<MarketServiceOptions, 'provider' | 'fallback' | 'cache' | 'logger' | 'nowMs'>
>;

function setup(options: TestOverrides = {}) {
  const primary = stub();
  const fallback = stub();
  // Default fallback: one simulated quote per requested symbol.
  fallback.getQuotes.mockImplementation(async (symbols: string[]) =>
    symbols.map(() => makeQuote({ isSimulated: true })),
  );
  const cache = new InMemoryPriceCache();
  const info = vi.fn();
  const warn = vi.fn();
  const clock = { t: Date.parse(FIXED_ISO) };
  const service = new MarketService({
    provider: primary.provider,
    fallback: fallback.provider,
    cache,
    logger: { info, warn },
    nowMs: () => clock.t,
    backoffBaseMs: 0, // no real waiting in tests
    ...options,
  });
  return { service, primary, fallback, cache, info, warn, clock };
}

describe('MarketService cache behaviour', () => {
  it('serves a usable cache hit without touching the provider', async () => {
    const { service, primary, cache } = setup();
    cache.set(makeQuote());

    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ pricePaise: 116770, isSimulated: false });
    expect(primary.getQuotes).not.toHaveBeenCalled();
  });

  it('fetches on a miss and reuses the cache for the next call', async () => {
    const { service, primary } = setup();
    primary.getQuotes.mockResolvedValue([makeQuote()]);

    const first = await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);

    const second = await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // cache hit now
    expect(second[0]).toMatchObject({ pricePaise: 116770, isSimulated: false });
  });

  it('ignores cached simulated rows while live (they must be re-fetched)', async () => {
    const { service, primary, cache } = setup();
    cache.set(makeQuote({ isSimulated: true, pricePaise: 5 }));
    primary.getQuotes.mockResolvedValue([makeQuote()]);

    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1);
    expect(quotes[0]!.pricePaise).toBe(116770);
  });

  it('serves cached rows of any kind while in fallback mode', async () => {
    const { service, primary, fallback, clock } = setup({ failureThreshold: 1 });
    primary.getQuotes.mockRejectedValue(namedError('TypeError', 'fetch failed'));
    await service.getQuotes(['RELIANCE.NS']); // fails -> fallback (cached)
    clock.t += 1; // still inside cooldown
    primary.getQuotes.mockClear();
    fallback.getQuotes.mockClear(); // only count calls from the second request
    primary.getQuotes.mockResolvedValue([makeQuote()]);

    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).not.toHaveBeenCalled(); // cooldown: no probe
    expect(fallback.getQuotes).not.toHaveBeenCalled(); // cache hit: no fallback call
    expect(quotes[0]!.isSimulated).toBe(true); // cached simulated, usable in fallback
  });
});

describe('MarketService retries, fallback, and recovery', () => {
  it('retries a failing provider, then serves simulated quotes without crashing', async () => {
    const { service, primary, fallback } = setup({ maxAttempts: 3 });
    primary.getQuotes.mockRejectedValue(namedError('TypeError', 'fetch failed'));

    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(fallback.getQuotes).toHaveBeenCalledTimes(1);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ isSimulated: true, symbol: 'RELIANCE' });
    expect(service.getProviderStatus()).toEqual({
      mode: 'live',
      since: FIXED_ISO, // clock never moved
      consecutiveFailures: 1,
    });
  });

  it('switches to fallback at the threshold, logs the transition once, and stops probing during cooldown', async () => {
    const { service, primary, fallback, warn, clock } = setup({
      failureThreshold: 1,
      cooldownMs: 60_000,
    });
    primary.getQuotes.mockRejectedValue(namedError('TypeError', 'fetch failed'));

    await service.getQuotes(['RELIANCE.NS']);
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'fallback',
      consecutiveFailures: 1,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(NETWORK)'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('60000ms'));

    // Inside cooldown: simulated served, provider NOT called again.
    primary.getQuotes.mockClear();
    fallback.getQuotes.mockClear();
    clock.t += 59_999;
    const quotes = await service.getQuotes(['TCS.BO']);
    expect(primary.getQuotes).not.toHaveBeenCalled();
    expect(fallback.getQuotes).toHaveBeenCalledTimes(1);
    expect(quotes[0]!.isSimulated).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1); // no new transition logs
  });

  it('probes once after the cooldown; a failed probe extends the cooldown', async () => {
    const { service, primary, warn, clock } = setup({
      failureThreshold: 1,
      cooldownMs: 60_000,
    });
    primary.getQuotes.mockRejectedValue(namedError('TypeError'));
    await service.getQuotes(['RELIANCE.NS']); // -> fallback

    clock.t += 60_001; // cooldown over
    primary.getQuotes.mockClear();
    await service.getQuotes(['RELIANCE.NS']); // probe fails
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // probe: no retries
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'fallback',
      consecutiveFailures: 2,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fallback probe failed'));

    // Cooldown was extended: no probe on the next call.
    primary.getQuotes.mockClear();
    clock.t += 1;
    await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).not.toHaveBeenCalled();
  });

  it('returns to live mode on the first healthy probe and resets the counter', async () => {
    const { service, primary, info, clock } = setup({
      failureThreshold: 1,
      cooldownMs: 60_000,
    });
    primary.getQuotes.mockRejectedValue(namedError('AbortError'));
    await service.getQuotes(['RELIANCE.NS']); // -> fallback (served simulated)

    clock.t += 60_001;
    primary.getQuotes.mockResolvedValue([makeQuote()]);
    const quotes = await service.getQuotes(['RELIANCE.NS']); // probe succeeds
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'live',
      consecutiveFailures: 0,
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('live mode'));
    expect(quotes[0]).toMatchObject({ pricePaise: 116770, isSimulated: false });
    // Real quote is cached and usable in live mode now.
    primary.getQuotes.mockClear();
    const again = await service.getQuotes(['RELIANCE.NS']);
    expect(again[0]!.pricePaise).toBe(116770);
    expect(primary.getQuotes).not.toHaveBeenCalled();
  });

  it('treats badRequest as bad input: served simulated, never counted, no mode change', async () => {
    const { service, primary, warn } = setup({ maxAttempts: 3 });
    primary.getQuotes.mockRejectedValue(namedError('BadRequestError'));

    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // no retries for bad input
    expect(quotes[0]!.isSimulated).toBe(true);
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'live',
      consecutiveFailures: 0,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad request'));
  });

  it('counts a healthy empty answer as success (not-found, counter reset)', async () => {
    const { service, primary } = setup({ failureThreshold: 2 });
    primary.getQuotes.mockRejectedValue(namedError('TypeError'));
    await service.getQuotes(['RELIANCE.NS']); // failure 1 of 2
    expect(service.getProviderStatus().consecutiveFailures).toBe(1);

    primary.getQuotes.mockResolvedValue([]); // healthy upstream, unknown symbol
    expect(await service.getQuotes(['NOPE.NS'])).toEqual([]);
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'live',
      consecutiveFailures: 0,
    });
  });

  it('success resets the counter so isolated blips never trip the threshold', async () => {
    const { service, primary } = setup({ failureThreshold: 2 });
    primary.getQuotes.mockRejectedValue(namedError('TypeError'));
    await service.getQuotes(['A.NS']); // count 1
    primary.getQuotes.mockResolvedValue([makeQuote()]);
    await service.getQuotes(['B.NS']); // success -> count 0
    primary.getQuotes.mockRejectedValue(namedError('TypeError'));
    await service.getQuotes(['C.NS']); // count 1 again, NOT 2
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'live',
      consecutiveFailures: 1,
    });
  });
});

describe('MarketService batching and single-flight', () => {
  it('splits large requests into batches of batchSize', async () => {
    const { service, primary } = setup({ batchSize: 20 });
    primary.getQuotes.mockResolvedValue([]);
    const symbols = Array.from({ length: 45 }, (_, i) => `STOCK${i}.NS`);

    await service.getQuotes(symbols);
    expect(primary.getQuotes).toHaveBeenCalledTimes(3);
    expect(primary.getQuotes.mock.calls.map((call) => call[0].length)).toEqual([20, 20, 5]);
  });

  it('dedupes and normalises requested symbols before fetching', async () => {
    const { service, primary } = setup();
    primary.getQuotes.mockResolvedValue([makeQuote()]);

    await service.getQuotes(['reliance.ns', 'RELIANCE.NS', ' RELIANCE.NS ']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1);
    expect(primary.getQuotes.mock.calls[0]![0]).toEqual(['RELIANCE.NS']);
  });

  it('shares one upstream call between concurrent identical requests', async () => {
    const { service, primary } = setup();
    let release: ((quotes: Quote[]) => void) | undefined;
    primary.getQuotes.mockImplementationOnce(
      () => new Promise<Quote[]>((resolve) => (release = resolve)),
    );

    const p1 = service.getQuotes(['RELIANCE.NS']);
    const p2 = service.getQuotes(['RELIANCE.NS']);
    release!([makeQuote()]);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(primary.getQuotes).toHaveBeenCalledTimes(1);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });
});

describe('MarketService.searchInstruments', () => {
  it('passes through a healthy upstream search', async () => {
    const { service, primary } = setup();
    const expected = [
      {
        symbol: 'RELIANCE',
        exchange: 'NSE' as const,
        yahooSymbol: 'RELIANCE.NS',
        name: 'Reliance',
      },
    ];
    primary.searchInstruments.mockResolvedValue(expected);

    expect(await service.searchInstruments('reli')).toEqual(expected);
  });

  it('falls back to simulated search on upstream failure and counts it', async () => {
    const { service, primary, fallback } = setup();
    primary.searchInstruments.mockRejectedValue(namedError('TypeError'));
    fallback.searchInstruments.mockResolvedValue([
      { symbol: 'RELIANCE', exchange: 'NSE' as const, yahooSymbol: 'RELIANCE.NS', name: 'Sim' },
    ]);

    const results = await service.searchInstruments('reli');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Sim');
    expect(service.getProviderStatus().consecutiveFailures).toBe(1);
  });

  it('returns [] for badRequest search without counting it', async () => {
    const { service, primary, warn } = setup();
    primary.searchInstruments.mockRejectedValue(namedError('BadRequestError'));

    expect(await service.searchInstruments('')).toEqual([]);
    expect(service.getProviderStatus().consecutiveFailures).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad request'));
  });
});

describe('MarketService.getProviderStatus', () => {
  it('starts in live mode with a parseable since timestamp', () => {
    const { service } = setup();
    const status = service.getProviderStatus();
    expect(status.mode).toBe('live');
    expect(status.consecutiveFailures).toBe(0);
    expect(Number.isNaN(Date.parse(status.since))).toBe(false);
  });
});

describe('MarketService per-chunk deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts at the deadline, classifies TIMEOUT, and never retries afterwards', async () => {
    vi.useFakeTimers();
    const { service, primary, fallback } = setup({
      maxAttempts: 5, // deliberately high: the deadline, not maxAttempts, stops us
      failureThreshold: 5,
      deadlineMs: 10_000,
    });
    let abortedAtDeadline = false;
    primary.getQuotes.mockImplementation(
      (_symbols, options) =>
        new Promise<Quote[]>((_resolve, reject) => {
          if (!options?.signal) {
            reject(new Error('provider received no signal'));
            return;
          }
          options.signal.addEventListener(
            'abort',
            () => {
              abortedAtDeadline = options.signal!.aborted;
              reject(namedError('AbortError'));
            },
            { once: true },
          );
        }),
    );

    const promise = service.getQuotes(['RELIANCE.NS']);
    await vi.advanceTimersByTimeAsync(10_000);
    const quotes = await promise;

    expect(abortedAtDeadline).toBe(true); // the provider saw signal.aborted
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // one attempt, five allowed
    // Deadline expiry in live mode must NOT substitute simulated data:
    // nothing is returned and nothing is cached.
    expect(quotes).toEqual([]);
    expect(fallback.getQuotes).not.toHaveBeenCalled();
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'live',
      consecutiveFailures: 1,
    });
  });

  it('keeps the previous cached quote when the deadline expires (stale beats simulated)', async () => {
    vi.useFakeTimers();
    const { service, primary, fallback, cache, clock } = setup({
      failureThreshold: 5,
      deadlineMs: 10_000,
      cacheTtlMs: 60_000,
    });
    clock.t = IN_HOURS_MS;
    // A REAL quote, already older than the TTL (so it is a miss and gets
    // refreshed) — this is what must survive a deadline expiry.
    cache.set(
      makeQuote({
        symbol: 'RELIANCE',
        pricePaise: 111_111,
        asOf: new Date(IN_HOURS_MS - 10 * 60_000).toISOString(),
      }),
    );
    primary.getQuotes.mockImplementation(
      (_symbols, options) =>
        new Promise<Quote[]>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(namedError('AbortError')), {
            once: true,
          });
        }),
    );

    const promise = service.getQuotes(['RELIANCE.NS']);
    await vi.advanceTimersByTimeAsync(10_000);
    const quotes = await promise;

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ pricePaise: 111_111, isSimulated: false });
    expect(fallback.getQuotes).not.toHaveBeenCalled();
    // Cache untouched: still the real (stale) quote, not a simulated one.
    expect(cache.get('RELIANCE', 'NSE')).toMatchObject({
      pricePaise: 111_111,
      isSimulated: false,
    });
  });

  it('getQuote: unavailable (not notFound) when the deadline expires with no cache', async () => {
    vi.useFakeTimers();
    const { service, primary } = setup({ failureThreshold: 5, deadlineMs: 10_000 });
    primary.getQuotes.mockImplementation(
      (_symbols, options) =>
        new Promise<Quote[]>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(namedError('AbortError')), {
            once: true,
          });
        }),
    );

    const promise = service.getQuote('RELIANCE.NS');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await promise).toEqual({ status: 'unavailable' });
  });

  it('getQuote: notFound when the provider answers with nothing', async () => {
    const { service, primary } = setup();
    primary.getQuotes.mockResolvedValue([]);
    expect(await service.getQuote('NOPE.NS')).toEqual({ status: 'notFound' });
  });

  it('refreshQuotes always hits upstream (poller ignores cache freshness)', async () => {
    const { service, primary, cache, clock } = setup({ cacheTtlMs: 120_000 });
    clock.t = IN_HOURS_MS;
    cache.set(makeQuote({ pricePaise: 111_111, asOf: new Date(clock.t).toISOString() }));
    primary.getQuotes.mockResolvedValue([
      makeQuote({ pricePaise: 222_222, asOf: new Date(clock.t).toISOString() }),
    ]);

    // getQuotes would serve the fresh cache row...
    expect((await service.getQuotes(['RELIANCE.NS']))[0]!.pricePaise).toBe(111_111);
    expect(primary.getQuotes).not.toHaveBeenCalled();

    // ...refreshQuotes (the poller path) refreshes anyway.
    const refreshed = await service.refreshQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1);
    expect(refreshed[0]!.pricePaise).toBe(222_222);
  });

  it('aborts a pending backoff sleep instead of waiting it out', async () => {
    vi.useFakeTimers();
    const { service, primary, fallback } = setup({
      maxAttempts: 3,
      backoffBaseMs: 30_000, // the sleep must not outlive the deadline
      deadlineMs: 2_000,
      failureThreshold: 5,
    });
    primary.getQuotes.mockRejectedValue(namedError('TypeError'));

    const promise = service.getQuotes(['RELIANCE.NS']);
    await vi.advanceTimersByTimeAsync(2_000); // deadline, not the 30s backoff
    const quotes = await promise;

    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // no second attempt after abort
    // Deadline expiry in live mode: no simulated substitution.
    expect(quotes).toEqual([]);
    expect(fallback.getQuotes).not.toHaveBeenCalled();
    expect(service.getProviderStatus().consecutiveFailures).toBe(1);
  });

  it('records ONE failure per exhausted chunk, not one per attempt', async () => {
    const { service, primary } = setup({ maxAttempts: 3, failureThreshold: 2 });
    primary.getQuotes.mockRejectedValue(namedError('TypeError'));

    await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(3); // three attempts…
    expect(service.getProviderStatus()).toMatchObject({
      mode: 'live', // …but one record, so 2 records need a second exhausted chunk
      consecutiveFailures: 1,
    });
  });

  it('serves remaining chunks from fallback once the threshold trips mid-request', async () => {
    const { service, primary, fallback } = setup({
      batchSize: 1,
      failureThreshold: 1,
      maxAttempts: 1,
    });
    primary.getQuotes.mockRejectedValue(namedError('TypeError'));

    const quotes = await service.getQuotes(['AAA.NS', 'BBB.NS', 'CCC.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // chunk 2+ never went upstream
    expect(fallback.getQuotes).toHaveBeenCalledTimes(3); // chunk 1..3 all served
    expect(quotes).toHaveLength(3);
    expect(quotes.every((quote) => quote.isSimulated)).toBe(true);
    expect(service.getProviderStatus().mode).toBe('fallback');
  });

  it('caps a MULTI-chunk request at one deadline, not one per chunk', async () => {
    vi.useFakeTimers();
    try {
      const { service, primary, fallback, cache, clock } = setup({
        batchSize: 1,
        failureThreshold: 10, // stay in live mode: the deadline is what stops us
        deadlineMs: 10_000,
      });
      clock.t = IN_HOURS_MS;
      // Stale-but-real rows for the two chunks the deadline will skip.
      cache.set(
        makeQuote({
          symbol: 'BBB',
          pricePaise: 22_222,
          asOf: new Date(IN_HOURS_MS - 10 * 60_000).toISOString(),
        }),
      );
      cache.set(
        makeQuote({
          symbol: 'CCC',
          pricePaise: 33_333,
          asOf: new Date(IN_HOURS_MS - 10 * 60_000).toISOString(),
        }),
      );
      primary.getQuotes.mockImplementation(
        (_symbols, options) =>
          new Promise<Quote[]>((_resolve, reject) => {
            if (!options?.signal) {
              reject(new Error('provider received no signal'));
              return;
            }
            options.signal.addEventListener('abort', () => reject(namedError('AbortError')), {
              once: true,
            });
          }),
      );

      const promise = service.getQuotes(['AAA.NS', 'BBB.NS', 'CCC.NS']);
      await vi.advanceTimersByTimeAsync(10_000); // one budget, not 3 x 10s
      const quotes = await promise;

      // Chunk 1 (AAA) hangs until the deadline with nothing cached: dropped.
      // Chunks 2 and 3 see the aborted signal and keep their stale real rows.
      expect(primary.getQuotes).toHaveBeenCalledTimes(1);
      expect(fallback.getQuotes).not.toHaveBeenCalled(); // no simulated substitution
      expect(quotes.map((q) => q.symbol)).toEqual(['BBB', 'CCC']);
      expect(quotes.every((q) => q.isSimulated === false)).toBe(true);
      // ONE record for the whole call, not one per skipped chunk.
      expect(service.getProviderStatus().consecutiveFailures).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// 2026-10-01 is a Thursday: 06:00Z = 11:30 IST, inside market hours.
const IN_HOURS_MS = Date.parse('2026-10-01T06:00:00.000Z');
// 2026-10-03 is a Saturday: market closed whatever the time of day.
const AFTER_HOURS_MS = Date.parse('2026-10-03T12:00:00.000Z');

describe('MarketService cache freshness window', () => {
  it('serves a cached quote inside the TTL and refetches past it (market hours)', async () => {
    const { service, primary, cache, clock } = setup({ cacheTtlMs: 120_000 });
    clock.t = IN_HOURS_MS;
    cache.set(makeQuote({ asOf: new Date(IN_HOURS_MS).toISOString(), pricePaise: 111_111 }));

    clock.t = IN_HOURS_MS + 119_000;
    expect(await service.getQuotes(['RELIANCE.NS'])).toHaveLength(1);
    expect(primary.getQuotes).not.toHaveBeenCalled(); // fresh

    clock.t = IN_HOURS_MS + 121_000;
    primary.getQuotes.mockResolvedValue([
      makeQuote({ pricePaise: 222_222, asOf: new Date(clock.t).toISOString() }),
    ]);
    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // stale -> refetched
    expect(quotes[0]!.pricePaise).toBe(222_222);
  });

  it('uses a fixed 30-minute window after hours so weekend lookups do not refetch', async () => {
    const { service, primary, cache, clock } = setup({ cacheTtlMs: 120_000 });
    clock.t = AFTER_HOURS_MS;
    cache.set(makeQuote({ asOf: new Date(AFTER_HOURS_MS).toISOString(), pricePaise: 111_111 }));

    clock.t = AFTER_HOURS_MS + 29 * 60_000;
    expect(await service.getQuotes(['RELIANCE.NS'])).toHaveLength(1);
    expect(primary.getQuotes).not.toHaveBeenCalled(); // 29min < 30min window

    clock.t = AFTER_HOURS_MS + 31 * 60_000;
    primary.getQuotes.mockResolvedValue([
      makeQuote({ pricePaise: 222_222, asOf: new Date(clock.t).toISOString() }),
    ]);
    await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // past 30min -> refetched
  });

  it('refetches a 29-minute-old row during market hours (contrast with after hours)', async () => {
    const { service, primary, cache, clock } = setup({ cacheTtlMs: 120_000 });
    clock.t = IN_HOURS_MS;
    cache.set(makeQuote({ asOf: new Date(IN_HOURS_MS).toISOString(), pricePaise: 111_111 }));

    clock.t = IN_HOURS_MS + 29 * 60_000;
    primary.getQuotes.mockResolvedValue([
      makeQuote({ pricePaise: 222_222, asOf: new Date(clock.t).toISOString() }),
    ]);
    await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1); // 29min > 120s TTL
  });

  it('ignores an unparseable asOf and refetches', async () => {
    const { service, primary, cache, clock } = setup({ cacheTtlMs: 120_000 });
    clock.t = IN_HOURS_MS;
    cache.set(makeQuote({ asOf: 'not-a-timestamp' }));

    primary.getQuotes.mockResolvedValue([makeQuote({ asOf: new Date(clock.t).toISOString() })]);
    await service.getQuotes(['RELIANCE.NS']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1);
  });
});

describe('MarketService search cache', () => {
  const result = {
    symbol: 'RELIANCE',
    exchange: 'NSE' as const,
    yahooSymbol: 'RELIANCE.NS',
    name: 'Reliance Industries Limited',
  };

  it('caches successful non-empty results for 60s under a normalized key', async () => {
    const { service, primary, clock } = setup();
    primary.searchInstruments.mockResolvedValue([result]);

    await service.searchInstruments('reliance');
    await service.searchInstruments('  RELIANCE  '); // same normalized key
    expect(primary.searchInstruments).toHaveBeenCalledTimes(1);

    clock.t += 61_000;
    await service.searchInstruments('reliance');
    expect(primary.searchInstruments).toHaveBeenCalledTimes(2); // TTL expired
  });

  it('does not cache empty results', async () => {
    const { service, primary } = setup();
    primary.searchInstruments.mockResolvedValue([]);

    expect(await service.searchInstruments('reliance')).toEqual([]);
    expect(await service.searchInstruments('reliance')).toEqual([]);
    expect(primary.searchInstruments).toHaveBeenCalledTimes(2);
  });

  it('does not cache fallback results from a failed search', async () => {
    const { service, primary, fallback } = setup();
    primary.searchInstruments.mockRejectedValue(namedError('TypeError'));
    fallback.searchInstruments.mockResolvedValue([{ ...result, name: 'Simulated' }]);

    const first = await service.searchInstruments('reliance');
    expect(first[0]!.name).toBe('Simulated');

    primary.searchInstruments.mockResolvedValue([result]);
    await service.searchInstruments('reliance');
    expect(primary.searchInstruments).toHaveBeenCalledTimes(2); // nothing was cached

    await service.searchInstruments('reliance');
    expect(primary.searchInstruments).toHaveBeenCalledTimes(2); // now cached
  });

  it('evicts the oldest entry beyond 100 cached queries', async () => {
    const { service, primary } = setup();
    primary.searchInstruments.mockImplementation(async (query: string) => [
      { ...result, symbol: query.toUpperCase(), yahooSymbol: `${query.toUpperCase()}.NS` },
    ]);

    for (let i = 0; i < 101; i++) await service.searchInstruments(`q${i}`);
    expect(primary.searchInstruments).toHaveBeenCalledTimes(101);

    await service.searchInstruments('q0'); // oldest was evicted
    expect(primary.searchInstruments).toHaveBeenCalledTimes(102);
    await service.searchInstruments('q100'); // newest still cached
    expect(primary.searchInstruments).toHaveBeenCalledTimes(102);
  });
});
