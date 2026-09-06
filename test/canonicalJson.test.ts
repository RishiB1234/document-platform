import { describe, expect, it } from "vitest";

import { CanonicalJsonError, canonicalJson } from "../src/document/canonicalJson";

describe("canonicalJson", () => {
  it("produces identical text for identical values built in different key orders", () => {
    // The guarantee everything else rests on. A record parsed from the document
    // and the same record built by a form must serialize to the same bytes.
    const parsed = { weekEnding: "2026-08-30", steps: 52000, heartPoints: 260 };
    const built = { heartPoints: 260, steps: 52000, weekEnding: "2026-08-30" };
    expect(canonicalJson(built)).toBe(canonicalJson(parsed));
  });

  it("sorts keys at every depth, not just the root", () => {
    const left = { outer: { b: 1, a: { d: 2, c: 3 } } };
    const right = { outer: { a: { c: 3, d: 2 }, b: 1 } };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson(left).indexOf('"a"')).toBeLessThan(canonicalJson(left).indexOf('"b"'));
  });

  it("sorts by UTF-16 code unit, so capitals precede lowercase", () => {
    // Pins the ordering that bare .sort() gives. localeCompare would put "a"
    // before "B" here, which is the substitution this test exists to catch.
    const text = canonicalJson({ a: 1, B: 2 });
    expect(text.indexOf('"B"')).toBeLessThan(text.indexOf('"a"'));
  });

  it("preserves array order and never sorts elements", () => {
    // Array order is semantic. Sorting weeks here would rewrite the document on
    // its first save.
    const weeks = [{ weekEnding: "2026-08-30" }, { weekEnding: "2026-08-16" }, { weekEnding: "2026-08-23" }];
    const text = canonicalJson({ weeks });
    expect(text.indexOf("2026-08-30")).toBeLessThan(text.indexOf("2026-08-16"));
    expect(text.indexOf("2026-08-16")).toBeLessThan(text.indexOf("2026-08-23"));
  });

  it("canonicalizes inside arrays", () => {
    const left = { weeks: [{ steps: 1, weekEnding: "2026-08-30" }] };
    const right = { weeks: [{ weekEnding: "2026-08-30", steps: 1 }] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it("treats an absent optional and an undefined one as the same record", () => {
    // What makes `equals` right for note, flags, rir and tempo.
    expect(canonicalJson({ steps: 1, note: undefined })).toBe(canonicalJson({ steps: 1 }));
  });

  it("keeps null as a value rather than dropping or recursing into it", () => {
    // typeof null === "object": an unguarded object branch emits {} here and
    // loses the value.
    expect(canonicalJson({ note: null })).toContain('"note": null');
    expect(canonicalJson({ note: null })).not.toBe(canonicalJson({}));
  });

  it("distinguishes null from an absent key", () => {
    expect(canonicalJson({ note: null })).not.toBe(canonicalJson({ note: undefined }));
  });

  it("emits two-space indentation and a trailing newline", () => {
    expect(canonicalJson({ steps: 1 })).toBe('{\n  "steps": 1\n}\n');
  });

  it("canonicalizes roots that are arrays or primitives", () => {
    expect(canonicalJson([2, 1])).toBe("[\n  2,\n  1\n]\n");
    expect(canonicalJson("a")).toBe('"a"\n');
    expect(canonicalJson(null)).toBe("null\n");
  });

  it("is idempotent through a parse round trip", () => {
    // The property the replay-equality check depends on: a document written by
    // this serializer, read back and re-serialized, is byte-identical.
    const data = { weeks: [{ weekEnding: "2026-08-30", steps: 52000 }], targets: { hpTarget: 260 } };
    const once = canonicalJson(data);
    expect(canonicalJson(JSON.parse(once))).toBe(once);
  });

  describe("refuses values with no faithful JSON form", () => {
    it.each([
      ["a Date", { at: new Date(0) }],
      ["a class instance", { at: new (class Point {})() }],
      ["a Map", { at: new Map() }],
      ["a function", { at: () => 1 }],
      ["a symbol", { at: Symbol("x") }],
      ["a bigint", { at: 1n }],
      ["NaN", { at: Number.NaN }],
      ["Infinity", { at: Number.POSITIVE_INFINITY }],
    ])("throws on %s rather than coercing it", (_label, value) => {
      // JSON.stringify would turn the Date into a string and NaN into null,
      // writing data nobody intended.
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
    });

    it("names the path but never the value", () => {
      // The message can reach a log, and the document is private.
      const attempt = () => canonicalJson({ weeks: [{ note: new Date(0) }] });
      expect(attempt).toThrow(/weeks\[0\]\.note/);
      expect(attempt).not.toThrow(/1970/);
    });

    it("reports the document root when the root itself is unsupported", () => {
      expect(() => canonicalJson(undefined)).toThrow(/the document root/);
    });
  });
});
