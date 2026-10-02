import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../features/auth/api';
import { ApiError } from '../lib/api';

// Gate for /dashboard: decide from the /me query, never from a token in
// web storage (there is none — the cookie is the session).
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data, error, isPending, refetch } = useAuth();

  // While /me is in flight show a loading state — no flash of the login page.
  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p role="status" className="animate-pulse text-slate-500">
          Checking your session…
        </p>
      </main>
    );
  }

  if (data) {
    return children;
  }

  // Only a 401 means "not logged in" → replace with /login.
  if (error instanceof ApiError && error.status === 401) {
    return <Navigate to="/login" replace />;
  }

  // Network failure or 5xx: redirecting would hide the problem — say so
  // and offer a retry instead.
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div role="alert" className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="font-semibold text-red-800">Could not check your session</p>
        <p className="mt-1 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
