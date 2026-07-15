"use client";

// Phone-OTP sign-in (§4.0), gating every route — this app has no public
// viewing left (see requirement in the auth plan): every team/game is scoped
// to its manager list, so a signed-out visitor gets nothing to look at
// anyway. This is a UX nicety only, not the real security boundary — that's
// entirely server-side (see apps/server/src/auth.ts), so a client bypass
// here just gets 401/403 from every API call.

import { useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";

export function AuthGate({ children }: { children: ReactNode }) {
  const { phone, loading } = useAuth();

  if (loading) return null;
  if (phone) return <>{children}</>;
  return <LoginScreen />;
}

function LoginScreen() {
  const { signInWithPhone, verifyOtp } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setSubmitting(true);
    setError(null);
    const { error } = await signInWithPhone(phoneInput.trim());
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    setStep("code");
  };

  const verify = async () => {
    setSubmitting(true);
    setError(null);
    const { error } = await verifyOtp(phoneInput.trim(), code.trim());
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
            <input
              type="tel"
              autoComplete="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="+14155550123"
              className="rounded border border-line-strong px-3 py-2"
            />
          </label>
          <button
            onClick={sendCode}
            disabled={submitting || !phoneInput.trim()}
            className="w-full rounded-lg bg-inverse py-2.5 font-medium text-inverse-fg disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Send code"}
          </button>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <p className="text-sm text-muted">
            Enter the code texted to {phoneInput.trim()}.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
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
