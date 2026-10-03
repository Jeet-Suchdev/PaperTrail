// MarketService — sits above any MarketDataProvider and adds everything the
// app needs to never crash and never stall because of upstream trouble
// (SPEC §6, Checkpoint 3):
//
// - one-at-a-time single-flight per symbol batch (concurrent callers share
//   one upstream call),
// - batching (at most `batchSize` symbols per provider call), with a mode
//   check between chunks: once the failure threshold trips mid-request, the
//   remaining chunks go straight to the fallback without touching upstream,
// - a HARD per-chunk deadline (default 10s) carried on an AbortSignal that
//   reaches the provider's HTTP requests, plus retry with exponential backoff
//   that only continues while budget remains (sleeps are abortable),
// - a consecutive-failure counter. ONE record per exhausted chunk call —
//   never per attempt, never per skipped chunk — so N records means N
//   consecutive upstream calls gave up after their retries, not N attempts,
// - fallback mode for `cooldownMs` after `failureThreshold` records, one
//   probe when the cooldown ends, and a return to `live` on the first
//   healthy probe,
// - a read-through price cache with a freshness window: in market hours the
//   configured TTL (>= 2x the poll interval), outside them a fixed 30-minute
//   window so weekend/after-hours lookups are not refetched every poll tick,
// - a 60s search-result cache (normalized query key, max 100 entries) that
//   stores only successful, non-empty, live-provider results.
//
// Mode transitions are logged EXACTLY ONCE (at the transition), never per
// request. Error messages from upstream are classified and dropped — only
// error KINDS are kept, and raw payloads never reach the logs.

import { classifyProviderError } from './provider-errors';
import { createConsoleMarketLogger, type MarketLogger } from './market-logger';
import { isMarketOpen } from './market-hours';
import type { PriceCache } from './price-cache';
import { fromYahooSymbol } from './symbol-map';
import type {
  InstrumentSearchResult,
  MarketDataProvider,
  ProviderErrorKind,
  ProviderFetchOptions,
  Quote,
} from './types';

/** Result of one attempt against the primary provider. */
type ChunkResult =
  | { status: 'ok'; quotes: Quote[] }
  | { status: 'empty' }
  | { status: 'badRequest' }
  | { status: 'deadline' }
  | { status: 'error'; kind: ProviderErrorKind };

/**
 * What one chunk contributed to a call:
 * - quotes: real data from the provider,
 * - none: healthy upstream, symbol(s) genuinely unknown,
 * - simulated: a real outage (retries exhausted) — simulated data, flagged,
 * - deadline: the call budget expired. Deliberately NOT simulated: in live
 *   mode a budget expiry must not mix fake prices into live results, so the
 *   previous cached quote is kept (even if stale) and the refresh is left to
 *   the next poller tick.
 */
type ChunkOutcome =
  | { kind: 'quotes'; quotes: Quote[] }
  | { kind: 'none' }
  | { kind: 'simulated'; quotes: Quote[] }
  | { kind: 'deadline' };

/** Result of a single-symbol lookup (the HTTP quote path). */
export type QuoteLookup =
  | { status: 'ok'; quote: Quote }
  | { status: 'notFound' }
  /** Budget expired and no cached quote exists to fall back on. */
  | { status: 'unavailable' };

/**
 * Outside market hours (evenings, weekends, holidays — isMarketOpen is
 * holiday-blind) the cached price cannot change, so a long fixed window is
 * safe and saves an upstream call per poll tick.
 */
const AFTER_HOURS_CACHE_TTL_MS = 30 * 60_000;
const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 100;

