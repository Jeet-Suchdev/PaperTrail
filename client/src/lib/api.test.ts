import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, detailMessages } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns the parsed body on success and always sends credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('serialises bodies as JSON with a content-type header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/auth/login', { method: 'POST', body: { email: 'a@b.dev' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.dev' }));
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.credentials).toBe('include');
  });

  it('returns undefined for 204 without trying to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiFetch<void>('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws ApiError with status, code, and message from the error shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Nope' } }, 404)),
    );

    await expect(apiFetch('/api/missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Nope',
    });
  });

  it('falls back to a status-based message when the body is not the error shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));

    await expect(apiFetch('/api/boom')).rejects.toMatchObject({
      status: 500,
      code: 'UNKNOWN',
      message: 'Request failed (HTTP 500)',
    });
  });

  it('throws ApiError instead of a JSON parse error when a 200 body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));

    await expect(apiFetch('/api/health')).rejects.toBeInstanceOf(ApiError);
  });

  it('wraps a network failure in ApiError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiFetch('/api/health')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });
});

describe('detailMessages', () => {
  it('extracts messages from VALIDATION_ERROR details', () => {
    expect(
      detailMessages([
        { path: 'password', message: 'Too small: expected string to have >=10 characters' },
        { path: 'email', message: 'Invalid email address' },
      ]),
    ).toEqual(['Too small: expected string to have >=10 characters', 'Invalid email address']);
  });

  it('returns an empty list for anything else', () => {
    expect(detailMessages(undefined)).toEqual([]);
    expect(detailMessages('nope')).toEqual([]);
    expect(detailMessages([{ path: 'x' }])).toEqual([]);
  });
});
