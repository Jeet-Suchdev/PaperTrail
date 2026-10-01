import { app } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

app.listen(env.PORT, () => {
  console.log(`PaperTrail API listening on http://localhost:${env.PORT}`);
});

// Leave the database connection cleanly on Ctrl-C / container stop.
async function shutdown(): Promise<void> {
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
