// Composition root for the market slice: builds the provider-backed service,
// the bounded tracked-symbol set, the query service the routes use, the
// Express router, and the price poller — all sharing ONE MarketService
// instance so cache and failure-counter state are consistent.
//
// Constructing this starts NOTHING: the poller is started explicitly by
// index.ts and stopped on shutdown, so importing the app in tests leaves no
// open handles.

import { env } from './config/env';
import { createMarketService } from './modules/market/create-market-service';
import type { MarketService } from './modules/market/market-service';
import { PricePoller } from './modules/market/poller';
import { MarketQueryService } from './modules/market/query-service';
import { createMarketRouter } from './modules/market/routes';
import { TrackedSymbols } from './modules/market/tracked-symbols';
import type { Router } from 'express';

export interface MarketStack {
  service: MarketService;
  trackedSymbols: TrackedSymbols;
  queryService: MarketQueryService;
  router: Router;
  poller: PricePoller;
}

export function createMarketStack(): MarketStack {
  const service = createMarketService();
  const trackedSymbols = new TrackedSymbols();
  const queryService = new MarketQueryService({ service, trackedSymbols });
  const router = createMarketRouter({ queryService });
  const poller = new PricePoller({
    service,
    trackedSymbols,
    intervalSeconds: env.PRICE_POLL_INTERVAL_SECONDS,
  });
  return { service, trackedSymbols, queryService, router, poller };
}

/** The single shared stack used by app.ts (and therefore by index.ts). */
export const marketStack = createMarketStack();
