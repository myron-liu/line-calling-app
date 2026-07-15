import { redirect } from "next/navigation";

// Home goes straight to the teams list (AuthGate in the root layout handles
// signing in first if needed — see components/app-shell.tsx).
export default function HomePage() {
  redirect("/teams");
}
