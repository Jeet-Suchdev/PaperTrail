import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env';

// Market routes require a session, so the limiter is keyed by USER ID, not
// IP: an authenticated user behind a shared NAT (or a mobile IP that rotates)
// must not lock themselves out, and one abusive account cannot spend
// everyone else's quota. requireAuth runs before the limiter, so req.userId
// is always set; the 'anonymous' bucket only exists as a safety net and
// shares one quota.
export interface MarketLimiterOptions {
  windowMs?: number;
  marketMax?: number;
}

export function createMarketLimiters(options: MarketLimiterOptions = {}) {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const marketMax = options.marketMax ?? env.RATE_LIMIT_MARKET_MAX;

  const make = (limit: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.userId ?? 'anonymous',
      handler: (_req, res) => {
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later',
          },
        });
      },
    });

  return { quote: make(marketMax), search: make(marketMax) };
}
