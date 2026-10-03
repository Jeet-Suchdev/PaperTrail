import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { errorHandler, notFoundHandler } from './lib/errorHandler';
import { healthRouter } from './modules/health/routes';
import { authRouter } from './modules/auth/routes';
import { marketStack } from './market-stack';

export interface AppDeps {
  /** Market router, built by index.ts (or by tests) with its own deps. */
  marketRouter: Router;
}

// The app is assembled here; only index.ts calls listen(). Tests import
// `createApp` (or the `app` singleton) and talk to it through supertest —
// no open port, and NO timers: the price poller is started and stopped by
// index.ts alone.
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/market', deps.marketRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// Shared instance (routes + poller use the same MarketService via
// marketStack). Importing it creates no timers.
export const app = createApp({ marketRouter: marketStack.router });
