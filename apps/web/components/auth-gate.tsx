"use client";

// Phone-OTP sign-in (§4.0), gating every route — this app has no public
// viewing left (see requirement in the auth plan): every team/game is scoped
// to its manager list, so a signed-out visitor gets nothing to look at
// anyway. This is a UX nicety only, not the real security boundary — that's
// entirely server-side (see apps/server/src/auth.ts), so a client bypass
// here just gets 401/403 from every API call.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";

export function AuthGate({ children }: { children: ReactNode }) {
  const { phone, loading } = useAuth();

  if (loading) return null;
  if (phone) return <>{children}</>;
  return <LoginScreen />;
}

/** US-only formatting for now — a leading "+1" is assumed and baked into the
 *  submitted E.164 number rather than typed, since every manager so far is a
 *  US number. Revisit if/when a non-US manager needs to sign in. */
function formatUsPhone(digits: string): string {
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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
    (step === "phone" ? phoneRef : codeRef).current?.focus();
  }, [step]);

  const e164 = `+1${digits}`;
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
    if (error) setError(error);
    // On success, onAuthStateChange fires and AuthGate re-renders past this screen.
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Line Calling</h1>

      {step === "phone" ? (
        <div className="w-full space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Phone number</span>
            <div className="flex items-center rounded border border-line-strong focus-within:ring-1 focus-within:ring-fg">
              <span className="pl-3 text-muted">+1</span>
              <input
                ref={phoneRef}
                type="tel"
                autoComplete="tel-national"
                inputMode="numeric"
                value={formatUsPhone(digits)}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
                placeholder="(415) 555-0123"
                className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none"
              />
            </div>
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
