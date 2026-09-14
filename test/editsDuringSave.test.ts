import { describe, expect, it } from "vitest";

import { DocumentReplay } from "../src/editing/DocumentReplay";
import { prepareSave } from "../src/editing/prepareSave";
import type { ChangeIntent, ReplayAdapter, ReplayableSnapshot } from "../src/editing/ReplayAdapter";
import { saveDocument } from "../src/editing/saveDocument";
import { SessionHolder } from "../src/editing/SessionHolder";
import type { SquashAdapter } from "../src/editing/squashChanges";

/*
 * An edit recorded while an upload is in flight must survive the save that
 * was already running. These tests drive the real holder, preparation and save
 * coordination together, because the failure lives between them rather than in
 * any one.
 */

type Note = { id: string; text: string };
type Change = { note: string } & ChangeIntent<Note>;
type Snapshot = ReplayableSnapshot & { data: Note[] };
type Session = { baseFileId: string; changes: Change[]; records: Note[] };

const snapshot = (records: Note[]): Snapshot => ({ fileId: "f", documentText: JSON.stringify(records), data: records });

const idOf = (change: Change) => (change.operation === "add" ? change.after.id : change.before.id);

const adapter: ReplayAdapter<Snapshot, Session, Change, Note> = {
  createSession: (from) => ({ baseFileId: from.fileId, changes: [], records: JSON.parse(from.documentText) as Note[] }),
  baseFileId: (session) => session.baseFileId,
  changes: (session) => session.changes,
  intent: (change) => change,
  locate: (session, change) => session.records.find(({ id }) => id === idOf(change)) ?? null,
  equals: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  mutate: (session, change) => {
    const at = session.records.findIndex(({ id }) => id === idOf(change));
    if (change.operation === "add") session.records.push(change.after);
    else if (change.operation === "update") session.records[at] = change.after;
    else session.records.splice(at, 1);
    session.changes.push(change);
  },
};

const squash: SquashAdapter<Change, Note> = {
  identityOf: idOf,
  intent: (change) => change,
  rebuild: (template, intent) => ({ ...intent, note: template.note }),
};

const replay = new DocumentReplay(adapter);

const prepare = (session: Session, base: Snapshot) =>
  prepareSave(session, base, {
    replay,
    squash,
    changes: (value) => value.changes,
    baseFileId: (value) => value.baseFileId,
    serialize: (value) => JSON.stringify(value.records),
    validate: () => {},
  });

const update = (id: string, from: string, to: string): Change => ({ operation: "update", before: { id, text: from }, after: { id, text: to }, note: id });

/** Records one more change on top of the holder's current session. */
function edit(holder: SessionHolder<Session>, change: Change): void {
  const current = holder.current();
  const draft = structuredClone(current);
  adapter.mutate(draft, change);
  holder.commit(current, draft);
}

/**
 * One save whose upload lets `during` run before it resolves, as a user editing
 * while the network is slow would. Returns what the store now holds.
 */
async function saveWhileEditing(holder: SessionHolder<Session>, base: Snapshot, during: () => void): Promise<Snapshot> {
  const saving = holder.current();
  const result = await saveDocument(saving, base, {
    prepare,
    write: async (candidateText) => {
      await Promise.resolve();
      during();
      return snapshot(JSON.parse(candidateText) as Note[]);
    },
    reload: async () => base,
    replay,
    isMoved: () => false,
  });
  // What the README prescribes: decline rather than discard a newer edit.
  holder.tryCommit(saving, adapter.createSession(result.snapshot));
  return result.snapshot;
}

describe("edits recorded while a save is in flight", () => {
  const base = snapshot([{ id: "a", text: "A" }, { id: "b", text: "P" }]);

  it("keeps an edit to a different record, and saves it next time", async () => {
    const holder = new SessionHolder<Session>(adapter.createSession(base), () => {});
    edit(holder, update("a", "A", "B"));

    const saved = await saveWhileEditing(holder, base, () => edit(holder, update("b", "P", "Q")));

    expect(holder.current().records).toEqual([{ id: "a", text: "B" }, { id: "b", text: "Q" }]);
    const next = prepare(holder.current(), saved);
    expect(JSON.parse(next.candidateText)).toEqual([{ id: "a", text: "B" }, { id: "b", text: "Q" }]);
  });

  /*
   * KNOWN FAILURE -- the marker for the in-flight save fix. The declined
   * install keeps both changes, and squashing merges them into A->C. Replayed
   * against a store that now reads B, that matches neither side and throws
   * ReplayConflict: the user conflicts with their own save. Remove `.fails`
   * when the fix lands; vitest reports this as an error the moment it passes.
   */
  it.fails("keeps an edit to the record being saved, and saves it next time", async () => {
    const holder = new SessionHolder<Session>(adapter.createSession(base), () => {});
    edit(holder, update("a", "A", "B"));

    const saved = await saveWhileEditing(holder, base, () => edit(holder, update("a", "B", "C")));

    expect(holder.current().records).toEqual([{ id: "a", text: "C" }, { id: "b", text: "P" }]);
    const next = prepare(holder.current(), saved);
    expect(JSON.parse(next.candidateText)).toEqual([{ id: "a", text: "C" }, { id: "b", text: "P" }]);
  });
});
