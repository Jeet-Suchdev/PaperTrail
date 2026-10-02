// Our own thin Zod parse of the Yahoo quote payload — only the fields we
// actually use (Checkpoint 1 amendments). The yahoo-finance2 library ships
// its own validation, but we treat everything crossing the provider boundary
// as untrusted: if a field is missing or the wrong type, this parse fails
// loudly (a VALIDATION failure that counts toward the failure counter) rather
// than producing a wrong price. Unknown fields are stripped by z.object.
//
// No yahoo-finance2 import here — this file must stay pure so it can be
// tested and reasoned about without the library.
//
// CHECKPOINT 3 NOTE: parse PER ITEM — one yahooQuoteSchema.parse per quote in
// a batch. A malformed item may fail ONLY that item (others must still
// succeed); never parse a batch as a whole, or one bad symbol would poison
// the entire batch into counting as an outage.

import { z } from 'zod';

export const yahooQuoteSchema = z.object({
  symbol: z.string().min(1),
  regularMarketPrice: z.number().finite().positive(),
  regularMarketPreviousClose: z.number().finite().nonnegative(),
  regularMarketChange: z.number().finite(),
  // Validated as sane input only. Quote.changePercent is NOT copied from this
  // float — it is computed from integer paise values (changePercentFromPaise)
  // so change and percent can never disagree.
  regularMarketChangePercent: z.number().finite(),
  // The library hands us a Date; raw payloads carry an ISO string. Accept both,
  // normalize to Date.
  regularMarketTime: z
    .union([z.date(), z.iso.datetime()])
    .transform((value) => (typeof value === 'string' ? new Date(value) : value)),
  currency: z.string().min(1),
  exchange: z.string().min(1),
  // Optional on purpose: delayMinutes is informational (Quote.delayMinutes?).
  exchangeDataDelayedBy: z.number().int().nonnegative().optional(),
});

export type YahooQuotePayload = z.infer<typeof yahooQuoteSchema>;
