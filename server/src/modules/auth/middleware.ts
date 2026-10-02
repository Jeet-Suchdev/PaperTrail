import type { RequestHandler } from 'express';
import { AppError } from '../../lib/errors';
import { verifySessionToken } from '../../lib/jwt';
import { SESSION_COOKIE_NAME } from './cookies';

// Attaches req.userId for downstream handlers, or fails with the standard
// 401 shape. Missing cookie, bad signature, wrong algorithm, and expired
// token all produce the same response — no way to tell them apart.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies[SESSION_COOKIE_NAME];
  if (typeof token !== 'string' || token === '') {
    next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
    return;
  }
  try {
    req.userId = verifySessionToken(token);
    next();
  } catch {
    next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
  }
};
