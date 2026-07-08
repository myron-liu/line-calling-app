// SSR-safe, typed localStorage wrapper. All reads fall back gracefully; all writes
// report success so callers can surface a "storage full" state (§10) rather than
// silently losing the game log.

import { NAMESPACE, keys } from "./keys";

const canUseStorage = (): boolean =>
  typeof window !== "undefined" && !!window.localStorage;

// Every deployed build gets a fresh NEXT_PUBLIC_APP_VERSION baked in at
// Docker build time (see apps/web/Dockerfile) — a build-time timestamp, not
// something a developer has to remember to bump. On first load under a new
// build, wipe every `lca:`-prefixed key rather than trust old cached JSON
// against new code's assumptions about its shape (localStorage.getItem has
// no schema, so a renamed/restructured field would otherwise only surface as
// a runtime crash, not a type error). Local dev (no Docker build) falls back
// to a fixed "dev" version, so this never fires outside a real deploy.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const APP_VERSION_KEY = `${NAMESPACE}:app-version`;

function sweepStaleStorageOnNewBuild(): void {
  if (!canUseStorage()) return;
  try {
    if (window.localStorage.getItem(APP_VERSION_KEY) === APP_VERSION) return;

    // Never discard a not-yet-synced write — a new build landing while a
    // coach has pending local changes (offline, or mid-flush) shouldn't cost
    // them a point. Leave everything alone for this load; the check runs
    // again next load, once the outbox has drained and this is a no-op risk.
    const pending = window.localStorage.getItem(keys.outbox);
    if (pending && pending !== "[]") return;

    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(`${NAMESPACE}:`)) window.localStorage.removeItem(k);
    }
    window.localStorage.setItem(APP_VERSION_KEY, APP_VERSION);
  } catch (err) {
    console.error("[storage] version sweep failed", err);
  }
}

sweepStaleStorageOnNewBuild();

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
