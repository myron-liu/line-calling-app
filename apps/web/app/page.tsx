import { redirect } from "next/navigation";

// v0 is public — no auth. Home goes straight to the teams list.
export default function HomePage() {
  redirect("/teams");
}
