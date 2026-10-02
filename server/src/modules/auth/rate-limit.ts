import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env';

export interface AuthLimiterOptions {
  windowMs?: number;
  loginMax?: number;
  registerMax?: number;
}

// Factory instead of skip logic: production runs on env defaults, tests
// raise the env values (see vitest.config.ts), and the 429 test builds a
// separate limiter with a low max. Every response uses our error shape.
export function createAuthLimiters(options: AuthLimiterOptions = {}) {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const loginMax = options.loginMax ?? env.RATE_LIMIT_LOGIN_MAX;
  const registerMax = options.registerMax ?? env.RATE_LIMIT_REGISTER_MAX;

  const make = (limit: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later',
          },
        });
      },
    });

  return { login: make(loginMax), register: make(registerMax) };
}
