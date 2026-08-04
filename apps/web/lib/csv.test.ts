import { describe, expect, test } from "bun:test";
import { csvFilename, csvPercent, toCsv } from "./csv";

describe("toCsv", () => {
  test("joins rows and fields", () => {
    expect(toCsv([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2");
  });

  test("quotes fields containing a comma, quote or newline", () => {
    expect(toCsv([["Smith, Alex"]])).toBe('"Smith, Alex"');
    expect(toCsv([['He said "go"']])).toBe('"He said ""go"""');
    expect(toCsv([["line one\nline two"]])).toBe('"line one\nline two"');
  });

  test("empty for null and undefined, not the string 'null'", () => {
    expect(toCsv([[null, undefined, 0]])).toBe(",,0");
  });

  test("neutralises formula injection from free text", () => {
    // A point note or nickname starting with these is executed on open by
    // Excel and Sheets unless it's defused.
    for (const evil of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const out = toCsv([[evil]]);
      expect(out.startsWith('"\t')).toBe(true);
      expect(out).toContain(evil);
    }
  });

  test("negative numbers export as numbers, not defused text", () => {
    // Plus/minus is legitimately negative; tab-prefixing it would make the
    // column text and break sorting and summing in the spreadsheet.
    expect(toCsv([[-3]])).toBe("-3");
  });

  test("but a string that merely looks numeric is still defused", () => {
    expect(toCsv([["-3+5"]])).toBe('"\t-3+5"');
  });
});

describe("csvPercent", () => {
  test("whole numbers, and empty when there's nothing to average", () => {
    expect(csvPercent(0.4)).toBe(40);
    expect(csvPercent(0)).toBe(0);
    expect(csvPercent(null)).toBe("");
  });
});

describe("csvFilename", () => {
  test("slugs the parts into something saveable", () => {
    expect(csvFilename("Sectionals: Day 1", "stats")).toBe("Sectionals-Day-1-stats.csv");
  });

  test("falls back rather than producing a bare extension", () => {
    expect(csvFilename("///")).toBe("export.csv");
  });
});
