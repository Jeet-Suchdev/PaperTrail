// SimulatedProvider — random-walk quotes around hardcoded base prices.
// Used for tests, offline dev, and (from Checkpoint 3) as the fallback when
// Yahoo keeps failing. Everything injectable so tests are deterministic:
// a seedable RNG, a clock, and an optional last-known-price lookup.
//
// Behaviour mirrors a real provider: unknown symbols are simply ABSENT from
// the result array (NOT_FOUND), never an exception.

import { rupeesToPaise } from '../../lib/money';
import { changePercentFromPaise } from './change-percent';
import { fromYahooSymbol, toYahooSymbol } from './symbol-map';
import type {
  InstrumentSearchResult,
  MarketDataProvider,
  ProviderFetchOptions,
  Quote,
} from './types';

interface SimulatedInstrument {
  name: string;
  priceRupees: number;
}

// APPROXIMATE prices — dev/fallback reference ONLY, never market data.
// RELIANCE/TCS are close to what live Yahoo returned in Checkpoint 1; the
// rest are round-number stand-ins. The real source is YahooProvider.
const SIMULATED_INSTRUMENTS: Readonly<Record<string, SimulatedInstrument>> = {
  RELIANCE: { name: 'Reliance Industries Limited', priceRupees: 1167.7 },
  TCS: { name: 'Tata Consultancy Services Limited', priceRupees: 2079.3 },
  INFY: { name: 'Infosys Limited', priceRupees: 1450 },
  HDFCBANK: { name: 'HDFC Bank Limited', priceRupees: 985 },
  ICICIBANK: { name: 'ICICI Bank Limited', priceRupees: 1290 },
  SBIN: { name: 'State Bank of India', priceRupees: 415 },
  ITC: { name: 'ITC Limited', priceRupees: 415 },
  BHARTIARTL: { name: 'Bharti Airtel Limited', priceRupees: 1950 },
  LT: { name: 'Larsen & Toubro Limited', priceRupees: 3600 },
  HINDUNILVR: { name: 'Hindustan Unilever Limited', priceRupees: 2380 },
  'BAJAJ-AUTO': { name: 'Bajaj Auto Limited', priceRupees: 8600 },
  MARUTI: { name: 'Maruti Suzuki India Limited', priceRupees: 15200 },
  ASIANPAINT: { name: 'Asian Paints Limited', priceRupees: 2480 },
  TATAMOTORS: { name: 'Tata Motors Limited', priceRupees: 690 },
  'M&M': { name: 'Mahindra & Mahindra Limited', priceRupees: 3250 },
};

/** Max drift per tick: ±0.4% of the current price. */
const MAX_STEP_FRACTION = 0.004;

/**
 * Deterministic PRNG (mulberry32). Same seed -> same sequence, so tests can
 * assert exact prices. Not cryptographic — only for price simulation.
 */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulatedProviderOptions {
  /** Random source; defaults to Math.random. Use createSeededRng(seed) in tests. */
  rng?: () => number;
  /** Clock; defaults to the real clock. Inject a fixed date in tests. */
  now?: () => Date;
  /**
   * Optional last-known price in paise (the price cache, from Checkpoint 3).
   * Called ONCE per symbol, when it is first seen; a valid value wins over
   * the hardcoded table. Anything non-positive/non-finite falls back to the
   * table; an unknown symbol with no table entry is NOT_FOUND.
   */
  getLastKnownPricePaise?: (symbol: string) => number | null | undefined;
}

export class SimulatedProvider implements MarketDataProvider {
  private readonly rng: () => number;
  private readonly now: () => Date;
  private readonly getLastKnownPricePaise?: (symbol: string) => number | null | undefined;
  /** Canonical Yahoo symbol -> current walk position, in paise. */
  private readonly currentPriceBySymbol = new Map<string, number>();
  /** Canonical Yahoo symbol -> seed-time price (= prev close), in paise. */
  private readonly prevCloseBySymbol = new Map<string, number>();

  constructor(options: SimulatedProviderOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.getLastKnownPricePaise = options.getLastKnownPricePaise;
  }

  // No network and nothing to cancel: the deadline signal is ignored here.
  async getQuotes(yahooSymbols: string[], _options: ProviderFetchOptions = {}): Promise<Quote[]> {
    const quotes: Quote[] = [];
    for (const yahooSymbol of yahooSymbols) {
      const quote = this.buildQuote(yahooSymbol);
      if (quote) quotes.push(quote);
    }
    return quotes;
  }

  async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    const needle = query.trim().toUpperCase();
    if (!needle) return [];
    const results: InstrumentSearchResult[] = [];
    for (const [symbol, instrument] of Object.entries(SIMULATED_INSTRUMENTS)) {
      if (!symbol.includes(needle) && !instrument.name.toUpperCase().includes(needle)) continue;
      const yahooSymbol = toYahooSymbol(symbol, 'NSE');
      if (!yahooSymbol) continue; // table keys are valid by construction; defensive
      results.push({ symbol, exchange: 'NSE', yahooSymbol, name: instrument.name });
      if (results.length >= 10) break; // parity with Yahoo's quotesCount cap
    }
    return results;
  }

  private buildQuote(rawYahooSymbol: string): Quote | null {
    const parsed = fromYahooSymbol(rawYahooSymbol);
    if (!parsed) return null;
    const yahooSymbol = toYahooSymbol(parsed.symbol, parsed.exchange);
    if (!yahooSymbol) return null;

    const existing = this.currentPriceBySymbol.get(yahooSymbol);
    let pricePaise: number;
    if (existing === undefined) {
      const seeded = this.seedPrice(parsed.symbol);
      if (seeded === null) return null; // unknown symbol -> NOT_FOUND
      pricePaise = seeded;
      // First sighting returns the seed unchanged; the walk starts next fetch.
      this.currentPriceBySymbol.set(yahooSymbol, pricePaise);
      this.prevCloseBySymbol.set(yahooSymbol, pricePaise);
    } else {
      const drift = (this.rng() * 2 - 1) * MAX_STEP_FRACTION; // ±0.4%
      pricePaise = Math.max(1, Math.round(existing * (1 + drift)));
      this.currentPriceBySymbol.set(yahooSymbol, pricePaise);
    }

    const prevClosePaise = this.prevCloseBySymbol.get(yahooSymbol) ?? pricePaise;
    const changePaise = pricePaise - prevClosePaise; // integer math; can be negative
    const changePercent = changePercentFromPaise(changePaise, prevClosePaise);
    // Simulated data has no exchange timestamp: asOf doubles as marketTime.
    const asOf = this.now().toISOString();

    return {
      symbol: parsed.symbol,
      exchange: parsed.exchange,
      pricePaise,
      prevClosePaise,
      changePaise,
      changePercent,
      asOf,
      marketTime: asOf,
      isSimulated: true,
    };
  }

  /** Seed price in paise: injected last-known price, else table, else null. */
  private seedPrice(symbol: string): number | null {
    const injected = this.getLastKnownPricePaise?.(symbol);
    if (typeof injected === 'number' && Number.isFinite(injected) && injected > 0) {
      return Math.round(injected); // cache promises paise; round defensively
    }
    const instrument = SIMULATED_INSTRUMENTS[symbol];
    return instrument ? rupeesToPaise(instrument.priceRupees) : null;
  }
}
