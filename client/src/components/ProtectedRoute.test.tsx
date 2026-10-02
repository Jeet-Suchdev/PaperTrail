// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProtectedRoute } from './ProtectedRoute';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderProtected() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <p>secret dashboard</p>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProtectedRoute', () => {
  it('shows a loading state while /me is pending (no flash of the login page)', () => {
    // Never resolves — the route must sit on the loading state.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderProtected();

    expect(screen.getByRole('status').textContent).toContain('Checking your session');
    expect(screen.queryByText('login page')).toBeNull();
    expect(screen.queryByText('secret dashboard')).toBeNull();
  });

  it('redirects to /login only on a 401 from /me', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
            401,
          ),
        ),
    );

    renderProtected();

    expect(await screen.findByText('login page')).toBeTruthy();
    expect(screen.queryByText('secret dashboard')).toBeNull();
  });

  it('renders the protected content when /me succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            user: { id: 'u1', email: 'alice@papertrail.test', name: 'Alice' },
            wallet: { cashPaise: 100000000 },
          },
          200,
        ),
      ),
    );

    renderProtected();

    expect(await screen.findByText('secret dashboard')).toBeTruthy();
    expect(screen.queryByText('login page')).toBeNull();
  });
});
