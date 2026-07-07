// SSR-safe, typed localStorage wrapper. All reads fall back gracefully; all writes
// report success so callers can surface a "storage full" state (§10) rather than
// silently losing the game log.

const canUseStorage = (): boolean =>
  typeof window !== "undefined" && !!window.localStorage;

export function read<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch (err) {
    console.error(`[storage] read failed for ${key}`, err);
    return fallback;
  }
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "quota" | "unknown" };

export function write<T>(key: string, value: T): WriteResult {
  if (!canUseStorage()) return { ok: false, reason: "unavailable" };
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    const quota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED");
    console.error(`[storage] write failed for ${key}`, err);
    return { ok: false, reason: quota ? "quota" : "unknown" };
  }
}

export function remove(key: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    console.error(`[storage] remove failed for ${key}`, err);
  }
}
