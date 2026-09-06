import { describe, expect, it, vi } from "vitest";

import { DocumentReplay } from "../src/editing/DocumentReplay";
import { NothingToSave, type SavePlan } from "../src/editing/prepareSave";
import { ReplayConflict } from "../src/editing/ReplayConflict";
import type { ChangeIntent, ReplayAdapter, ReplayableSnapshot } from "../src/editing/ReplayAdapter";
import { ConcurrentWriterDetected, saveDocument } from "../src/editing/saveDocument";

/** A notes domain again: coordination must not need anything about fitness. */
type Note = { id: string; text: string };
type Change = { note: string } & ChangeIntent<Note>;
type Snapshot = ReplayableSnapshot & { data: Note[] };
type Session = { baseFileId: string; changes: Change[]; records: Note[] };

const snapshot = (records: Note[]): Snapshot => ({ fileId: "f", documentText: JSON.stringify(records), data: records });

const adapter: ReplayAdapter<Snapshot, Session, Change, Note> = {
  createSession: (from) => ({ baseFileId: from.fileId, changes: [], records: (JSON.parse(from.documentText) as Note[]) }),
  baseFileId: (session) => session.baseFileId,
  changes: (session) => session.changes,
  intent: (change) => change,
  locate: (session, change) => session.records.find(({ id }) => id === (change.operation === "add" ? change.after.id : change.before.id)) ?? null,
  equals: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  mutate: (session, change) => {
    const id = change.operation === "add" ? change.after.id : change.before.id;
    const at = session.records.findIndex((record) => record.id === id);
    if (change.operation === "add") session.records.push(change.after);
    else if (change.operation === "update") session.records[at] = change.after;
    else session.records.splice(at, 1);
    session.changes.push(change);
  },
};

const replay = new DocumentReplay(adapter);
const update = (id: string, from: string, to: string): Change => ({ operation: "update", before: { id, text: from }, after: { id, text: to }, note: id });

const MOVED = new Error("moved");
const isMoved = (error: unknown) => error === MOVED;

function parts(over: Partial<Parameters<typeof saveDocument<Snapshot, Session, Change, Note>>[2]> = {}) {
  const plan: SavePlan<Change> = { changes: [update("a", "A", "B")], candidateText: "candidate" };
  return {
    prepare: vi.fn(() => plan),
    write: vi.fn(async () => snapshot([{ id: "a", text: "B" }])),
    reload: vi.fn(async () => snapshot([{ id: "a", text: "A" }])),
    replay,
    isMoved,
    ...over,
  };
}

const session = (): Session => ({ baseFileId: "f", changes: [update("a", "A", "B")], records: [{ id: "a", text: "B" }] });
const base = snapshot([{ id: "a", text: "A" }]);

describe("saveDocument", () => {
  it("writes once when the document has not moved", async () => {
    const p = parts();
    const result = await saveDocument(session(), base, p);
    expect(result.outcome).toBe("written");
    expect(p.reload).not.toHaveBeenCalled();
    expect(p.write).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure that is not a move, without reloading", async () => {
    // An unconfirmed write above all: the store may already hold the new
    // revision, so retrying would compound an unknown state.
    const unconfirmed = new Error("unconfirmed");
    const p = parts({ write: vi.fn(async () => { throw unconfirmed; }) });
    await expect(saveDocument(session(), base, p)).rejects.toBe(unconfirmed);
    expect(p.reload).not.toHaveBeenCalled();
  });

  it("reloads, rebases and writes once more when the document moved", async () => {
    const p = parts({
      write: vi.fn()
        .mockRejectedValueOnce(MOVED)
        .mockResolvedValueOnce(snapshot([{ id: "a", text: "B" }])),
      reload: vi.fn(async () => snapshot([{ id: "a", text: "A" }])),
    });
    const result = await saveDocument(session(), base, p);
    expect(result.outcome).toBe("written-after-rebase");
    expect(p.reload).toHaveBeenCalledTimes(1);
    expect(p.write).toHaveBeenCalledTimes(2);
    // The second attempt writes the re-prepared candidate against the new base.
    expect(p.prepare).toHaveBeenCalledTimes(2);
  });

  it("reports success without writing when the document already reflects the edit", async () => {
    // The interrupted save, healed: the upload landed but could not be
    // confirmed, so the reload already holds the result and the squashed
    // changes replay as no-ops.
    const p = parts({
      write: vi.fn().mockRejectedValueOnce(MOVED),
      reload: vi.fn(async () => snapshot([{ id: "a", text: "B" }])),
    });
    const result = await saveDocument(session(), base, p);
    expect(result.outcome).toBe("already-applied");
    expect(result.snapshot.data).toEqual([{ id: "a", text: "B" }]);
    expect(p.write).toHaveBeenCalledTimes(1);
  });

  it("stops after a second move rather than looping", async () => {
    // Another writer racing at this speed. A loop is worse than an honest
    // failure: it looks like the application has hung.
    const p = parts({ write: vi.fn().mockRejectedValue(MOVED), reload: vi.fn(async () => snapshot([{ id: "a", text: "A" }])) });
    await expect(saveDocument(session(), base, p)).rejects.toThrow(ConcurrentWriterDetected);
    expect(p.write).toHaveBeenCalledTimes(2);
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the rebase itself conflicts", async () => {
    const p = parts({
      write: vi.fn().mockRejectedValueOnce(MOVED),
      reload: vi.fn(async () => snapshot([{ id: "a", text: "someone else wrote this" }])),
    });
    await expect(saveDocument(session(), base, p)).rejects.toThrow(ReplayConflict);
    expect(p.write).toHaveBeenCalledTimes(1);
  });

  it("never writes when preparation refuses", async () => {
    const p = parts({ prepare: vi.fn(() => { throw new NothingToSave("no-changes"); }) });
    await expect(saveDocument(session(), base, p)).rejects.toThrow(NothingToSave);
    expect(p.write).not.toHaveBeenCalled();
  });

  it("returns the snapshot the store confirmed, not the local candidate", async () => {
    const confirmed = snapshot([{ id: "a", text: "B" }]);
    const p = parts({ write: vi.fn(async () => confirmed) });
    expect((await saveDocument(session(), base, p)).snapshot).toBe(confirmed);
  });
});
