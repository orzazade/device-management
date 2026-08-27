export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'devicedesk.token';
/** Fired once by api() when the server says the session is no longer valid. */
export const SESSION_EXPIRED_EVENT = 'devicedesk:session-expired';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (opts.formData ? 'POST' : 'GET'),
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(tokenStore.get() ? { authorization: `Bearer ${tokenStore.get()}` } : {}),
    },
    body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      // Don't navigate from here: the session owner (AuthProvider) listens
      // for this and moves the user to /login through the router, keeping
      // the SPA, the query cache and the "return to" location intact.
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    const msg = Array.isArray(body?.message)
      ? body.message.join('; ')
      : (body?.message ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, msg);
  }
  return body as T;
}
