// MarketQueryService — the business layer behind the /api/market routes
// (thin routes -> this service -> MarketService/cache; no Prisma here).
//
// Quote lookup rules (Checkpoint 4):
// - the symbol must map via toYahooSymbol; unparseable/unknown symbols are a
//   404, never a 500,
// - the answer comes from MarketService (cache hit, or a fetch through the
//   normal resilience path: retries, failure counter, simulated fallback),
// - a symbol enters the poller's tracked set ONLY after a quote for it was
//   actually found. Unknown symbols are never tracked, so the tracked set
//   cannot be filled with junk by anonymous-style abuse.

import { NotFoundError } from '../../lib/errors';
import type { MarketService } from './market-service';
import type { TrackedSymbols } from './tracked-symbols';
import { toYahooSymbol } from './symbol-map';
import type { Exchange, InstrumentSearchResult, Quote } from './types';

export interface MarketQueryServiceDeps {
  service: MarketService;
  trackedSymbols: TrackedSymbols;
}

export class MarketQueryService {
  private readonly service: MarketService;
  private readonly trackedSymbols: TrackedSymbols;

  constructor(deps: MarketQueryServiceDeps) {
    this.service = deps.service;
    this.trackedSymbols = deps.trackedSymbols;
  }

  async getQuote(symbol: string, exchange: Exchange): Promise<Quote> {
    const yahooSymbol = toYahooSymbol(symbol, exchange);
    if (!yahooSymbol) throw new NotFoundError('Unknown symbol');

    const quotes = await this.service.getQuotes([yahooSymbol]);
    const quote = quotes.find((candidate) => candidate.symbol === symbol.toUpperCase());
    if (!quote) throw new NotFoundError('Unknown symbol');

    // Only now — a quote really exists — is the symbol worth polling.
    this.trackedSymbols.add(symbol, exchange);
    return quote;
  }

  search(query: string): Promise<InstrumentSearchResult[]> {
    return this.service.searchInstruments(query);
  }
}
