import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../app';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { errorHandler } from '../../lib/errorHandler';
import { createAuthLimiters } from './rate-limit';

const EMAIL = 'http-alice@papertrail.test';
const PASSWORD = 'correct-horse-battery-staple';
const REGISTER_BODY = { name: 'Alice', email: EMAIL, password: PASSWORD };

async function resetDb() {
  await prisma.$executeRaw`TRUNCATE TABLE "LedgerEntry", "Wallet", "User"`;
}

beforeEach(async () => {
  await resetDb();
});

// superagent exposes set-cookie as string[] at runtime; the header bag is
// typed loosely, so narrow through unknown.
function firstSetCookie(headers: unknown): string {
  if (!Array.isArray(headers) || typeof headers[0] !== 'string') {
    throw new Error('expected a Set-Cookie header');
  }
  return headers[0];
}

function sessionCookie(res: request.Response): string {
  return firstSetCookie(res.headers['set-cookie']).split(';')[0]!;
}

async function registerAlice() {
  const res = await request(app).post('/api/auth/register').send(REGISTER_BODY);
  expect(res.status).toBe(201);
  return res;
}

describe('POST /api/auth/register', () => {
  it('returns 201, sets the session cookie, and never exposes passwordHash', async () => {
    const res = await request(app).post('/api/auth/register').send(REGISTER_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      user: { id: expect.any(String), email: EMAIL, name: 'Alice' },
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = firstSetCookie(res.headers['set-cookie']);
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    const maxAge = /Max-Age=(\d+)/.exec(cookie);
    expect(maxAge).not.toBeNull();
    expect(Number(maxAge![1])).toBeGreaterThan(604700);
    expect(Number(maxAge![1])).toBeLessThanOrEqual(604800);
  });

  it('returns 400 VALIDATION_ERROR for a short password, without echoing it', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...REGISTER_BODY, password: 'short1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('short1');
  });

  it('returns 400 VALIDATION_ERROR for a bad email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...REGISTER_BODY, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when the name is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 CONFLICT for a duplicate email', async () => {
    await registerAlice();

    const res = await request(app).post('/api/auth/register').send(REGISTER_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 and sets the session cookie on success', async () => {
    await registerAlice();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: EMAIL,
      name: 'Alice',
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(firstSetCookie(res.headers['set-cookie'])).toContain('session=');
  });

  it('returns identical status and body for wrong password and unknown email', async () => {
    await registerAlice();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'wrong-password-x' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@papertrail.test', password: 'wrong-password-x' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('AUTH_FAILED');
  });

  it('returns 401 (not 400) for a short wrong password', async () => {
    await registerAlice();

    const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'abc' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_FAILED');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 with the standard shape when no cookie is sent', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String) },
    });
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const token = jwt.sign({ sub: 'some-user-id' }, 'a-different-secret-of-at-least-32-chars!', {
      algorithm: 'HS256',
      expiresIn: 3600,
    });

    const res = await request(app).get('/api/auth/me').set('Cookie', `session=${token}`);

    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign({ sub: 'some-user-id' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: -60,
    });

    const res = await request(app).get('/api/auth/me').set('Cookie', `session=${token}`);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a valid token whose user was deleted', async () => {
    const registered = await registerAlice();

    await prisma.user.delete({ where: { email: EMAIL } });

    const res = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(registered));

    expect(res.status).toBe(401);
    // The stale cookie is cleared so the client stops sending it.
    expect(firstSetCookie(res.headers['set-cookie'])).toMatch(/^session=;/);
  });

  it('returns the user and cashPaise as a plain number for a valid cookie', async () => {
    const registered = await registerAlice();

    const res = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(registered));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: expect.any(String), email: EMAIL, name: 'Alice' },
      wallet: { cashPaise: 100000000 },
    });
    expect(typeof res.body.wallet.cashPaise).toBe('number');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie with matching attributes', async () => {
    const registered = await registerAlice();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie(registered));

    expect(res.status).toBe(204);
    const cleared = firstSetCookie(res.headers['set-cookie']);
    expect(cleared).toMatch(/^session=;/);
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Lax');
    expect(cleared).toContain('Path=/');
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(cleared).not.toContain('Max-Age=');
  });
});

describe('auth rate limiting', () => {
  it('returns 429 with the standard error shape once the limit is exceeded', async () => {
    const limited = express();
    limited.use(express.json());
    const limiters = createAuthLimiters({ windowMs: 60000, loginMax: 1, registerMax: 1 });
    limited.post('/api/auth/login', limiters.login, (_req, res) => {
      res.status(200).json({ ok: true });
    });
    limited.use(errorHandler);

    const first = await request(limited).post('/api/auth/login').send({});
    expect(first.status).toBe(200);

    const second = await request(limited).post('/api/auth/login').send({});
    expect(second.status).toBe(429);
    expect(second.body).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.any(String) },
    });
  });
});
