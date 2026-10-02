import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env';

export const SESSION_COOKIE_NAME = 'session';

// ONE helper used for BOTH set and clear. Browsers replace cookies by
// name + domain + path, so the attributes must match exactly. Express 5's
// clearCookie strips maxAge itself and forces a past Expires (verified in
// express/lib/response.js), so passing this same object to clear is safe:
// the result is `session=; …Expires=1970…` with identical attributes.
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000, // milliseconds
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
}
