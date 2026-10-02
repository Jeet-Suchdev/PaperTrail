import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth, useRegister } from '../features/auth/api';
import { ApiError, detailMessages } from '../lib/api';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const auth = useAuth();
  const register = useRegister();

  // Already logged in (cookie valid) → straight to the dashboard.
  if (auth.data) {
    return <Navigate to="/dashboard" replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    register.reset();

    // Client-side mirror of the server's register rules (name 2-64, valid
    // email, password min 10) — the server stays the source of truth.
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 64) {
      setFormError('Name must be between 2 and 64 characters.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (password.length < 10) {
      setFormError('Password must be at least 10 characters.');
      return;
    }
    if (password.length > 128) {
      setFormError('Password must be at most 128 characters.');
      return;
    }

    register.mutate({ name: trimmedName, email, password });
  }

  const error = register.error;
  let serverError: string | null = null;
  if (error instanceof ApiError) {
    if (error.status === 409) {
      serverError = 'That email is already registered.';
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
        <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-slate-600">Start with ₹10,00,000 in virtual cash.</p>

        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoComplete="name"
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>

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
              maxLength={254}
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
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>
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
            disabled={register.isPending}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {register.isPending ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-slate-900 underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
