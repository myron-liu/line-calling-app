// Verifies a Supabase Auth (phone OTP) JWT and extracts the caller's verified
// phone number — the durable identity every authorization check keys off of
// (see db/queries.ts's team_managers functions). This project's Supabase
// Auth uses asymmetric signing keys (confirmed via its JWKS endpoint), so
// verification is against the project's public JWKS rather than a shared
// secret — no server-side Supabase credentials needed at all.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "./http";

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not set");

const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

/** Supabase strips the leading "+" when storing/returning a phone-auth JWT's
 *  `phone` claim (e.g. "14155550123", not "+14155550123") — re-prepend it so
 *  this matches the E.164 form stored in team_managers.phone. */
function toE164(rawPhone: string): string {
  return rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
}

/** Extracts the bearer token from the Authorization header, falling back to
 *  a `?token=` query param — native EventSource (used by the two SSE routes)
 *  can't set custom headers, so it authenticates via the URL instead. */
function extractToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return new URL(req.url).searchParams.get("token");
}

/** Verifies the caller's session and returns their verified phone number
 *  (E.164). Throws HttpError(401) for any missing/invalid/expired token, or
 *  a token with no verified phone (e.g. an anonymous-auth session). */
export async function verifyAuthPhone(req: Request): Promise<string> {
  const token = extractToken(req);
  if (!token) throw new HttpError(401, "Missing authorization");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS));
  } catch {
    throw new HttpError(401, "Invalid or expired session");
  }

  const phone = payload.phone;
  if (typeof phone !== "string" || phone.length === 0) {
    throw new HttpError(401, "No verified phone number on this session");
  }
  return toE164(phone);
}
