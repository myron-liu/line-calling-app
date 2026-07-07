import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Line Calling",
  description: "Ultimate frisbee line-calling app",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sideline use: prevent zoom jank on the thumb-driven controls.
  maximumScale: 1,
};

// Sets the theme class before first paint to avoid a flash of the wrong theme.
// Defaults to light unless the coach has explicitly chosen dark (no system-
// preference fallback).
const themeInit = `(function(){try{if(localStorage.getItem('lca:theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
