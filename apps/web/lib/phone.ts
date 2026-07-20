// US-only phone formatting for now — every manager so far is a US number, so
// a leading "+1" is assumed/baked in rather than typed. Revisit if/when a
// non-US manager needs to be added.

export function formatUsPhone(digits: string): string {
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function usPhoneE164(digits: string): string {
  return `+1${digits}`;
}
