import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Quote } from './types';

// The Yahoo wiring is mocked: even the 'yahoo' branch test never loads the
// real library path (and never hits the network).
const yahooCtor = vi.hoisted(() => vi.fn());
vi.mock('./yahoo-provider', () => ({
  YahooProvider: class MockYahooProvider {
    constructor(...args: unknown[]) {
      yahooCtor(...args);
    }
  },
}));

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'RELIANCE',
    exchange: 'NSE',
    pricePaise: 116770,
    prevClosePaise: 118700,
    changePaise: 0,
    changePercent: 0,
    asOf: '2026-10-03T08:00:00.000Z',
    marketTime: '2026-10-03T08:00:00.000Z',
    isSimulated: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules(); // re-import so config/env re-reads process.env
  yahooCtor.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createMarketService', () => {
  it('wires the simulated provider when MARKET_PROVIDER=simulated (test default)', async () => {
    const { createMarketService } = await import('./create-market-service');
    const service = createMarketService();

    expect(yahooCtor).not.toHaveBeenCalled();
    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(quotes[0]).toMatchObject({
      symbol: 'RELIANCE',
      pricePaise: 116770, // simulated table price
      isSimulated: true,
    });
    expect(service.getProviderStatus()).toMatchObject({ mode: 'live' });
  });

  it('wires the Yahoo provider when MARKET_PROVIDER=yahoo', async () => {
    vi.stubEnv('MARKET_PROVIDER', 'yahoo');
    const { createMarketService } = await import('./create-market-service');

    createMarketService();
    expect(yahooCtor).toHaveBeenCalledTimes(1);
  });

  it('seeds simulated fallback prices from the cache (last known price wins)', async () => {
    const { createMarketService } = await import('./create-market-service');
    const { InMemoryPriceCache } = await import('./price-cache');
    const cache = new InMemoryPriceCache();
    // A simulated (stale) cache row: unusable while live, so the simulated
    // provider must fetch — and should seed from this price, not the table.
    cache.set(makeQuote({ pricePaise: 99999, isSimulated: true }));

    const service = createMarketService(cache);
    const quotes = await service.getQuotes(['RELIANCE.NS']);
    expect(quotes[0]).toMatchObject({ pricePaise: 99999, isSimulated: true });
    expect(yahooCtor).not.toHaveBeenCalled();
  });

  it('works without passing a cache (in-memory default)', async () => {
    const { createMarketService } = await import('./create-market-service');
    const service = createMarketService();

    const quotes = await service.getQuotes(['INFY.NS']);
    expect(quotes[0]).toMatchObject({ symbol: 'INFY', isSimulated: true });
  });
});
