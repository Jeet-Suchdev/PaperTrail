// Pure symbol mapping between our world (bare symbol + exchange) and
// Yahoo's world (one string with a suffix). No network, no Yahoo imports —
// both providers and the HTTP layer use this.
//
// NSE -> .NS, BSE -> .BO (confirmed against live Yahoo in Checkpoint 1).
// Deliberately strict: anything with a dot or whitespace is rejected, so a
// user-supplied "RELIANCE.NS" or "RELIANCE " can never smuggle a suffix
// through the bare-symbol path.

import type { Exchange } from './types';

const SUFFIX_BY_EXCHANGE: Record<Exchange, string> = {
  NSE: '.NS',
  BSE: '.BO',
};

// Bare-symbol rules, mirroring the route regex in Checkpoint 4:
// uppercase letters, digits, '&', '-', max 20 chars. 'M&M' and
// 'BAJAJ-AUTO' must pass; dots and whitespace must not.
const BARE_SYMBOL_RE = /^[A-Z0-9&-]{1,20}$/;

/**
 * Bare symbol + exchange -> Yahoo symbol ('RELIANCE', 'NSE' -> 'RELIANCE.NS').
 * Returns null when the symbol is invalid (dot, whitespace, bad charset,
 * empty, or too long) — callers treat that as NOT_FOUND, not as a crash.
 */
export function toYahooSymbol(symbol: string, exchange: Exchange): string | null {
  const suffix = SUFFIX_BY_EXCHANGE[exchange];
  if (!suffix) return null;
  const bare = symbol.toUpperCase();
  if (!BARE_SYMBOL_RE.test(bare)) return null;
  return bare + suffix;
}

/**
 * Yahoo symbol -> bare symbol + exchange ('RELIANCE.NS' -> 'RELIANCE'/'NSE').
 * Returns null when the string is not exactly <valid bare symbol>.<NS|BO> —
 * unknown suffixes, extra dots ('FOO.BAR.NS'), whitespace, or missing
 * suffixes all fail. Matching is case-insensitive (input is uppercased).
 */
export function fromYahooSymbol(yahooSymbol: string): { symbol: string; exchange: Exchange } | null {
  const normalized = yahooSymbol.toUpperCase();
  for (const [exchange, suffix] of Object.entries(SUFFIX_BY_EXCHANGE) as [Exchange, string][]) {
    if (normalized.endsWith(suffix)) {
      const bare = normalized.slice(0, -suffix.length);
      if (!BARE_SYMBOL_RE.test(bare)) return null; // also kills inner dots ('FOO.BAR.NS')
      return { symbol: bare, exchange };
    }
  }
  return null;
}