export interface MarketServiceOptions {
  provider: MarketDataProvider;
  /** Used when the primary fails or during fallback mode (SimulatedProvider). */
  fallback: MarketDataProvider;
  cache: PriceCache;
  logger?: MarketLogger;
  /** Clock for cooldowns/TTL/status; injectable for tests. */
  nowMs?: () => number;
  /** Consecutive counted failures before entering fallback mode (default 3). */
  failureThreshold?: number;
  /** Fallback-mode duration before probing the primary again (default 60s). */
  cooldownMs?: number;
  /** Max symbols per upstream call (default 20). */
  batchSize?: number;
  /** Attempts per chunk in live mode, including the first (default 3). */
  maxAttempts?: number;
  /** Base backoff in ms; doubles each retry: 250, 500 (default 250). */
  backoffBaseMs?: number;
  /**
   * Hard wall-clock budget for ONE getQuotes call — all chunks, all attempts,
   * all backoffs (default 10000). The signal aborts upstream requests at the
   * deadline.
   */
  deadlineMs?: number;
  /** Cache freshness in market hours (default 120000 = 120s). */
  cacheTtlMs?: number;
}

/** Health snapshot for diagnostics/health endpoints (and logs). */
export interface MarketProviderStatus {
  mode: 'live' | 'fallback';
  /** ISO time the current mode was entered. */
  since: string;
  consecutiveFailures: number;
}

interface SearchCacheEntry {
  results: InstrumentSearchResult[];
  fetchedAtMs: number;
}

export class MarketService {
  private readonly provider: MarketDataProvider;
  private readonly fallback: MarketDataProvider;
  private readonly cache: PriceCache;
  private readonly logger: MarketLogger;
  private readonly nowMs: () => number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly deadlineMs: number;
  private readonly cacheTtlMsConfigured: number;

  private mode: 'live' | 'fallback' = 'live';
  private modeSince: number;
  private consecutiveFailures = 0;
  private cooldownUntil = 0;
  private lastErrorKind: ProviderErrorKind | null = null;
  /** In-flight chunk work, keyed by sorted symbol batch (single-flight). */
  private readonly inFlight = new Map<string, Promise<ChunkOutcome>>();
  /** Normalized query -> last successful non-empty live result. */
  private readonly searchCache = new Map<string, SearchCacheEntry>();

