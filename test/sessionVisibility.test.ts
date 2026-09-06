import { describe, expect, it } from "vitest";

import { visibleSnapshot } from "../src/document/sessionVisibility";

const live = { source: "live" };
const cached = { source: "cached" };

describe("visibleSnapshot", () => {
  it("withholds a cached document until the session has authorized", () => {
    expect(visibleSnapshot(false, null, cached)).toBeNull();
  });

  it("withholds even when both a live and a cached document are in hand", () => {
    expect(visibleSnapshot(false, live, cached)).toBeNull();
  });

  it("prefers the live document once the session has authorized", () => {
    expect(visibleSnapshot(true, live, cached)).toBe(live);
  });

  it("falls back to the cached document when a live read fails mid-session", () => {
    expect(visibleSnapshot(true, null, cached)).toBe(cached);
  });

  it("shows nothing when an authorized session holds neither", () => {
    expect(visibleSnapshot(true, null, null)).toBeNull();
  });
});
