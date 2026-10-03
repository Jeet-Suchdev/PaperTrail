// PricePoller — refreshes the price cache for tracked symbols while the
// market is open. Design notes (Checkpoint 4):
//
// - No setInterval. Each tick schedules the NEXT one with setTimeout after
//   the current tick has finished, so ticks can never overlap, and a slow
//   tick cannot stack up a backlog.
// - Timers are unref'd: a forgotten poller must never keep the process (or a
//   test run) alive.
// - Outside market hours the poller does nothing — the cache serves the last
//   close, and a quote request with a cold cache still goes through the
//   normal service path (failure counter + simulated fallback).
// - Lifecycle: index.ts starts and stops it. Nothing here runs at import
//   time, and createApp() never touches it.
// - A tick that throws is logged (name only) and the loop continues.

import { createConsoleMarketLogger, type MarketLogger } from './market-logger';
import { isMarketOpen } from './market-hours';
import type { MarketService } from './market-service';
import type { TrackedSymbols } from './tracked-symbols';

export interface PricePollerOptions {
  service: MarketService;
  trackedSymbols: TrackedSymbols;
  /** Poll interval in seconds (PRICE_POLL_INTERVAL_SECONDS, default 10). */
  intervalSeconds?: number;
  logger?: MarketLogger;
  /** Clock; injectable so tests can place it inside/outside market hours. */
  now?: () => Date;
  /** Market-hours predicate; injectable for tests. */
  marketOpen?: (now: Date) => boolean;
}

export class PricePoller {
  private readonly service: MarketService;
  private readonly trackedSymbols: TrackedSymbols;
  private readonly intervalMs: number;
  private readonly logger: MarketLogger;
  private readonly now: () => Date;
  private readonly marketOpen: (now: Date) => boolean;

  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private tickInFlight = false;

  constructor(options: PricePollerOptions) {
    this.service = options.service;
    this.trackedSymbols = options.trackedSymbols;
    this.intervalMs = Math.max(1, options.intervalSeconds ?? 10) * 1000;
    this.logger = options.logger ?? createConsoleMarketLogger();
    this.now = options.now ?? (() => new Date());
    this.marketOpen = options.marketOpen ?? isMarketOpen;
  }

  /** Run one tick immediately, then keep ticking until stop(). */
  start(): void {
    if (!this.stopped) return; // idempotent
    this.stopped = false;
    void this.tick();
  }

  /** Stop ticking and drop any pending timer. Safe to call twice. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for tests/diagnostics: is a tick currently executing? */
  get isTicking(): boolean {
    return this.tickInFlight;
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      if (!this.marketOpen(this.now())) return; // closed: serve the last close
      const symbols = this.trackedSymbols.list();
      if (symbols.length === 0) return;
      // refreshQuotes (not getQuotes): a tick always refreshes from upstream.
      // Symbols skipped by a deadline expiry are simply retried next tick.
      await this.service.refreshQuotes(symbols); // batches + refreshes the cache
    } catch (error) {
      // MarketService is designed not to throw; if something does, the loop
      // must survive it. Error name only — messages can carry payloads.
      this.logger.warn(`poll tick failed (${error instanceof Error ? error.name : 'unknown'})`);
    } finally {
      this.tickInFlight = false;
      // Chained AFTER the tick completes: the next tick can never overlap.
      if (!this.stopped) this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.(); // never hold the process open
  }
}
