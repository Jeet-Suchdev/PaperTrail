import { createServer, type Server } from 'node:http';
import { app } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { marketStack } from './market-stack';

// The poller lives here and nowhere else: app.ts and the modules never start
// it, so importing the app in a test can never leave a timer running.
marketStack.poller.start();

const server: Server = createServer(app);

server.listen(env.PORT, () => {
  console.log(`PaperTrail API listening on http://localhost:${env.PORT}`);
  console.log(
    `Market poller: every ${env.PRICE_POLL_INTERVAL_SECONDS}s while the market is open ` +
      `(provider: ${env.MARKET_PROVIDER})`,
  );
});

let shuttingDown = false;

// Clean stop: no new polls, stop accepting connections, drain, disconnect.
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  marketStack.poller.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error('Error while disconnecting Prisma:', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
