// Market-data domain types. Prices are integer paise everywhere (SPEC §4).
// These types are the contract between providers (Simulated, Yahoo),
// the price cache, the poller, and the HTTP layer (Checkpoints 3–4).

/** Indian exchanges we support. Maps to Yahoo suffixes: NSE -> .NS, BSE -> .BO. */
export type Exchange = 'NSE' | 'BSE';

/**
 * A quote as this app sees it — already in paise, never rupee floats.
 *
 * `asOf` and `marketTime` answer different questions:
 * - `asOf`: when *our server* fetched/produced this quote. Staleness checks
 *   (MAX_PRICE_AGE_SECONDS, order rejection) use this.
 * - `marketTime`: when the exchange last traded (`regularMarketTime`).
 *   Informational; may be days old over weekends/holidays.
 */
export interface Quote {
  /** Bare symbol, e.g. 'RELIANCE' (no exchange suffix). */
  symbol: string;
  exchange: Exchange;
  pricePaise: number;
  prevClosePaise: number;
  /** pricePaise - prevClosePaise; can be negative. Integer paise. */
  changePaise: number;
  /** Day change in percent, 2 decimals (e.g. -1.63). Not money.
   *  ALWAYS computed from the integer paise values via changePercentFromPaise
   *  (previous close 0 guarded) — never copied from an upstream float — so
   *  changePaise and changePercent can never disagree. */
  changePercent: number;
  /** ISO timestamp: when our server produced this quote (staleness clock). */
  asOf: string;
  /** ISO timestamp: exchange's last trade time (Yahoo `regularMarketTime`). */
  marketTime: string;
  /** Quote delay in minutes (Yahoo `exchangeDataDelayedBy`), when known. */
  delayMinutes?: number;
  /** True when served by SimulatedProvider (fallback/dev). UI shows a badge. */
  isSimulated: boolean;
}

/** A candidate instrument from search, ready to become an Instrument row (Slice 3). */
export interface InstrumentSearchResult {
  /** Bare symbol, e.g. 'RELIANCE'. */
  symbol: string;
  exchange: Exchange;
  /** Yahoo symbol, e.g. 'RELIANCE.NS'. */
  yahooSymbol: string;
  name: string;
}

/**
 * Per-call controls for a provider fetch. MarketService passes a signal that
 * aborts at its per-chunk deadline; a provider that talks to the network
 * MUST stop early when the signal aborts (SimulatedProvider ignores it — it
 * resolves instantly and has nothing to cancel).
 */
export interface ProviderFetchOptions {
  signal?: AbortSignal;
}

/**
 * The provider contract (SPEC §6, trimmed to this slice: no getHistory until
 * Slice 5). Unknown/missing symbols are ABSENT from the returned array —
 * they must not throw. A "not found" is a normal answer, not a failure.
 */
export interface MarketDataProvider {
  getQuotes(yahooSymbols: string[], options?: ProviderFetchOptions): Promise<Quote[]>;
  searchInstruments(query: string): Promise<InstrumentSearchResult[]>;
}

/**
 * Why a provider call failed. Every kind here counts toward the failure
 * counter (added in Checkpoint 3): timeouts, network errors, HTTP errors,
 * validation failures (our Zod parse or the library's
 * FailedYahooValidationError), and anything unrecognized.
 */
export type ProviderErrorKind = 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'VALIDATION' | 'UNKNOWN';

/**
 * Outcome of a single provider operation. The failure counter (Checkpoint 3)
 * must count ONLY `status: 'error'`:
 *
 * - `ok`         — value delivered.
 * - `notFound`   — normal answer for a missing/bad symbol. NEVER a failure.
 * - `badRequest` — upstream rejected our request as malformed (Yahoo
 *                  BadRequestError). Bad input, not an outage. NOT a failure.
 * - `error`      — upstream trouble; counts toward the failure counter.
 */
export type ProviderOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'notFound' }
  | { status: 'badRequest'; message: string }
  | { status: 'error'; kind: ProviderErrorKind; message: string };
