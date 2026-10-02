// Declaration merging: requireAuth sets req.userId on every authenticated
// request. Express' own Request already extends Express.Request, so this
// interface merges into every handler's `req` — no `any`, no `as`.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
