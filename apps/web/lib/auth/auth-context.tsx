"use client";

// Tracks the current Supabase phone-auth session (§4.0) and exposes the
// phone-OTP sign-in flow. The Supabase client persists/refreshes the session
// in localStorage on its own — this context just mirrors that state into
// React and re-renders on change (see supabase.auth.onAuthStateChange).

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase/client";

interface AuthContextValue {
  session: Session | null;
  /** The verified E.164 phone number for the current session, if any. */
  phone: string | null;
  /** True only while the initial session is still being read on mount. */
  loading: boolean;
  signInWithPhone: (phone: string) => Promise<{ error: string | null }>;
  verifyOtp: (phone: string, code: string) => Promise<{ error: string | null }>;
  /** Stores a display name on the session's user_metadata (§4.0 sign-up) —
   *  there's no separate profile table, so this is the only place a name
   *  lives. Requires an active session (call after verifyOtp succeeds). */
  updateProfile: (firstName: string, lastName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signInWithPhone = async (phone: string) => {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    return { error: error?.message ?? null };
  };

  const verifyOtp = async (phone: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });
    return { error: error?.message ?? null };
  };

  const updateProfile = async (firstName: string, lastName: string) => {
    const { error } = await supabase.auth.updateUser({
      data: { first_name: firstName, last_name: lastName },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const phone =
    typeof session?.user.phone === "string" && session.user.phone.length > 0
      ? `+${session.user.phone}`
      : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        phone,
        loading,
        signInWithPhone,
        verifyOtp,
        updateProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
