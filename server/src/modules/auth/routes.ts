import { Router } from 'express';
import { AppError } from '../../lib/errors';
import { signSessionToken } from '../../lib/jwt';
import { paiseToNumber } from '../../lib/money';
import { validateBody } from '../../lib/validateBody';
import { login, register, getProfile } from './auth.service';
import { loginSchema, registerSchema, type LoginBody, type RegisterBody } from './auth.schemas';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { requireAuth } from './middleware';
import { createAuthLimiters } from './rate-limit';

export const authRouter = Router();

// Env defaults (RATE_LIMIT_*); tests raise them via test.env — no skip logic.
const limiters = createAuthLimiters();

// Explicit field picks — passwordHash can never leak by spreading the row.
function publicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name };
}

authRouter.post('/register', limiters.register, validateBody(registerSchema), async (req, res) => {
  const body: RegisterBody = req.body;
  const { user } = await register(body);
  setSessionCookie(res, signSessionToken(user.id));
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', limiters.login, validateBody(loginSchema), async (req, res) => {
  const body: LoginBody = req.body;
  const user = await login(body.email, body.password);
  setSessionCookie(res, signSessionToken(user.id));
  res.status(200).json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

// One findUnique with include: { wallet: true } — no second query, no N+1.
authRouter.get('/me', requireAuth, async (req, res, next) => {
  const profile = req.userId === undefined ? null : await getProfile(req.userId);
  if (profile === null) {
    // User deleted (or wallet missing): the cookie is stale — clear it.
    clearSessionCookie(res);
    next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
    return;
  }
  res.json({
    user: publicUser(profile.user),
    wallet: { cashPaise: paiseToNumber(profile.wallet.cashPaise) },
  });
});
