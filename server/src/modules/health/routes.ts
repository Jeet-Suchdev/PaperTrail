import { Router } from 'express';
import { getHealth } from './service';

export const healthRouter = Router();

// 200 when the DB answers, 503 when it doesn't — so curl/monitoring can
// check status codes alone.
healthRouter.get('/', async (_req, res) => {
  const report = await getHealth();
  res.status(report.status === 'ok' ? 200 : 503).json(report);
});
