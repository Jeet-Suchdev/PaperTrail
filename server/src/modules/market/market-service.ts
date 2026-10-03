// MarketService — sits above any MarketDataProvider and adds everything the
// app needs to never crash and never stall because of upstream trouble
// (SPEC §6, Checkpoint 3):
//
// - one-at-a-time single-flight per symbol batch (concurrent callers share
//   one upstream call),
// - batching (at most `batchSize` symbols per provider call),
// - retry with exponential backoff on counted errors,
// - a consecutive-failure counter: after `failureThreshold` failures the
//   service switches to `fallback` (SimulatedProvider) for `cooldownMs`,
//   probes the real provider once when the cooldown ends, and comes back to
//   `live` on the first healthy probe,
// - a read-through price cache: usable cache hits never touch the provider;
//   every fetch (live or simulated) refreshes the cache.
//
// Mode transitions are logged EXACTLY ONCE (at the transition), never per
// request. Error messages from upstream are classified and dropped — only
// error KINDS are kept, and raw payloads never reach the logs.

import { classifyProviderError } from './provider-errors';
import { createConsoleMarketLogger, type MarketLogger } from './market-logger';
import type { PriceCache } from './price-cache';
import { fromYahooSymbol } from './symbol-map';
import type { InstrumentSearchResult, MarketDataProvider, ProviderErrorKind, Quote } from './types';

/** Result of one attempt against the primary provider. */
type ChunkResult =
  | { status: 'ok'; quotes: Quote[] }
  | { status: 'empty' }
  | { status: 'badRequest' }
  | { status: 'error'; kind: ProviderErrorKind };

export interface MarketServiceOptions {
  provider: MarketDataProvider;
  /** Used when the primary fails or during fallback mode (SimulatedProvider). */
  fallback: MarketDataProvider;
  cache: PriceCache;
  logger?: MarketLogger;
  /** Clock for cooldowns/status; injectable for tests. */
  nowMs?: () => number;
  /** Consecutive counted failures before entering fallback mode (default 3). */
  failureThreshold?: number;
  /** Fallback-mode duration before probing the primary again (default 60s). */
  cooldownMs?: number;
  /** Max symbols per upstream call (default 20). */
  batchSize?: number;
  /** Attempts per batch in live mode, including the first (default 3). */
  maxAttempts?: number;
  /** Base backoff in ms; doubles each retry: 250, 500 (default 250). */
  backoffBaseMs?: number;
}

/** Health snapshot for diagnostics/health endpoints (and logs). */
export interface MarketProviderStatus {
  mode: 'live' | 'fallback';
  /** ISO time the current mode was entered. */
  since: string;
  consecutiveFailures: number;
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

  private mode: 'live' | 'fallback' = 'live';
  private modeSince: number;
  private consecutiveFailures = 0;
  private cooldownUntil = 0;
  private lastErrorKind: ProviderErrorKind | null = null;
  /** In-flight upstream calls, keyed by sorted symbol batch (single-flight). */
  private readonly inFlight = new Map<string, Promise<Quote[]>>();

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
    this.modeSince = this.nowMs();
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

    const quotes: Quote[] = [];
    const missing: string[] = [];
    for (const yahooSymbol of requested) {
      const cached = this.cacheLookup(yahooSymbol);
      if (cached && this.isUsable(cached)) quotes.push(cached);
      else missing.push(yahooSymbol);
    }

    for (const chunk of chunkList(missing, this.batchSize)) {
      quotes.push(...(await this.fetchChunk(chunk)));
    }
    return quotes;
  }

  async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    try {
      return await this.provider.searchInstruments(query);
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
   * Cache usability depends on mode: while live, a simulated row is stale
   * fallback data and must be re-fetched; while in fallback, a cached row is
   * served only INSIDE the cooldown. Once the cooldown expires the row stops
   * being usable even if present — otherwise a warm cache would serve
   * forever and the recovery probe would never run (permanent fallback).
   */
  private isUsable(quote: Quote): boolean {
    if (this.mode === 'live') return !quote.isSimulated;
    if (this.nowMs() >= this.cooldownUntil) return false;
    return true;
  }

  /**
   * Fetch one batch with single-flight: two concurrent callers asking for
   * the same symbols share one upstream call instead of racing.
   */
  private fetchChunk(chunk: string[]): Promise<Quote[]> {
    const key = [...chunk].sort().join(',');
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.runChunk(chunk).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async runChunk(chunk: string[]): Promise<Quote[]> {
    if (this.mode === 'fallback') {
      if (this.nowMs() < this.cooldownUntil) {
        return this.serveSimulated(chunk);
      }
      // Cooldown over: ONE probe (no retry loop — fallback latency matters
      // more than a fast recovery here).
      const probe = await this.attemptChunk(chunk);
      if (probe.status === 'error') {
        this.recordFailure();
        this.cooldownUntil = this.nowMs() + this.cooldownMs;
        this.logger.warn(
          `fallback probe failed (${probe.kind}); next attempt in ${this.cooldownMs}ms`,
        );
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
      return probe.status === 'ok' ? probe.quotes : [];
    }

    // Live mode.
    const result = await this.attemptChunkWithRetries(chunk);
    switch (result.status) {
      case 'ok':
        this.recordSuccess();
        return result.quotes;
      case 'empty':
        // Healthy upstream, unknown symbol(s): a normal NOT_FOUND.
        this.recordSuccess();
        return [];
      case 'badRequest':
        // Our request was malformed upstream: not an outage, never counted.
        // Serve simulated so the app stays usable, but stay in live mode.
        this.logger.warn('upstream rejected quote request as bad request');
        return this.serveSimulated(chunk);
      case 'error':
        // Retries exhausted: counted, simulated served, no crash.
        this.recordFailure();
        return this.serveSimulated(chunk);
    }
  }

  private async attemptChunkWithRetries(chunk: string[]): Promise<ChunkResult> {
    let last: ChunkResult = { status: 'error', kind: 'UNKNOWN' };
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      last = await this.attemptChunk(chunk);
      if (last.status !== 'error') return last;
      if (attempt < this.maxAttempts) {
        await sleep(this.backoffBaseMs * 2 ** (attempt - 1));
      }
    }
    return last;
  }

  private async attemptChunk(chunk: string[]): Promise<ChunkResult> {
    try {
      const quotes = await this.provider.getQuotes(chunk);
      this.cacheAll(quotes);
      return quotes.length > 0 ? { status: 'ok', quotes } : { status: 'empty' };
    } catch (error) {
      const classified = classifyProviderError(error);
      if (classified.status === 'badRequest') return { status: 'badRequest' };
      // message deliberately dropped: it may embed upstream payloads.
      this.lastErrorKind = classified.kind;
      return { status: 'error', kind: classified.kind };
    }
  }

  private async serveSimulated(chunk: string[]): Promise<Quote[]> {
    try {
      const quotes = await this.fallback.getQuotes(chunk);
      const marked = quotes.map((quote) => ({ ...quote, isSimulated: true }));
      this.cacheAll(marked);
      return marked;
    } catch (error) {
      // Name only — never the message (could carry payload from a provider).
      this.logger.warn(
        `simulated fallback failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return [];
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
