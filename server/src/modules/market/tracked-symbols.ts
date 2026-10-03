// The poller's work list. Any authenticated user can ask for any symbol, so
// this set is an abuse vector and is deliberately hard-bounded:
//
// - a symbol is added only AFTER toYahooSymbol() maps it AND a quote for it
//   was actually found (never unknown symbols, never unparseable input),
// - at most `maxEntries` (default 200) are tracked,
// - when full, the OLDEST entry is expired to make room (insertion-ordered
//   Map) so the set can never grow without limit.
//
// Only the poller reads this; nothing here fetches anything.

import { toYahooSymbol } from './symbol-map';
import type { Exchange } from './types';

const DEFAULT_MAX_ENTRIES = 200;

export class TrackedSymbols {
  private readonly entries = new Map<string, string>(); // "EXCHANGE:SYMBOL" -> yahooSymbol
  private readonly maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Track a symbol. Returns true when it was newly added (an already-tracked
   * symbol is NOT re-added, so its position in the eviction order stays put).
   */
  add(symbol: string, exchange: Exchange): boolean {
    const yahooSymbol = toYahooSymbol(symbol, exchange);
    if (!yahooSymbol) return false; // unmappable input is never tracked
    const key = `${exchange}:${symbol.toUpperCase()}`;
    if (this.entries.has(key)) return false;
    if (this.entries.size >= this.maxEntries) this.expireOldest();
    this.entries.set(key, yahooSymbol);
    return true;
  }

  /** Yahoo symbols for the poller to fetch (service-level input). */
  list(): string[] {
    return [...this.entries.values()];
  }

  private expireOldest(): void {
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}
