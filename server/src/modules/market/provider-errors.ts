// Classifying upstream failures into provider outcomes (types.ts). String
// matching on `error.name` — the upstream library's error classes set stable
// names, so this file never imports it.
//
// Counting rule (Checkpoint 3): only `status: 'error'` feeds the failure
// counter. `badRequest` is bad input, not an outage.

import type { ProviderErrorKind } from './types';

/** Thrown by YahooProvider when every item in a batch fails our Zod parse. */
export class MarketValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketValidationError';
  }
}

/**
 * What classifyProviderError can ever return: an outage-shaped error, or a
 * malformed request. (ok/notFound never come from a thrown error — keeping
 * them out of the return type means callers can read `.kind` after the
 * badRequest check without a redundant narrowing.)
 */
export type ClassifiedError =
  | { status: 'badRequest'; message: string }
  | { status: 'error'; kind: ProviderErrorKind; message: string };

/**
 * Map a thrown upstream error to a provider outcome.
 * NOTE: error.message may embed upstream payload (e.g.
 * FailedYahooValidationError carries the raw result) — callers may use the
 * message internally but must never log it.
 */
export function classifyProviderError(error: unknown): ClassifiedError {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  switch (name) {
    case 'BadRequestError':
      // Yahoo said our request itself was malformed — bad input, not outage.
      return { status: 'badRequest', message };
    case 'FailedYahooValidationError':
    case 'MarketValidationError':
    case 'ZodError':
      return { status: 'error', kind: 'VALIDATION', message };
    case 'HTTPError':
      return { status: 'error', kind: 'HTTP', message };
    case 'AbortError':
    case 'TimeoutError':
      return { status: 'error', kind: 'TIMEOUT', message };
    case 'TypeError':
      // fetch()'s failure mode ("fetch failed") — network trouble.
      return { status: 'error', kind: 'NETWORK', message };
    default:
      return { status: 'error', kind: 'UNKNOWN', message };
  }
}
