/**
 * CampusCab mobile API client.
 *
 * Talks to the same Next.js backend the website uses. The base URL is a public
 * value (never a secret); set EXPO_PUBLIC_API_URL to point a development build
 * at a local server. The session token is injected per request from the auth
 * provider so no module-level state can go stale.
 */

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? 'https://campuscab-pi.vercel.app'
).replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let tokenReader: () => string | null = () => null;
export function setTokenReader(reader: () => string | null) {
  tokenReader = reader;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (login, register, recovery). */
  anonymous?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false, timeoutMs = 20000, signal } = options;

  const token = anonymous ? null : tokenReader();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort());
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('The request timed out. Check your connection and try again.', 0);
    }
    throw new ApiError('No internet connection. Check your network and try again.', 0);
  }
  clearTimeout(timeout);

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const data = (payload ?? {}) as { error?: string; message?: string; code?: string };
    throw new ApiError(
      data.error || data.message || `Request failed (${response.status})`,
      response.status,
      data.code
    );
  }

  return (payload ?? {}) as T;
}

export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}
