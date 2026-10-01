import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start gap-4 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="text-slate-600">That route does not exist.</p>
      <Link
        to="/"
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        Back to home
      </Link>
    </main>
  );
}
