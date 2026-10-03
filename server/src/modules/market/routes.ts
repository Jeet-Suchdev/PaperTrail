import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../auth/middleware';
import { validateParams, validateQuery } from '../../lib/validateInput';
import { quoteParamsSchema, quoteQuerySchema, searchQuerySchema } from './market.schemas';
import { createMarketLimiters } from './rate-limit';
import type { MarketQueryService } from './query-service';
import type { Quote } from './types';

export interface MarketRouterDeps {
  queryService: MarketQueryService;
  /** Middleware for the market routes; env defaults unless overridden. */
  limiters?: { quote: RequestHandler; search: RequestHandler };
}

// Prices cross the wire as plain integers (rupees never appear as floats).
function quoteResponse(quote: Quote) {
  return {
    symbol: quote.symbol,
    exchange: quote.exchange,
    pricePaise: quote.pricePaise,
    prevClosePaise: quote.prevClosePaise,
    changePaise: quote.changePaise,
    changePercent: quote.changePercent,
    asOf: quote.asOf,
    marketTime: quote.marketTime,
    ...(quote.delayMinutes !== undefined ? { delayMinutes: quote.delayMinutes } : {}),
    isSimulated: quote.isSimulated,
  };
}

export function createMarketRouter(deps: MarketRouterDeps): Router {
  const router = Router();
  const limiters = deps.limiters ?? createMarketLimiters();

  // GET /api/market/quote/:symbol?exchange=NSE
  router.get(
    '/quote/:symbol',
    requireAuth,
    limiters.quote,
    validateParams(quoteParamsSchema),
    validateQuery(quoteQuerySchema),
    async (req, res) => {
      const { symbol } = req.params as unknown as { symbol: string };
      const { exchange } = res.locals.query as { exchange: 'NSE' | 'BSE' };
      const quote = await deps.queryService.getQuote(symbol, exchange);
      res.json({ quote: quoteResponse(quote) });
    },
  );

  // GET /api/market/search?q=reliance
  router.get(
    '/search',
    requireAuth,
    limiters.search,
    validateQuery(searchQuerySchema),
    async (_req, res) => {
      const { q } = res.locals.query as { q: string };
      const instruments = await deps.queryService.search(q);
      res.json({ instruments });
    },
  );

  return router;
}
