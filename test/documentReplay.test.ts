import { describe, expect, it } from "vitest";

import { DocumentReplay } from "../src/editing/DocumentReplay";
import { ReplayConflict } from "../src/editing/ReplayConflict";
import type { ChangeIntent, ReplayAdapter } from "../src/editing/ReplayAdapter";

/*
 * A deliberately non-fitness domain: a flat list of keyed notes. If the
 * conflict decision needed domain knowledge, this adapter could not exist --
 * so this file is the evidence that the boundary holds, not just a test of it.
 */
type Note = { key: string; body: string };
type NoteDocument = { notes: Note[] };
type NoteSnapshot = { fileId: string; documentText: string; data: NoteDocument };
type NoteChange = ChangeIntent<Note> & { key: string };
type NoteSession = { baseFileId: string; document: NoteDocument; changes: NoteChange[] };

function snapshotOf(notes: Note[], fileId = "doc-1"): NoteSnapshot {
  const documentText = JSON.stringify({ notes });
  return { fileId, documentText, data: JSON.parse(documentText) as NoteDocument };
}

const adapter: ReplayAdapter<NoteSnapshot, NoteSession, NoteChange, Note> = {
  // Parsed from documentText, so the session shares nothing with the snapshot.
  createSession: (snapshot) => ({
    baseFileId: snapshot.fileId,
    document: JSON.parse(snapshot.documentText) as NoteDocument,
    changes: [],
  }),
  baseFileId: (session) => session.baseFileId,
  changes: (session) => session.changes,
  intent: (change) => change,
  locate: (session, change) => session.document.notes.find(({ key }) => key === change.key) ?? null,
  equals: (left, right) => left.key === right.key && left.body === right.body,
  mutate: (session, change) => {
    const notes = session.document.notes;
    const at = notes.findIndex(({ key }) => key === change.key);
    if (change.operation === "delete") notes.splice(at, 1);
    else if (change.operation === "add") notes.push(change.after);
    else notes[at] = change.after;
    session.changes.push(change);
  },
};

function sessionWith(snapshot: NoteSnapshot, changes: NoteChange[]): NoteSession {
  return { baseFileId: snapshot.fileId, document: JSON.parse(snapshot.documentText) as NoteDocument, changes };
}

const replay = new DocumentReplay(adapter);
const original = snapshotOf([{ key: "a", body: "one" }]);

