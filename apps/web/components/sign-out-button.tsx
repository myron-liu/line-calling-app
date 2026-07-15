"use client";

import { useAuth } from "@/lib/auth/auth-context";

export function SignOutButton() {
  const { phone, signOut } = useAuth();
  if (!phone) return null;

  return (
    <button
      onClick={() => signOut()}
      title={phone}
      className="rounded-md border border-line-strong px-2 py-1 text-sm text-muted hover:text-fg"
    >
      Sign out
    </button>
  );
}
