import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { errorHandler } from './errorHandler';
import { AppError } from './errors';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const next = () => {};

describe('errorHandler', () => {
  it('maps Prisma P2002 to 409 CONFLICT', () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '7.10.0' },
    );
    const res = mockRes();

    errorHandler(err, {} as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: expect.any(String) },
    });
  });

  it('passes AppError through with its own code and status', () => {
    const res = mockRes();

    errorHandler(
      new AppError('AUTH_FAILED', 'Authentication failed', 401),
      {} as Request,
      res as unknown as Response,
      next,
    );

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'AUTH_FAILED', message: 'Authentication failed' },
    });
  });
});
