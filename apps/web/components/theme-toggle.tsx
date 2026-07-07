"use client";

import { useEffect, useState } from "react";

const KEY = "lca:theme";

// Toggles the `dark` class on <html> and persists the choice. The initial class
// is set pre-hydration by the inline script in the root layout (no flash).
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-md border border-line-strong px-2 py-1 text-sm text-muted hover:text-fg"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}
