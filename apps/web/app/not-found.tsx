import Link from "next/link";

export default function NotFound() {
  return (
    <section className="space-y-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted">That page doesn’t exist.</p>
      <Link href="/teams" className="text-fg underline">
        Back to your teams
      </Link>
    </section>
  );
}
