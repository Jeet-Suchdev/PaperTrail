import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

// Mirror of HealthReport in server/src/modules/health/service.ts.
// There is no shared package yet, so this interface is kept in sync by hand.
export interface HealthReport {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptimeSeconds: number;
  latencyMs: number;
  timestamp: string;
}

export function fetchHealth(): Promise<HealthReport> {
  return apiFetch<HealthReport>('/api/health');
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });
}
