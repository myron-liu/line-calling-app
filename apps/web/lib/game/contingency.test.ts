import { describe, expect, test } from "bun:test";
import { lineForResult, emptyNextLineDrafts, type NextLineDrafts } from "./contingency";

const drafts = (over: Partial<NextLineDrafts>): NextLineDrafts => ({
  ...emptyNextLineDrafts(),
  ...over,
});

describe("lineForResult", () => {
  test("uses the 'no matter what' line when that outcome has none", () => {
    const d = drafts({ any: ["a", "b"] });
    expect(lineForResult(d, "us")).toEqual(["a", "b"]);
    expect(lineForResult(d, "them")).toEqual(["a", "b"]);
  });

  test("an outcome's own line beats the general one", () => {
    const d = drafts({ us: ["x"], any: ["a", "b"] });
    expect(lineForResult(d, "us")).toEqual(["x"]);
    expect(lineForResult(d, "them")).toEqual(["a", "b"]); // still falls back
  });

  test("empty everywhere carries nothing", () => {
    expect(lineForResult(emptyNextLineDrafts(), "us")).toEqual([]);
  });
});
