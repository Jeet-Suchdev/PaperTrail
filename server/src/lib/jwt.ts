import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errors';

// The session token: signed at login, verified on every authenticated
// request. HS256 is pinned explicitly rather than relying on whatever
// the library defaults to.
const EXPIRES_IN_SECONDS = env.SESSION_TTL_DAYS * 24 * 60 * 60;

export function signSessionToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: EXPIRES_IN_SECONDS,
  });
}

/** Returns the userId (sub) inside the token, or throws 401. */
export function verifySessionToken(token: string): string {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new AppError('INVALID_SESSION', 'Invalid session token', 401);
  }
  return payload.sub;
}