describe("DocumentReplay", () => {
  it("applies an update when the record is untouched", () => {
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
    ]);
    const result = replay.replay(session, snapshotOf([{ key: "a", body: "one" }]));
    expect(result.applied).toBe(1);
    expect(result.session.document.notes).toEqual([{ key: "a", body: "two" }]);
  });

  it("treats an already-applied update as an idempotent no-op", () => {
    // The interrupted-save case: the upload landed but could not be confirmed.
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
    ]);
    const result = replay.replay(session, snapshotOf([{ key: "a", body: "two" }]));
    expect(result).toMatchObject({ applied: 0, noOps: 1 });
  });

  it("conflicts when the record was changed to something else", () => {
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
    ]);
    expect(() => replay.replay(session, snapshotOf([{ key: "a", body: "elsewhere" }])))
      .toThrow(ReplayConflict);
  });

  it("conflicts when the updated record no longer exists", () => {
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
    ]);
    expect(() => replay.replay(session, snapshotOf([]))).toThrow(/no longer exists/);
  });

  it("treats an already-absent delete as a no-op and an already-present add as one too", () => {
    const deletion = sessionWith(original, [{ key: "a", operation: "delete", before: { key: "a", body: "one" } }]);
    expect(replay.replay(deletion, snapshotOf([])).noOps).toBe(1);

    const addition = sessionWith(original, [{ key: "b", operation: "add", after: { key: "b", body: "new" } }]);
    expect(replay.replay(addition, snapshotOf([{ key: "b", body: "new" }])).noOps).toBe(1);
  });

  it("conflicts when an addition's identity is taken by different data", () => {
    const session = sessionWith(original, [{ key: "b", operation: "add", after: { key: "b", body: "new" } }]);
    expect(() => replay.replay(session, snapshotOf([{ key: "b", body: "someone else" }])))
      .toThrow(/added elsewhere/);
  });

  it("conflicts when a deleted record was modified elsewhere", () => {
    const session = sessionWith(original, [{ key: "a", operation: "delete", before: { key: "a", body: "one" } }]);
    expect(() => replay.replay(session, snapshotOf([{ key: "a", body: "edited" }])))
      .toThrow(/no longer the record that was deleted/);
  });

  it("is atomic: a conflict late in the batch discards every earlier change", () => {
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
      { key: "c", operation: "add", after: { key: "c", body: "third" } },
      { key: "d", operation: "update", before: { key: "d", body: "gone" }, after: { key: "d", body: "never" } },
    ]);
    const latest = snapshotOf([{ key: "a", body: "one" }]);
    expect(() => replay.replay(session, latest)).toThrow(ReplayConflict);
    // The document is exactly as it arrived: no partial rebase escaped.
    expect(latest.data.notes).toEqual([{ key: "a", body: "one" }]);
    expect(JSON.parse(latest.documentText)).toEqual({ notes: [{ key: "a", body: "one" }] });
  });

  it("never carries the partially rebased session on the error", () => {
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
      { key: "d", operation: "update", before: { key: "d", body: "gone" }, after: { key: "d", body: "never" } },
    ]);
    try {
      replay.replay(session, snapshotOf([{ key: "a", body: "one" }]));
      expect.unreachable("replay should have conflicted");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayConflict);
      expect(Object.keys(error as object)).not.toContain("session");
      expect((error as ReplayConflict).change).toMatchObject({ key: "d" });
      // The whole document must not be reachable from the error, or one log
      // call serializes the owner's private record.
      expect(JSON.stringify(error)).not.toContain("two");
    }
  });

  it("leaves the caller's original session untouched after a conflict", () => {
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
      { key: "d", operation: "update", before: { key: "d", body: "gone" }, after: { key: "d", body: "never" } },
    ]);
    expect(() => replay.replay(session, snapshotOf([{ key: "a", body: "one" }]))).toThrow();
    expect(session.document.notes).toEqual([{ key: "a", body: "one" }]);
    expect(session.changes).toHaveLength(2);
  });

  it("refuses to replay onto a different document", () => {
    const session = sessionWith(original, []);
    expect(() => replay.replay(session, snapshotOf([], "other-doc")))
      .toThrow(/different document/);
  });

  it("refuses a fresh session that already carries changes", () => {
    const dirty: ReplayAdapter<NoteSnapshot, NoteSession, NoteChange, Note> = {
      ...adapter,
      createSession: (snapshot) => sessionWith(snapshot, [
        { key: "x", operation: "add", after: { key: "x", body: "stowaway" } },
      ]),
    };
    const session = sessionWith(original, []);
    expect(() => new DocumentReplay(dirty).replay(session, snapshotOf([])))
      .toThrow(/no recorded changes/);
  });

  it("catches an adapter whose session aliases the snapshot", () => {
    // The failure the isolation witness exists for: mutating here would reach
    // into the caller's validated last-known-good copy.
    const aliasing: ReplayAdapter<NoteSnapshot, NoteSession, NoteChange, Note> = {
      ...adapter,
      createSession: (snapshot) => ({ baseFileId: snapshot.fileId, document: snapshot.data, changes: [] }),
    };
    const session = sessionWith(original, [
      { key: "a", operation: "update", before: { key: "a", body: "one" }, after: { key: "a", body: "two" } },
    ]);
    expect(() => new DocumentReplay(aliasing).replay(session, snapshotOf([{ key: "a", body: "one" }])))
      .toThrow(/isolated copy/);
  });
});
