"use client";

// Phone-OTP sign-in/sign-up (§4.0), gating every route — this app has no
// public viewing left (see requirement in the auth plan): every team/game is
// scoped to its manager list, so a signed-out visitor gets nothing to look at
// anyway. This is a UX nicety only, not the real security boundary — that's
// entirely server-side (see apps/server/src/auth.ts), so a client bypass
// here just gets 401/403 from every API call.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { updateMyProfile } from "@/lib/storage/me";
import { formatUsPhone, usPhoneE164 } from "@/lib/phone";
import { UsPhoneInput } from "./us-phone-input";

export function AuthGate({ children }: { children: ReactNode }) {
  const { phone, loading } = useAuth();

  if (loading) return null;
  if (phone) return <>{children}</>;
  return <LoginScreen />;
}

type Mode = "signin" | "signup";

function LoginScreen() {
  const { signInWithPhone, verifyOtp, updateProfile } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [digits, setDigits] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") {
      codeRef.current?.focus();
    } else {
      (mode === "signup" ? firstNameRef : phoneRef).current?.focus();
    }
  }, [step, mode]);

  const e164 = usPhoneE164(digits);
  const phoneComplete = digits.length === 10;
  const canSubmitInfo =
    phoneComplete && (mode === "signin" || (firstName.trim() && lastName.trim()));

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const sendCode = async () => {
    if (!canSubmitInfo || submitting) return;
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
    if (error) {
      setSubmitting(false);
      setError(error);
      return;
    }
    if (mode === "signup") {
      // Supabase's own copy (drives "Hello, X!") and our DB's copy (drives
      // showing this name to other managers, see team-detail.tsx) — both
      // need the session that verifyOtp just established.
      await Promise.all([
        updateProfile(firstName.trim(), lastName.trim()),
        updateMyProfile(firstName.trim(), lastName.trim()),
      ]);
    }
    setSubmitting(false);
    // On success, onAuthStateChange fires and AuthGate re-renders past this screen.
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Line Calling</h1>

      {step === "phone" && (
        <div className="flex w-full rounded-lg border border-line-strong p-0.5 text-sm">
          <button
            onClick={() => switchMode("signin")}
            aria-pressed={mode === "signin"}
            className={`flex-1 rounded-md py-1.5 font-medium ${
              mode === "signin" ? "bg-inverse text-inverse-fg" : "text-muted"
            }`}
          >
            Sign in
          </button>
          <button
            onClick={() => switchMode("signup")}
            aria-pressed={mode === "signup"}
            className={`flex-1 rounded-md py-1.5 font-medium ${
              mode === "signup" ? "bg-inverse text-inverse-fg" : "text-muted"
            }`}
          >
            Sign up
          </button>
        </div>
      )}

      {step === "phone" ? (
        <div className="w-full space-y-3">
          {mode === "signup" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">First name</span>
                <input
                  ref={firstNameRef}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  className="rounded border border-line-strong px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Last name</span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  className="rounded border border-line-strong px-3 py-2"
                />
              </label>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Phone number</span>
            <UsPhoneInput digits={digits} onDigitsChange={setDigits} onEnter={sendCode} inputRef={phoneRef} />
          </label>
          <button
            onClick={sendCode}
            disabled={submitting || !canSubmitInfo}
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
