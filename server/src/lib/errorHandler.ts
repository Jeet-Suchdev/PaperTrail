import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '../generated/prisma/client';
import { AppError, NotFoundError } from './errors';

// Matches everything that no route handled; Express then walks on to the
// error middleware below.
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError());
};

interface MaybeHttpError {
  status?: unknown;
}

function isClientError(err: unknown): err is MaybeHttpError & { status: number } {
  if (typeof err !== 'object' || err === null || !('status' in err)) return false;
  const status = (err as MaybeHttpError).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

// The single place every request error ends up. Response shape is always
// { error: { code, message, details? } } (SPEC section 7).
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Unique-constraint violation (e.g. duplicate email on register):
  // a conflict the client can understand, not a bug.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'A record with that unique value already exists' },
    });
    return;
  }

  // e.g. malformed JSON body from express.json() — a client mistake, not a bug.
  if (isClientError(err)) {
    res.status(err.status).json({
      error: { code: 'INVALID_REQUEST', message: 'Invalid request body' },
    });
    return;
  }

  // Unexpected error: log the real thing, never leak internals to the client.
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  });
};
