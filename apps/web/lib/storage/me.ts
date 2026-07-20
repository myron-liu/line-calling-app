// The caller's own display name (§4.0's User) — a denormalized copy of the
// name Supabase Auth holds in the session's user_metadata (see
// lib/auth/auth-context.tsx's updateProfile), persisted server-side so other
// managers' names can be joined into a team's manager list without needing
// the Supabase Admin API. Call once, right after sign-up verifies the OTP.

import type { User } from "@shared/game-rules";
import { api } from "../api/client";

export function updateMyProfile(firstName: string, lastName: string): Promise<User> {
  return api.put<User>("/me/profile", { firstName, lastName });
}
