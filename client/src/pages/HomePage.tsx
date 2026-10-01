import { useHealth } from '../features/health/api';

function StatusBadge({ status }: { status: 'ok' | 'degraded' }) {
  const isOk = status === 'ok';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${
        isOk ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
      }`}
    >
      <span aria-hidden="true">{isOk ? '✓' : '✕'}</span>
      {isOk ? 'OK' : 'Degraded'}
    </span>
  );
}

function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function HomePage() {
  const { data, error, isPending, isFetching, refetch } = useHealth();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">PaperTrail</h1>
        <p className="mt-1 text-slate-600">
          Paper trading for Indian markets — foundation slice (Slice 0).
        </p>
      </header>

      <section
        aria-labelledby="health-heading"
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="health-heading" className="text-lg font-semibold">
            System health
          </h2>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {isPending && (
          <p className="mt-4 animate-pulse text-slate-500" role="status">
            Checking API and database…
          </p>
        )}

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-800">Could not reach the API</p>
            <p className="mt-1 text-sm text-red-700">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <p className="mt-2 text-sm text-red-700">
              Is the server running? Start it with{' '}
              <code className="rounded bg-red-100 px-1 py-0.5">pnpm --filter server dev</code>.
            </p>
          </div>
        )}

        {data && (
          <>
            <div className="mt-4 flex items-center gap-3">
              <StatusBadge status={data.status} />
              <span className="text-sm text-slate-500">
                API{' '}
                {data.status === 'ok'
                  ? 'and PostgreSQL are responding'
                  : 'reachable, database is not'}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-sm text-slate-500">Database</dt>
                <dd className="font-medium">{data.db === 'up' ? '▲ up' : '▼ down'}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">Response time</dt>
                <dd className="font-medium">{data.latencyMs} ms</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">Server uptime</dt>
                <dd className="font-medium">{formatUptime(data.uptimeSeconds)}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">Checked at</dt>
                <dd className="font-medium">
                  {new Date(data.timestamp).toLocaleTimeString('en-IN')}
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>
    </main>
  );
}
