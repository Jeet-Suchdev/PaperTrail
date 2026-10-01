import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../app';
import { prisma } from '../../lib/prisma';

describe('GET /api/health', () => {
  it('round-trips SELECT 1 through Prisma and reports ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('runs against the dedicated test database, not the dev database', async () => {
    const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;

    expect(rows[0]?.db).toBe('papertrail_test');
  });
});

describe('error handling', () => {
  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('returns 400 with the standard shape for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
