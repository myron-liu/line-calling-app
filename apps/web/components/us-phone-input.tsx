"use client";

import type { Ref } from "react";
import { formatUsPhone } from "@/lib/phone";

/** "+1" prefix + a digits-only, auto-formatted (415) 555-0123 field — shared
 *  between the sign-in screen and the team managers list so adding a phone
 *  number looks and behaves the same everywhere. */
export function UsPhoneInput({
  digits,
  onDigitsChange,
  onEnter,
  inputRef,
  placeholder = "(415) 555-0123",
}: {
  digits: string;
  onDigitsChange: (digits: string) => void;
  onEnter?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center rounded border border-line-strong focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500">
      <span className="pl-3 text-muted">+1</span>
      <input
        ref={inputRef}
        type="tel"
        autoComplete="tel-national"
        inputMode="numeric"
        value={formatUsPhone(digits)}
        onChange={(e) => onDigitsChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none"
      />
    </div>
  );
}
