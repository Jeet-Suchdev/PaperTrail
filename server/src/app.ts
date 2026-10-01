import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './lib/errorHandler';
import { healthRouter } from './modules/health/routes';

// The app is assembled here; only index.ts calls listen(). Tests import
// `app` directly and talk to it through supertest (no open port needed).
export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json());

app.use('/api/health', healthRouter);

app.use(notFoundHandler);
app.use(errorHandler);
