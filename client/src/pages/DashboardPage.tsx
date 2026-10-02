import { useNavigate } from 'react-router';
import { useAuth, useLogout } from '../features/auth/api';
import { formatInr } from '../lib/money';

export function DashboardPage() {
  const auth = useAuth();
  const logout = useLogout();
  const navigate = useNavigate();

  // ProtectedRoute only renders us once /me has resolved with data;
  // this guard exists for TypeScript only.
  if (!auth.data) {
    return null;
  }

  const { user, wallet } = auth.data;

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => {
        navigate('/login', { replace: true });
      },
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back, {user.name}</h1>
          <p className="mt-1 text-slate-600">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={logout.isPending}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
        >
          {logout.isPending ? 'Logging out…' : 'Log out'}
        </button>
      </header>

      <section
        aria-labelledby="balance-heading"
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 id="balance-heading" className="text-lg font-semibold">
          Virtual cash
        </h2>
        <p className="mt-2 text-4xl font-bold tracking-tight text-slate-900">
          {formatInr(wallet.cashPaise)}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Paper money only — trades in later slices. Real brokers are never connected.
        </p>
      </section>
    </main>
  );
}
