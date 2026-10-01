import { prisma } from '../../lib/prisma';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptimeSeconds: number;
  latencyMs: number;
  timestamp: string;
}

// Slice 0's proof of DB connectivity: SELECT 1 must round-trip to Postgres
// through Prisma's driver adapter. A failure degrades the report instead of
// crashing the server.
export async function getHealth(): Promise<HealthReport> {
  const startedAt = Date.now();

  let db: 'up' | 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch (err) {
    console.error('Health check: database query failed', err);
    db = 'down';
  }

  return {
    status: db === 'up' ? 'ok' : 'degraded',
    db,
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };
}
