import { Navigate } from 'react-router';
import { useAuth } from '../features/auth/api';

// "/" is a router-level fork: to the dashboard when the cookie session is
// valid, to /login otherwise.
export function RootRedirect() {
  const { data, isPending } = useAuth();

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p role="status" className="animate-pulse text-slate-500">
          Checking your session…
        </p>
      </main>
    );
  }

  return data ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />;
}
