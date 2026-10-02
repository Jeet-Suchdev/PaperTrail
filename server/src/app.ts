import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { errorHandler, notFoundHandler } from './lib/errorHandler';
import { healthRouter } from './modules/health/routes';
import { authRouter } from './modules/auth/routes';

// The app is assembled here; only index.ts calls listen(). Tests import
// `app` directly and talk to it through supertest (no open port needed).
export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);

app.use(notFoundHandler);
app.use(errorHandler);
