/**
 * CSV serialisation for the stats exports.
 *
 * Everything here is a pure string transform; the browser-only download half
 * lives in downloadCsv at the bottom.
 */

export type CsvValue = string | number | null | undefined;

/**
 * Escape one field.
 *
 * Two separate concerns:
 *
 *  - RFC 4180 quoting, for fields containing a comma, quote or newline.
 *  - Formula injection. A field starting `=`, `+`, `-` or `@` is executed as a
 *    formula by Excel and Sheets when the file is opened, and player names and
 *    point notes are free text a coach typed. Prefixing a tab neutralises it
 *    while still displaying the original text.
 */
function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  // Numbers come from our own aggregates, never from a text field, so they
  // skip the formula guard — otherwise a plus/minus of -3 would export as
  // text and stop the column from sorting or summing.
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@]/.test(value) ? `\t${value}` : value;
  return /[",\n\r\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows to CSV text. The first row is treated as the header by convention,
 *  but nothing here depends on that. */
export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
}

/** Percentages export as whole numbers, and as empty rather than 0 when
 *  there's nothing to average — same distinction the tables draw with "—". */
export function csvPercent(ratio: number | null): CsvValue {
  return ratio === null ? "" : Math.round(ratio * 100);
}

/** Trims a filename down to something a filesystem will accept, keeping it
 *  recognisable — a tournament called "Sectionals: Day 1" shouldn't produce a
 *  file nobody can save. */
export function csvFilename(...parts: string[]): string {
  const slug = parts
    .join("-")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${slug || "export"}.csv`;
}

/** Hands the file to the browser. The BOM is what makes Excel read it as
 *  UTF-8 rather than mangling accented names. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
