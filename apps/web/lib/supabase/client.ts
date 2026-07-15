// Browser-only Supabase client, used exclusively for phone-OTP auth (§4.0) —
// game data never goes through Supabase directly, only through the Bun API
// (see lib/api/client.ts). A singleton so every caller shares one session
// (and its localStorage-backed persistence/auto-refresh).

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
  );
}

export const supabase = createClient(url, anonKey);
