// Thin fetch wrapper for the Bun API server. Setup data (teams, players,
// tournaments, saved lines, game creation) is online-only by design (§13.12),
// so these calls are allowed to reject — callers surface the error rather than
// falling back to a local cache.

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The parsed JSON error body, if any — e.g. a 409 sync conflict carries
     *  the server's current full game state here so the caller can reconcile
     *  without a second round trip. */
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      message =
        (parsed as { message?: string; error?: string }).message ??
        (parsed as { message?: string; error?: string }).error ??
        message;
    } catch {
      // not JSON; use raw text
    }
    throw new ApiError(res.status, message, parsed);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
