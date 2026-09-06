import { describe, expect, it } from "vitest";

import type { ChangeIntent } from "../src/editing/ReplayAdapter";
import { squashChanges, UnsquashableHistory, type SquashAdapter } from "../src/editing/squashChanges";

/**
 * A notes domain, deliberately not fitness. If squashing needed anything about
 * weeks or sessions, this adapter could not exist.
 */
type Note = { id: string; text: string };
type NoteChange = { note: string } & ChangeIntent<Note>;

const notes: SquashAdapter<NoteChange, Note> = {
  identityOf: (change) => (change.operation === "add" ? change.after.id : change.before.id),
  intent: (change) => change,
  rebuild: (template, intent) => ({ ...intent, note: `rebuilt from ${template.note}` }),
};

const add = (id: string, text: string, note = id): NoteChange => ({ operation: "add", after: { id, text }, note });
const update = (id: string, from: string, to: string, note = id): NoteChange => ({ operation: "update", before: { id, text: from }, after: { id, text: to }, note });
const remove = (id: string, text: string, note = id): NoteChange => ({ operation: "delete", before: { id, text }, note });

const squash = (changes: NoteChange[]) => squashChanges(changes, notes);

describe("squashChanges", () => {
  it("collapses a chain of updates to one, keeping the original before", () => {
    // The intermediate states were never in the document this will be replayed
    // against, so carrying them forward is what breaks the recovery path.
    expect(squash([update("a", "A", "B"), update("a", "B", "C"), update("a", "C", "D")])).toEqual([
      { operation: "update", before: { id: "a", text: "A" }, after: { id: "a", text: "D" }, note: "rebuilt from a" },
    ]);
  });

  it("keeps an add an add, carrying the latest contents", () => {
    expect(squash([add("a", "A"), update("a", "A", "B")])).toMatchObject([{ operation: "add", after: { id: "a", text: "B" } }]);
  });

  it("drops a record that was added and then deleted", () => {
    // Nothing to write, and the empty result is what stops the store being
    // contacted for an edit that reduces to nothing.
    expect(squash([add("a", "A"), remove("a", "A")])).toEqual([]);
  });

  it("collapses an update then a delete to a delete of the original record", () => {
    expect(squash([update("a", "A", "B"), remove("a", "B")])).toMatchObject([
      { operation: "delete", before: { id: "a", text: "A" } },
    ]);
  });

  it("collapses a delete then a re-add at the same identity to an update", () => {
    expect(squash([remove("a", "A"), add("a", "Z")])).toMatchObject([
      { operation: "update", before: { id: "a", text: "A" }, after: { id: "a", text: "Z" } },
    ]);
  });

  it("treats an add after a cancelled-out record as a fresh add", () => {
    expect(squash([add("a", "A"), remove("a", "A"), add("a", "Z")])).toMatchObject([{ operation: "add", after: { id: "a", text: "Z" } }]);
  });

  it("emits a lone change untouched rather than rebuilding it", () => {
    // Identity, not just equality: the common case must not round-trip through
    // the constructors for no gain.
    const only = update("a", "A", "B");
    expect(squash([only])[0]).toBe(only);
  });

  it("leaves changes to different records alone", () => {
    const first = update("a", "A", "B");
    const second = remove("b", "B");
    expect(squash([first, second])).toEqual([first, second]);
  });

  it("orders by first appearance, not by last touch", () => {
    // Mutations append, so the candidate bytes depend on this order.
    const result = squash([update("a", "A", "B"), update("b", "B", "C"), update("a", "B", "Z")]);
    expect(result.map((change) => notes.identityOf(change))).toEqual(["a", "b"]);
  });

  it("rebuilds from the group's last change, so its kind survives", () => {
    expect(squash([update("a", "A", "B", "first"), update("a", "B", "C", "last")])[0]!.note).toBe("rebuilt from last");
  });

  it.each([
    ["two additions of the same record", [add("a", "A"), add("a", "B")]],
    ["an addition of a record that already exists", [update("a", "A", "B"), add("a", "C")]],
    ["a delete followed by an update", [remove("a", "A"), update("a", "A", "B")]],
    ["a delete followed by a delete", [remove("a", "A"), remove("a", "A")]],
  ])("refuses a history that could not have been recorded: %s", (_label, changes) => {
    // Unreachable through the edit path, which refuses each of these when the
    // change is applied. Silence here would corrupt the document instead.
    expect(() => squash(changes)).toThrow(UnsquashableHistory);
  });

  it("names the identity in a refusal but never the record", () => {
    const attempt = () => squash([add("a", "secret"), add("a", "secret")]);
    expect(attempt).toThrow(/changes to a:/);
    expect(attempt).not.toThrow(/secret/);
  });

  it("returns nothing for an empty list", () => {
    expect(squash([])).toEqual([]);
  });

  /*
   * Once an add and a delete cancel, the record was never in the document the
   * squashed changes will be replayed against. A further add is a fresh record
   * and squashes cleanly; anything else describes editing something that is not
   * there, and there is no honest change to emit for it. Refusing is the only
   * safe answer -- emitting the trailing change would replay an update against
   * a record the base does not contain.
   */
  it("refuses an update that follows an add and a delete of the same record", () => {
    expect(() => squash([add("a", "A"), remove("a", "A"), update("a", "A", "B")]))
      .toThrow(UnsquashableHistory);
  });

  it("refuses a second delete after an add and a delete", () => {
    expect(() => squash([add("a", "A"), remove("a", "A"), remove("a", "A")]))
      .toThrow(UnsquashableHistory);
  });

  it("names the record and the reason, so the failure can be traced to one identity", () => {
    try {
      squash([add("a", "A"), remove("a", "A"), update("a", "A", "B")]);
      expect.unreachable("expected UnsquashableHistory");
    } catch (error) {
      expect((error as Error).message).toContain("a");
      expect((error as Error).message).toMatch(/follows a delete/);
    }
  });

  /*
   * The permitted case, for contrast: re-adding after a cancel is a fresh
   * record and must still squash to a single add.
   */
  it("allows a fresh add after an add and a delete cancel out", () => {
    expect(squash([add("a", "A"), remove("a", "A"), add("a", "C")])).toEqual([
      { operation: "add", after: { id: "a", text: "C" }, note: "rebuilt from a" },
    ]);
  });
});
