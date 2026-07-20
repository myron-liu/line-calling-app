"use client";

// Phone-OTP sign-in (§4.0), gating every route — this app has no public
// viewing left: every team/game is scoped to its manager list, so a
// signed-out visitor gets nothing to look at anyway. This is a UX nicety
// only, not the real security boundary — that's entirely server-side (see
// apps/server/src/auth.ts), so a client bypass here just gets 401/403 from
// every API call.
//
// A phone-verified session with no name yet (a brand-new account, or an
// older one from before name capture existed) is forced through
// CompleteProfileScreen before it reaches the app. See teams-list.tsx for
// the equivalent "change your name later" control.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { updateMyProfile } from "@/lib/storage/me";
import { formatUsPhone, usPhoneE164 } from "@/lib/phone";
import { UsPhoneInput } from "./us-phone-input";

export function AuthGate({ children }: { children: ReactNode }) {
  const { phone, loading, session } = useAuth();

  if (loading) return null;
  if (!phone) return <LoginScreen />;
  const hasName = Boolean(session?.user.user_metadata?.first_name);
  if (!hasName) return <CompleteProfileScreen />;
  return <>{children}</>;
}

function LoginScreen() {
  const { signInWithPhone, verifyOtp } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [digits, setDigits] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (step === "code" ? codeRef : phoneRef).current?.focus();
  }, [step]);

  const e164 = usPhoneE164(digits);
  const phoneComplete = digits.length === 10;

  const sendCode = async () => {
    if (!phoneComplete || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error } = await signInWithPhone(e164);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    setStep("code");
  };

  const verify = async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error } = await verifyOtp(e164, code.trim());
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    // On success, onAuthStateChange fires and AuthGate re-renders past this
    // screen (or into CompleteProfileScreen if this account has no name yet).
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Line Calling</h1>

      {step === "phone" ? (
        <div className="w-full space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Phone number</span>
            <UsPhoneInput digits={digits} onDigitsChange={setDigits} onEnter={sendCode} inputRef={phoneRef} />
          </label>
          <button
            onClick={sendCode}
            disabled={submitting || !phoneComplete}
            className="w-full rounded-lg bg-inverse py-2.5 font-medium text-inverse-fg disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Send code"}
          </button>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <p className="text-sm text-muted">
            Enter the code texted to +1 {formatUsPhone(digits)}.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Code</span>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="123456"
              className="rounded border border-line-strong px-3 py-2"
            />
          </label>
          <button
            onClick={verify}
            disabled={submitting || !code.trim()}
            className="w-full rounded-lg bg-inverse py-2.5 font-medium text-inverse-fg disabled:opacity-40"
          >
            {submitting ? "Verifying…" : "Verify"}
          </button>
          <button
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
            className="w-full text-sm text-muted hover:text-fg"
          >
            Use a different number
          </button>
        </div>
      )}

      {error && <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function CompleteProfileScreen() {
  const { updateProfile } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstNameRef.current?.focus();
  }, []);

  const canSubmit = Boolean(firstName.trim() && lastName.trim());

  const save = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Supabase's own copy (drives "Hello, X!") and our DB's copy (drives
      // showing this name to other managers, see team-detail.tsx) — both
      // need the session verifyOtp already established.
      await Promise.all([
        updateProfile(firstName.trim(), lastName.trim()),
        updateMyProfile(firstName.trim(), lastName.trim()),
      ]);
      // onAuthStateChange fires from updateProfile's updateUser call, so
      // AuthGate re-renders past this screen once it sees the new name.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Welcome!</h1>
      <p className="text-center text-sm text-muted">
        What&apos;s your name? Other managers on your teams will see it.
      </p>
      <div className="w-full space-y-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">First name</span>
          <input
            ref={firstNameRef}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Last name</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <button
          onClick={save}
          disabled={submitting || !canSubmit}
          className="w-full rounded-lg bg-inverse py-2.5 font-medium text-inverse-fg disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Continue"}
        </button>
        {error && <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
