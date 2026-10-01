// Error shape returned by every server route: { error: { code, message, details? } }
// (SPEC section 7). Kept as a class so UI code can `instanceof ApiError` and
// show the message inline.
export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

interface ErrorShape {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(path);

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (e.g. proxy/infrastructure error) — handled below.
  }

  if (!response.ok) {
    const shaped: ErrorShape | null =
      typeof body === 'object' && body !== null ? (body as ErrorShape) : null;
    const message =
      typeof shaped?.error?.message === 'string'
        ? shaped.error.message
        : `Request failed (HTTP ${response.status})`;
    const code = typeof shaped?.error?.code === 'string' ? shaped.error.code : 'UNKNOWN';
    throw new ApiError(message, code, shaped?.error?.details);
  }

  if (body === null) {
    throw new ApiError(`Empty response (HTTP ${response.status})`, 'UNKNOWN');
  }

  return body as T;
}
