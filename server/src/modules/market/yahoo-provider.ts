// YahooProvider — the ONLY module in the app that imports yahoo-finance2
// (SPEC §6 boundary). It converts upstream rupee floats to integer paise
// exactly once, here, and emits domain Quotes (types.ts).
//
// Resilience shape (Checkpoint 3):
// - Timeout: per-request AbortController wired through the library's
//   documented `fetch` constructor option — this genuinely cancels the
//   request. (The library's queue `timeout` option is a no-op: the queue
//   assigns it to a property nothing reads.)
// - Retries, failure counting, and fallback live in MarketService, not here.
//   This class throws; the service classifies via classifyProviderError.
// - Validation: our OWN per-item Zod parse, with the library's whole-batch
//   validation disabled (validateResult: false) so one malformed item can
//   never poison the rest of the batch. A batch where EVERY item fails does
//   throw (MarketValidationError) — that is outage-shaped.
// - Logs: symbols, counts, error NAMES only — never raw upstream payloads
//   (FailedYahooValidationError messages embed the raw result).

import YahooFinance from 'yahoo-finance2';

import { rupeesToPaise } from '../../lib/money';
import { changePercentFromPaise } from './change-percent';
import { createConsoleMarketLogger, type MarketLogger } from './market-logger';
import { MarketValidationError } from './provider-errors';
import { fromYahooSymbol, toYahooSymbol } from './symbol-map';
import type { InstrumentSearchResult, MarketDataProvider, Quote } from './types';
import { yahooQuoteSchema, yahooSearchItemSchema, type YahooQuotePayload } from './yahoo.schemas';

const DEFAULT_TIMEOUT_MS = 5_000;
const SEARCH_QUOTES_COUNT = 10;

/** The default export is a value (factory/class), not usable as a type. */
type YahooFinanceClient = InstanceType<typeof YahooFinance>;

/**
 * Fetch wrapper enforcing a hard per-request timeout by aborting via
 * AbortController (the upstream request is really cancelled). Forwards any
 * signal the caller (library) already attached, so its own cancellations
 * still work.
 */
export function createTimeoutFetch(timeoutMs: number, upstream: typeof fetch): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const external = init?.signal ?? null;
    const forwardAbort = () => controller.abort();
    if (external) {
      if (external.aborted) forwardAbort();
      else external.addEventListener('abort', forwardAbort, { once: true });
    }
    try {
      return await upstream(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', forwardAbort);
    }
  };
}

export interface YahooProviderOptions {
  /** Per-request timeout in ms (default 5000). */
  timeoutMs?: number;
  logger?: MarketLogger;
  /** Clock for asOf; injectable for deterministic tests. */
  now?: () => Date;
  /** Test seam: upstream fetch (also wrapped by the timeout layer). */
  fetch?: typeof fetch;
}

export class YahooProvider implements MarketDataProvider {
  private readonly client: YahooFinanceClient;
  private readonly logger: MarketLogger;
  private readonly now: () => Date;

  constructor(options: YahooProviderOptions = {}) {
    this.logger = options.logger ?? createConsoleMarketLogger();
    this.now = options.now ?? (() => new Date());
    const upstream: typeof fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.client = new YahooFinance({
      // Stop the interactive prompt the library prints about its survey —
      // servers must not print prompts.
      suppressNotices: ['yahooSurvey'],
      fetch: createTimeoutFetch(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, upstream),
    });
  }

  async getQuotes(yahooSymbols: string[]): Promise<Quote[]> {
    const requested = [
      ...new Set(
        yahooSymbols
          .map((symbol) => symbol.trim().toUpperCase())
          .filter((symbol) => symbol.length > 0),
      ),
    ];
    if (requested.length === 0) return [];

    const raw = await this.client.quote(requested, {}, { validateResult: false });
    const rawQuotes: unknown[] = Array.isArray(raw) ? raw : [];
    // Yahoo silently skips symbols it doesn't know: an empty answer is a
    // normal NOT_FOUND, not a failure.
    if (rawQuotes.length === 0) return [];

    const asOf = this.now().toISOString();
    const quotes: Quote[] = [];
    for (const item of rawQuotes) {
      const label = symbolLabel(item);
      const parsed = yahooQuoteSchema.safeParse(item);
      if (!parsed.success) {
        // Parse issues are NOT logged — they contain raw payload values.
        this.logger.warn(`dropped malformed quote for ${label}`);
        continue;
      }
      const quote = this.toQuote(parsed.data, asOf);
      if (!quote) {
        this.logger.warn(`dropped unmappable quote for ${label}`);
        continue;
      }
      quotes.push(quote);
    }

    if (quotes.length === 0) {
      // Every item failed our parse: outage-shaped, the service will count it.
      throw new MarketValidationError(`${rawQuotes.length} quote(s) yielded no usable data`);
    }
    return quotes;
  }

  async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const raw = await this.client.search(
      trimmed,
      { quotesCount: SEARCH_QUOTES_COUNT, newsCount: 0 },
      { validateResult: false },
    );
    const results: InstrumentSearchResult[] = [];
    for (const item of extractSearchItems(raw)) {
      const parsed = yahooSearchItemSchema.safeParse(item);
      // Non-Yahoo rows (no symbol / isYahooFinance false) are normal noise.
      if (!parsed.success) continue;
      const data = parsed.data;
      if (data.quoteType !== 'EQUITY') continue; // indices, funds, crypto...
      if (data.exchange !== 'NSI' && data.exchange !== 'BSE') continue; // India only
      const mapped = fromYahooSymbol(data.symbol);
      if (!mapped) continue;
      const yahooSymbol = toYahooSymbol(mapped.symbol, mapped.exchange);
      if (!yahooSymbol) continue; // by-construction impossible; defensive
      results.push({
        symbol: mapped.symbol,
        exchange: mapped.exchange,
        yahooSymbol,
        name: data.longname ?? data.shortname ?? mapped.symbol,
      });
    }
    return results;
  }

  /** Upstream rupees -> domain paise. Throws (loudly) on impossible values. */
  private toQuote(payload: YahooQuotePayload, asOf: string): Quote | null {
    const mapped = fromYahooSymbol(payload.symbol);
    if (!mapped) return null;
    const pricePaise = rupeesToPaise(payload.regularMarketPrice);
    const prevClosePaise = rupeesToPaise(payload.regularMarketPreviousClose);
    const changePaise = pricePaise - prevClosePaise;
    return {
      symbol: mapped.symbol,
      exchange: mapped.exchange,
      pricePaise,
      prevClosePaise,
      changePaise,
      changePercent: changePercentFromPaise(changePaise, prevClosePaise),
      asOf,
      marketTime: payload.regularMarketTime.toISOString(),
      delayMinutes: payload.exchangeDataDelayedBy,
      isSimulated: false,
    };
  }
}

/** Symbol for a log line — the only payload piece that is ever logged. */
function symbolLabel(item: unknown): string {
  if (item !== null && typeof item === 'object' && 'symbol' in item) {
    const { symbol } = item as { symbol: unknown };
    if (typeof symbol === 'string' && symbol.length > 0) return symbol;
  }
  return '(unknown symbol)';
}

/** Guard: search results are untrusted until we see a `quotes` array. */
function extractSearchItems(raw: unknown): unknown[] {
  if (raw !== null && typeof raw === 'object' && 'quotes' in raw) {
    const { quotes } = raw as { quotes: unknown };
    if (Array.isArray(quotes)) return quotes;
  }
  return [];
}
