// In-memory price cache behind an interface so Redis could replace it later
// without touching MarketService. Keyed by symbol + exchange (the same bare
// symbol can list on both). Stores the whole Quote — including `asOf`, the
// staleness signal that order execution (Slice 3+) will check.

import type { Exchange, Quote } from './types';

export interface PriceCache {
  get(symbol: string, exchange: Exchange): Quote | undefined;
  set(quote: Quote): void;
}

export class InMemoryPriceCache implements PriceCache {
  private readonly entries = new Map<string, Quote>();

  private static key(symbol: string, exchange: Exchange): string {
    return `${exchange}:${symbol}`;
  }

  get(symbol: string, exchange: Exchange): Quote | undefined {
    return this.entries.get(InMemoryPriceCache.key(symbol, exchange));
  }

  set(quote: Quote): void {
    this.entries.set(InMemoryPriceCache.key(quote.symbol, quote.exchange), quote);
  }
}
