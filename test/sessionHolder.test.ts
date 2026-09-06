import { describe, expect, it, vi } from "vitest";

import { SessionCommitConflict, SessionHolder } from "../src/editing/SessionHolder";

type Session = { readonly value: string };

const valid = () => {};
const rejectEmpty = (session: Session) => {
  if (!session.value) throw new Error("empty session");
};

describe("SessionHolder", () => {
  it("installs a validated session and hands back the new current", () => {
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, valid);
    const next: Session = { value: "two" };
    holder.commit(base, next);
    expect(holder.current()).toBe(next);
  });

  it("rejects a commit prepared against a stale base", () => {
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, valid);
    holder.commit(base, { value: "two" });
    expect(() => holder.commit(base, { value: "three" })).toThrow(SessionCommitConflict);
  });

  it("validates before swapping, so a rejected session leaves the previous one current", () => {
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, rejectEmpty);
    expect(() => holder.commit(base, { value: "" })).toThrow("empty session");
    expect(holder.current()).toBe(base);
  });

  it("never exposes a partially applied batch: the draft is discarded whole", () => {
    // A batch that fails validation must be invisible, not repaired.
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, rejectEmpty);
    const draft: Session = { value: "" };
    expect(() => holder.commit(base, draft)).toThrow();
    expect(holder.current()).toBe(base);
    expect(holder.current()).not.toBe(draft);
  });

  it("declines a best-effort install when the session moved, without touching state", () => {
    // The save flow adopting a post-upload snapshot while the user edited
    // mid-flight. Declining is safe: the local session keeps every recorded
    // change, and the next save replays them as no-ops.
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, valid);
    const edited: Session = { value: "edited mid-flight" };
    holder.commit(base, edited);

    expect(holder.tryCommit(base, { value: "from drive" })).toBe(false);
    expect(holder.current()).toBe(edited);
  });

  it("accepts a best-effort install when nothing moved", () => {
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, valid);
    const fromDrive: Session = { value: "from drive" };
    expect(holder.tryCommit(base, fromDrive)).toBe(true);
    expect(holder.current()).toBe(fromDrive);
  });

  it("does not validate a declined best-effort install", () => {
    const validate = vi.fn();
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, validate);
    holder.commit(base, { value: "moved" });
    validate.mockClear();

    holder.tryCommit(base, { value: "stale" });
    expect(validate).not.toHaveBeenCalled();
  });

  /*
   * The compare-and-swap runs BEFORE validation, and reordering the two left
   * the suite green until this test existed. The difference is observable in
   * which failure the caller sees, and that decides what they do next: a
   * conflict means reload and rebase, a validation error means fix the data.
   * Report a stale commit as a validation failure and the caller goes off
   * repairing a candidate that was never going to be installed.
   */
  it("reports a stale commit as a conflict, without validating the doomed candidate", () => {
    const validate = vi.fn(rejectEmpty);
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, validate);
    holder.commit(base, { value: "moved on" });
    validate.mockClear();

    // Stale base *and* an invalid candidate: staleness must win.
    expect(() => holder.commit(base, { value: "" })).toThrow(SessionCommitConflict);
    expect(validate).not.toHaveBeenCalled();
  });

  /*
   * tryCommit is best-effort about staleness, never about admissibility. A
   * post-upload snapshot that does not validate is a real failure and must not
   * be installed quietly.
   */
  it("still validates a best-effort install, and leaves the current session in place when it fails", () => {
    const base: Session = { value: "one" };
    const holder = new SessionHolder(base, rejectEmpty);

    expect(() => holder.tryCommit(base, { value: "" })).toThrow("empty session");
    expect(holder.current()).toBe(base);
  });
});
