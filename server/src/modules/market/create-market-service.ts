// Composition root for the market stack: picks the provider from
// MARKET_PROVIDER (SPEC §6) and wires the price cache into the simulated
// provider so fallback quotes are seeded from the LAST REAL price whenever
// one was ever fetched (never from a stale table when real data exists).

import { env } from '../../config/env';
import { InMemoryPriceCache, type PriceCache } from './price-cache';
import { MarketService, type MarketServiceOptions } from './market-service';
import { SimulatedProvider } from './simulated-provider';
import { YahooProvider } from './yahoo-provider';
import { fromYahooSymbol } from './symbol-map';

/** Overrides for tests; production uses the defaults. */
export type CreateMarketServiceOverrides = Partial<
  Omit<MarketServiceOptions, 'provider' | 'fallback' | 'cache'>
>;

/**
 * Seed lookup for SimulatedProvider: cache FIRST (last real price), then the
 * provider's hardcoded table (CP2 behaviour). SimulatedProvider passes the
 * BARE symbol ('RELIANCE'), so a bare input is checked on both exchanges
 * (NSE first); a suffixed input ('RELIANCE.NS') is checked on its exchange.
 */
function makeCachePriceLookup(cache: PriceCache): (symbol: string) => number | null {
  return (symbol) => {
    const mapped = fromYahooSymbol(symbol);
    if (mapped) return cache.get(mapped.symbol, mapped.exchange)?.pricePaise ?? null;
    return cache.get(symbol, 'NSE')?.pricePaise ?? cache.get(symbol, 'BSE')?.pricePaise ?? null;
  };
}

export function createMarketService(
  cache: PriceCache = new InMemoryPriceCache(),
  overrides: CreateMarketServiceOverrides = {},
): MarketService {
  const seedFromCache = makeCachePriceLookup(cache);
  const simulated = new SimulatedProvider({ getLastKnownPricePaise: seedFromCache });
  const fromEnv = {
    // Cache freshness in market hours; env validates it is >= 2x the poll
    // interval so a poller tick keeps rows fresh.
    cacheTtlMs: env.MARKET_CACHE_TTL_SECONDS * 1000,
  };

  if (env.MARKET_PROVIDER === 'simulated') {
    return new MarketService({
      provider: simulated,
      fallback: simulated,
      cache,
      ...fromEnv,
      ...overrides,
    });
  }

  return new MarketService({
    provider: new YahooProvider(),
    fallback: simulated,
    cache,
    ...fromEnv,
    ...overrides,
  });
}
