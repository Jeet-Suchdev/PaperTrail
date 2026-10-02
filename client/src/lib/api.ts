// Error shape returned by every server route: { error: { code, message, details? } }
// (SPEC section 7). Kept as a class so UI code can `instanceof ApiError` and
// branch on status/code. status 0 means the request never reached the server.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

interface ErrorShape {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

// Messages from VALIDATION_ERROR details: [{ path, message }, ...].
export function detailMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  const messages: string[] = [];
  for (const item of details) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'message' in item &&
      typeof item.message === 'string'
    ) {
      messages.push(item.message);
    }
  }
  return messages;
}

// credentials: 'include' so the httpOnly session cookie travels with every
// request. The cookie is the only session — nothing is stored in web storage.
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch rejects only when the request never got an HTTP response.
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Please try again.');
  }

  // No body to parse (logout answers 204 with an empty response).
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  // Read as text and check the content type first — never hand an unknown
  // body straight to a JSON parser ("don't parse JSON blindly").
  const text = await response.text();
  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  let parsed: unknown = null;
  if (text !== '' && isJson) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const shaped: ErrorShape | null =
      typeof parsed === 'object' && parsed !== null ? (parsed as ErrorShape) : null;
    const message =
      typeof shaped?.error?.message === 'string'
        ? shaped.error.message
        : `Request failed (HTTP ${response.status})`;
    const code = typeof shaped?.error?.code === 'string' ? shaped.error.code : 'UNKNOWN';
    throw new ApiError(response.status, code, message, shaped?.error?.details);
  }

  if (parsed === null) {
    throw new ApiError(response.status, 'UNKNOWN', `Empty response (HTTP ${response.status})`);
  }

  return parsed as T;
}
