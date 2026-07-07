"use client";

// Global error boundary (§16). Must be a client component.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="space-y-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-lg bg-inverse px-4 py-2 font-medium text-inverse-fg hover:opacity-90"
      >
        Try again
      </button>
    </section>
  );
}
