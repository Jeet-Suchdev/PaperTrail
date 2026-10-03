import { describe, expect, it, vi } from 'vitest';

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
    expect(primary.getQuotes).toHaveBeenCalledWith(['RELIANCE.NS']);
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
