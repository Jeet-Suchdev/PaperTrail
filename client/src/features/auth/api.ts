import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

// GET /api/auth/me — the only shape with a wallet.
export interface MeResponse {
  user: PublicUser;
  wallet: { cashPaise: number };
}

// POST /auth/login and /auth/register return { user } today; the wallet
// stays optional so a richer response can be cached without a code change.
export interface AuthResponse {
  user: PublicUser;
  wallet?: { cashPaise: number };
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

// The session lives only in the httpOnly cookie — the query proves whether
// it is valid. A 401 resolves as an ApiError the UI branches on ("not
// logged in"); it is a normal state, never something to toast about.
export function useAuth() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch<MeResponse>('/api/auth/me'),
    retry: false,
    refetchOnWindowFocus: true,
  });
}

// Only cache a complete { user, wallet }. If the auth response has no
// wallet, refetch /me instead of guessing the balance.
function cacheAuthResponse(data: AuthResponse, queryClient: QueryClient): void {
  if (data.wallet === undefined) {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    return;
  }
  queryClient.setQueryData<MeResponse>(['auth', 'me'], {
    user: data.user,
    wallet: data.wallet,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<AuthResponse>('/api/auth/login', { method: 'POST', body: input }),
    onSuccess: (data) => cacheAuthResponse(data, queryClient),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      apiFetch<AuthResponse>('/api/auth/register', { method: 'POST', body: input }),
    onSuccess: (data) => cacheAuthResponse(data, queryClient),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/auth/logout', { method: 'POST' }),
    // Wipe every cached query so no previous user's data survives.
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