  constructor(options: MarketServiceOptions) {
    this.provider = options.provider;
    this.fallback = options.fallback;
    this.cache = options.cache;
    this.logger = options.logger ?? createConsoleMarketLogger();
    this.nowMs = options.nowMs ?? Date.now;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 60_000);
    this.batchSize = Math.max(1, options.batchSize ?? 20);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.backoffBaseMs = Math.max(0, options.backoffBaseMs ?? 250);
    this.deadlineMs = Math.max(1, options.deadlineMs ?? 10_000);
    this.cacheTtlMsConfigured = Math.max(0, options.cacheTtlMs ?? 120_000);
    this.modeSince = this.nowMs();
  }

  /** Read path: usable cache hits win, misses go upstream (budgeted). */
  async getQuotes(yahooSymbols: string[]): Promise<Quote[]> {
    const { quotes } = await this.collect(yahooSymbols, { useCache: true });
    return quotes;
  }

  /**
   * Poller path: always refresh from upstream, ignoring cache freshness (the
   * TTL governs how long a row may be SERVED to a client, not how often the
   * poller refreshes it). A deadline expiry leaves the affected symbols at
   * their previous value and they are retried on the next tick.
   */
  async refreshQuotes(yahooSymbols: string[]): Promise<Quote[]> {
    const { quotes } = await this.collect(yahooSymbols, { useCache: false });
    return quotes;
  }

  /** Single-symbol lookup that distinguishes "unknown" from "no data yet". */
  async getQuote(yahooSymbol: string): Promise<QuoteLookup> {
    const normalized = yahooSymbol.trim().toUpperCase();
    const { quotes, deadlineExpired } = await this.collect([normalized], { useCache: true });
    const quote = this.pickQuote(quotes, normalized);
    if (quote) return { status: 'ok', quote };
    return deadlineExpired ? { status: 'unavailable' } : { status: 'notFound' };
  }

  private pickQuote(quotes: Quote[], yahooSymbol: string): Quote | undefined {
    const mapped = fromYahooSymbol(yahooSymbol);
    if (!mapped) return undefined;
    return quotes.find(
      (quote) => quote.symbol === mapped.symbol && quote.exchange === mapped.exchange,
    );
  }

  /**
   * Shared body of all three entry points. Chunks are sequential and ONE
   * deadline covers the whole call (all chunks, attempts and backoffs), so a
   * black-holed upstream cannot multiply the wait by the number of chunks.
   */
  private async collect(
    yahooSymbols: string[],
    options: { useCache: boolean },
  ): Promise<{ quotes: Quote[]; deadlineExpired: boolean }> {
    const requested = [
      ...new Set(
        yahooSymbols
          .map((symbol) => symbol.trim().toUpperCase())
          .filter((symbol) => symbol.length > 0),
      ),
    ];
    if (requested.length === 0) return { quotes: [], deadlineExpired: false };

    const quotes: Quote[] = [];
    const missing: string[] = [];
    for (const yahooSymbol of requested) {
      const cached = this.cacheLookup(yahooSymbol);
      if (options.useCache && cached && this.isUsable(cached)) quotes.push(cached);
      else missing.push(yahooSymbol);
    }

    const chunks = chunkList(missing, this.batchSize);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.deadlineMs);
    let deadlineExpired = false;
    let failureRecorded = false;
    try {
      for (const [index, chunk] of chunks.entries()) {
        // Only the first chunk of a request may probe for recovery: if the
        // threshold tripped on an earlier chunk, the rest are served simulated
        // without any further upstream calls.
        const outcome = await this.fetchChunk(chunk, index > 0, controller.signal);
        if (outcome.kind === 'quotes' || outcome.kind === 'simulated') {
          quotes.push(...outcome.quotes);
        }
        if (outcome.kind === 'deadline') {
          deadlineExpired = true;
          // ONE counted record per call, no matter how many chunks were
          // skipped by the expiry.
          if (!failureRecorded) {
            failureRecorded = true;
            this.recordFailure();
          }
          // Keep what we last knew for these symbols — a stale real price is
          // better than a fabricated one, and nothing is written to the cache.
          quotes.push(...this.cachedIgnoringFreshness(chunk));
        }
      }
    } finally {
      clearTimeout(deadline);
    }
    return { quotes, deadlineExpired };
  }

  /** Cached rows for these symbols regardless of age or mode. */
  private cachedIgnoringFreshness(yahooSymbols: string[]): Quote[] {
    const cached: Quote[] = [];
    for (const yahooSymbol of yahooSymbols) {
      const quote = this.cacheLookup(yahooSymbol);
      if (quote) cached.push(quote);
    }
    return cached;
  }

  async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    const key = query.trim().toUpperCase();
    const cached = this.searchCache.get(key);
    if (cached) {
      if (this.nowMs() - cached.fetchedAtMs < SEARCH_CACHE_TTL_MS) {
        return [...cached.results];
      }
      this.searchCache.delete(key); // expired: free the slot
    }
    try {
      const results = await this.provider.searchInstruments(query);
      // Only successful, non-empty, live results are cached; empty answers
      // may be transient and failure-path/fallback results are not real data.
      if (results.length > 0) this.storeSearchResults(key, results);
      return results;
    } catch (error) {
      const classified = classifyProviderError(error);
      if (classified.status === 'badRequest') {
        this.logger.warn('search rejected as bad request by upstream');
        return []; // bad input, not an outage: never counted
      }
      this.recordFailure();
      try {
        return await this.fallback.searchInstruments(query);
      } catch {
        this.logger.warn('simulated fallback search failed');
        return []; // availability above completeness; already counted
      }
    }
  }

  getProviderStatus(): MarketProviderStatus {
    return {
      mode: this.mode,
      since: new Date(this.modeSince).toISOString(),
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  private cacheLookup(yahooSymbol: string): Quote | undefined {
    const mapped = fromYahooSymbol(yahooSymbol);
    return mapped ? this.cache.get(mapped.symbol, mapped.exchange) : undefined;
  }

  /**
   * Cache usability, in order: freshness window, then mode rules.
   * - live: a simulated row is stale fallback data and must be re-fetched;
   * - fallback: rows stop being usable once the cooldown expires, so the
   *   recovery probe always gets a chance to run.
   */
  private isUsable(quote: Quote): boolean {
    if (!this.isFresh(quote)) return false;
    if (this.mode === 'live') return !quote.isSimulated;
    return this.nowMs() < this.cooldownUntil;
  }

  /** Freshness is measured from `asOf` (our fetch time), never marketTime. */
  private isFresh(quote: Quote): boolean {
    const fetchedAtMs = Date.parse(quote.asOf);
    if (Number.isNaN(fetchedAtMs)) return false; // unparseable: refetch
    return this.nowMs() - fetchedAtMs < this.effectiveCacheTtlMs();
  }

  private effectiveCacheTtlMs(): number {
    return isMarketOpen(new Date(this.nowMs()))
      ? this.cacheTtlMsConfigured
      : AFTER_HOURS_CACHE_TTL_MS;
  }

  /**
   * Fetch one batch with single-flight: two concurrent callers asking for
   * the same symbols share one upstream call instead of racing.
   */
  private fetchChunk(
    chunk: string[],
    skipProbe: boolean,
    signal: AbortSignal,
  ): Promise<ChunkOutcome> {
    const key = [...chunk].sort().join(',');
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.runChunk(chunk, skipProbe, signal).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, promise);
    return promise;
  }

  private async runChunk(
    chunk: string[],
    skipProbe: boolean,
    signal: AbortSignal,
  ): Promise<ChunkOutcome> {
    if (this.mode === 'fallback') {
      if (skipProbe || this.nowMs() < this.cooldownUntil) {
        return this.serveSimulated(chunk);
      }
      // Cooldown over: ONE probe (no retry loop — fallback latency matters
      // more than a fast recovery here), under the call deadline.
      const probe = await this.attemptChunk(chunk, signal);
      if (probe.status === 'error' || probe.status === 'deadline') {
        const kind = probe.status === 'deadline' ? 'TIMEOUT' : probe.kind;
        this.recordFailure();
        this.cooldownUntil = this.nowMs() + this.cooldownMs;
        this.logger.warn(`fallback probe failed (${kind}); next attempt in ${this.cooldownMs}ms`);
        return this.serveSimulated(chunk);
      }
      if (probe.status === 'badRequest') {
        // A malformed request won't fix itself: pause probing too, so we
        // don't hammer upstream with the same bad request on every call.
        this.cooldownUntil = this.nowMs() + this.cooldownMs;
        this.logger.warn('upstream rejected probe as bad request');
        return this.serveSimulated(chunk);
      }
      this.enterLiveMode();
      return probe.status === 'ok' ? this.outcomeQuotes(probe.quotes) : this.outcomeNone();
    }

    // Live mode: the call deadline governs attempts, backoffs and chunks.
    const result = await this.attemptChunkWithRetries(chunk, signal);
    switch (result.status) {
      case 'ok':
        this.recordSuccess();
        return this.outcomeQuotes(result.quotes);
      case 'empty':
        // Healthy upstream, unknown symbol(s): a normal NOT_FOUND.
        this.recordSuccess();
        return this.outcomeNone();
      case 'deadline':
        // Budget spent. NOT simulated in live mode: the caller keeps the
        // previous cached quote (even if stale) and the poller retries next
        // tick. The failure itself is counted once per call in collect().
        this.lastErrorKind = 'TIMEOUT';
        return { kind: 'deadline' };
      case 'badRequest':
        // Our request was malformed upstream: not an outage, never counted.
        // Serve simulated so the app stays usable, but stay in live mode.
        this.logger.warn('upstream rejected quote request as bad request');
        return this.serveSimulated(chunk);
      case 'error':
        // Retries exhausted: ONE counted record, simulated served, no crash.
        this.recordFailure();
        return this.serveSimulated(chunk);
    }
  }

  private outcomeQuotes(quotes: Quote[]): ChunkOutcome {
    return { kind: 'quotes', quotes };
  }

  private outcomeNone(): ChunkOutcome {
    return { kind: 'none' };
  }

  private async attemptChunkWithRetries(
    chunk: string[],
    signal: AbortSignal,
  ): Promise<ChunkResult> {
    let last: ChunkResult = { status: 'error', kind: 'UNKNOWN' };
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      // The deadline covers the whole call: once it has fired we stop, and NO
      // further attempt is started (verified by the "never retries after the
      // deadline" test with maxAttempts deliberately set high).
      if (signal.aborted) return { status: 'deadline' };
      last = await this.attemptChunk(chunk, signal);
      if (last.status !== 'error') return last;
      if (attempt < this.maxAttempts) {
        await sleep(this.backoffBaseMs * 2 ** (attempt - 1), signal);
      }
    }
    return last;
  }

  private async attemptChunk(chunk: string[], signal: AbortSignal): Promise<ChunkResult> {
    const fetchOptions: ProviderFetchOptions = { signal };
    try {
      const quotes = await this.provider.getQuotes(chunk, fetchOptions);
      this.cacheAll(quotes);
      return quotes.length > 0 ? { status: 'ok', quotes } : { status: 'empty' };
    } catch (error) {
      // Aborted by the deadline: distinct from a provider error, because the
      // caller must not treat a spent budget as an upstream outage verdict.
      if (signal.aborted) return { status: 'deadline' };
      const classified = classifyProviderError(error);
      if (classified.status === 'badRequest') return { status: 'badRequest' };
      // message deliberately dropped: it may embed upstream payloads.
      this.lastErrorKind = classified.kind;
      return { status: 'error', kind: classified.kind };
    }
  }

  private async serveSimulated(chunk: string[]): Promise<ChunkOutcome> {
    try {
      const quotes = await this.fallback.getQuotes(chunk);
      const marked = quotes.map((quote) => ({ ...quote, isSimulated: true }));
      this.cacheAll(marked);
      return { kind: 'simulated', quotes: marked };
    } catch (error) {
      // Name only — never the message (could carry payload from a provider).
      this.logger.warn(
        `simulated fallback failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return this.outcomeNone();
    }
  }

  private storeSearchResults(key: string, results: InstrumentSearchResult[]): void {
    if (this.searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
      // Map preserves insertion order: the first key is the oldest entry.
      const oldest = this.searchCache.keys().next();
      if (!oldest.done) this.searchCache.delete(oldest.value);
    }
    this.searchCache.set(key, { results, fetchedAtMs: this.nowMs() });
  }

  private cacheAll(quotes: Quote[]): void {
    for (const quote of quotes) this.cache.set(quote);
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastErrorKind = null;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.mode === 'live' && this.consecutiveFailures >= this.failureThreshold) {
      this.mode = 'fallback';
      this.modeSince = this.nowMs();
      this.cooldownUntil = this.nowMs() + this.cooldownMs;
      // Logged once — at the transition, not on every request.
      this.logger.warn(
        `${this.consecutiveFailures} consecutive failures` +
          `${this.lastErrorKind ? ` (${this.lastErrorKind})` : ''}; ` +
          `simulated fallback for ${this.cooldownMs}ms`,
      );
    }
  }

  private enterLiveMode(): void {
    if (this.mode !== 'live') {
      this.mode = 'live';
      this.modeSince = this.nowMs();
      this.logger.info('upstream recovered after cooldown; back in live mode');
    }
    this.consecutiveFailures = 0;
    this.lastErrorKind = null;
  }
}

function chunkList(items: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Abortable sleep: resolves early (or immediately) when the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
