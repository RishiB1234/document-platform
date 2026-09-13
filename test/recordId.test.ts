import { describe, expect, it, vi } from "vitest";

import {
  RECORD_ID_ALPHABET,
  RECORD_ID_LENGTH,
  isRecordId,
  mintRecordId,
  recordIdOf,
} from "../src/identity/recordId.js";

describe("record identity", () => {
  it("accepts only ids of the stated shape", () => {
    expect(isRecordId("23456789ab")).toBe(true);
    expect(isRecordId("")).toBe(false);
    expect(isRecordId("23456789a")).toBe(false);
    expect(isRecordId("23456789abc")).toBe(false);
    expect(isRecordId(1234567890)).toBe(false);
    expect(isRecordId(undefined)).toBe(false);
  });

  /* The excluded characters are the whole reason a human can compare two ids
   * in a diff, so they are worth pinning rather than leaving to the constant. */
  it("excludes the characters a reader would misread", () => {
    for (const ambiguous of ["i", "l", "o", "u", "0", "1"]) {
      expect(RECORD_ID_ALPHABET).not.toContain(ambiguous);
      expect(isRecordId(ambiguous.repeat(RECORD_ID_LENGTH))).toBe(false);
    }
  });

  it("mints an id of the right shape", () => {
    expect(isRecordId(mintRecordId(new Set()))).toBe(true);
  });

  it("never returns an id already in use", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = mintRecordId(taken);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
    expect(taken.size).toBe(500);
  });

  /*
   * The guarantee that lets the id be this short. A generator handing back a
   * value already in the document must retry, not shrug -- so this one hands
   * back the same id until it is told that id is taken.
   */
  it("retries past a collision rather than returning a duplicate", () => {
    const collide = "23456789ab";
    let calls = 0;
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      ((array: Uint8Array) => {
        calls += 1;
        // First pass yields the taken id; later passes yield a different one.
        const symbol = calls <= 1 ? 0 : 1;
        for (let i = 0; i < array.length; i += 1) array[i] = symbol;
        return array;
      }) as typeof globalThis.crypto.getRandomValues,
    );

    try {
      const minted = mintRecordId(new Set([collide]));
      expect(minted).not.toBe(collide);
      expect(isRecordId(minted)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  /* A predictable id would be worse than no id: it collides silently where
   * this fails loudly. */
  it("fails rather than inventing a fallback when every attempt collides", () => {
    expect(() => mintRecordId({ has: () => true })).toThrow(/Could not mint/);
  });

  /*
   * Rejection sampling, not modulo: 256 is not a multiple of 30, so plain
   * `% 30` favours the first sixteen symbols. Bytes at or above 240 must be
   * discarded, never folded back into the alphabet.
   */
  it("discards the bytes that would bias the alphabet", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      ((array: Uint8Array) => {
        // 240 would fold to symbol 0 under modulo; 241 to symbol 1, and so on.
        for (let i = 0; i < array.length; i += 1) array[i] = 240 + (i % 16);
        array[array.length - 1] = 29;
        return array;
      }) as typeof globalThis.crypto.getRandomValues,
    );

    try {
      const minted = mintRecordId(new Set());
      // Every accepted byte was the single in-range one, so nothing folded.
      expect(minted).toBe(RECORD_ID_ALPHABET[29].repeat(RECORD_ID_LENGTH));
    } finally {
      spy.mockRestore();
    }
  });

  describe("recordIdOf", () => {
    it("returns the id of an admitted record", () => {
      expect(recordIdOf({ id: "23456789ab" })).toBe("23456789ab");
    });

    it("names the failure rather than handing back undefined", () => {
      expect(() => recordIdOf({})).toThrow(/never admitted to the document/);
      expect(() => recordIdOf({ id: "nope" })).toThrow(/never admitted to the document/);
    });
  });
});
