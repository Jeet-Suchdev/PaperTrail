import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from './errors';

// Turns Zod failures into 400 VALIDATION_ERROR through the central error
// handler. Only path + message are forwarded: raw issue objects can carry
// input values and regexes, which must never reach a response — especially
// for password fields.
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      next(new AppError('VALIDATION_ERROR', 'Invalid request body', 400, details));
      return;
    }
    req.body = result.data;
    next();
  };
}
