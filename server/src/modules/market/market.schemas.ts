import { z } from 'zod';

// Route-input schemas. The symbol rule mirrors BARE_SYMBOL_RE in
// symbol-map.ts (uppercase letters, digits, '&', '-', max 20) so anything the
// router accepts is something toYahooSymbol can map; the mapping itself is
// still checked in the service.

export const quoteParamsSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9&-]{1,20}$/, 'Invalid symbol'),
});

// Exchange is a query param (?exchange=BSE), defaulting to NSE.
export const quoteQuerySchema = z.object({
  exchange: z.enum(['NSE', 'BSE']).default('NSE'),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Query is required').max(50, 'Query too long'),
});

export type QuoteParams = z.infer<typeof quoteParamsSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
