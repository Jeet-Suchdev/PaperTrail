import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth, useLogin } from '../features/auth/api';
import { ApiError, detailMessages } from '../lib/api';

// Generic on purpose: identical for unknown email and wrong password, so
// the form never hints at which emails exist.
const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const auth = useAuth();
  const login = useLogin();

  // Already logged in (cookie valid) → straight to the dashboard.
  if (auth.data) {
    return <Navigate to="/dashboard" replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    login.reset();

    // Client-side mirror of the server's login rules — the server stays
    // the source of truth; this only saves a round trip.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (password === '') {
      setFormError('Enter your password.');
      return;
    }
    login.mutate({ email, password });
  }

  const error = login.error;
  let serverError: string | null = null;
  if (error instanceof ApiError) {
    if (error.status === 401) {
      serverError = GENERIC_LOGIN_ERROR;
    } else if (error.status === 400 && detailMessages(error.details).length > 0) {
      serverError = detailMessages(error.details).join(' ');
    } else {
      serverError = error.message;
    }
  } else if (error) {
    serverError = 'Something went wrong. Please try again.';
  }

  const shownError = formError ?? serverError;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">Log in to PaperTrail</h1>
        <p className="mt-1 text-sm text-slate-600">
          Paper trading for Indian markets. No real money involved.
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>

          {shownError && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {shownError}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {login.isPending ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-600">
          No account yet?{' '}
          <Link to="/register" className="font-medium text-slate-900 underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
