import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from './errors';

// Params/query validation for GET routes. Same contract as validateBody:
// Zod failures become a 400 VALIDATION_ERROR through the central handler,
// and only issue path + message are forwarded — raw issue objects can carry
// input values, which must never reach a response.
export function zodIssuesToDetails(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }));
}

export function validateParams<T extends object>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(
        new AppError(
          'VALIDATION_ERROR',
          'Invalid request parameters',
          400,
          zodIssuesToDetails(result.error),
        ),
      );
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}

export function validateQuery<T extends object>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(
        new AppError(
          'VALIDATION_ERROR',
          'Invalid query parameters',
          400,
          zodIssuesToDetails(result.error),
        ),
      );
      return;
    }
    // req.query has only a getter in Express 5; stash the parsed value where
    // handlers can read it without fighting the type.
    res.locals.query = result.data;
    next();
  };
}
