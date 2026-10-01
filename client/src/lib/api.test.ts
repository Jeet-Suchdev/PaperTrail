import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api';

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
  it('returns the parsed body on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
  });

  it('throws ApiError with the code and message from the error shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Nope' } }, 404)),
    );

    await expect(apiFetch('/api/missing')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
      message: 'Nope',
    });
  });

  it('falls back to a status-based message when the body is not the error shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));

    await expect(apiFetch('/api/boom')).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Request failed (HTTP 500)',
    });
  });

  it('throws ApiError instead of a JSON parse error when a 200 body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));

    await expect(apiFetch('/api/health')).rejects.toBeInstanceOf(ApiError);
  });
});
