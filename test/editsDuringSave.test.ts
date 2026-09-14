import { describe, expect, it } from "vitest";

import { DocumentReplay } from "../src/editing/DocumentReplay";
import { prepareSave } from "../src/editing/prepareSave";
import type { ChangeIntent, ReplayAdapter, ReplayableSnapshot } from "../src/editing/ReplayAdapter";
import { ReplayConflict } from "../src/editing/ReplayConflict";
import { SaveInProgress, SavedButNotAdopted, saveSession, type SaveSessionParts } from "../src/editing/saveSession";
import { SessionHolder, SessionLocked } from "../src/editing/SessionHolder";
import type { SquashAdapter } from "../src/editing/squashChanges";

/*
 * An edit recorded while an upload is in flight must survive the save that was
 * already running, or be refused outright -- never silently lost, and never
 * turned into a conflict with the user's own write. These drive the real
 * holder, preparation, replay and save coordination together, because the
 * failure lived between them rather than in any one.
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

const MOVED = new Error("moved");

/**
 * Parts for one save whose upload lets `during` run before it resolves, as a
 * user editing while the network is slow would. The store echoes the candidate.
 */
function parts(during: () => void = () => {}, over: Partial<SaveSessionParts<Snapshot, Session, Change, Note>> = {}) {
  return {
    prepare,
    write: async (candidateText: string) => {
      await Promise.resolve();
      during();
      return snapshot(JSON.parse(candidateText) as Note[]);
    },
    reload: async () => base,
    replay,
    isMoved: (error: unknown) => error === MOVED,
    changes: (session: Session) => session.changes,
    intent: (change: Change) => change,
    ...over,
  };
}

const base = snapshot([{ id: "a", text: "A" }, { id: "b", text: "P" }]);

function editedHolder(validate: (session: Session) => void = () => {}): SessionHolder<Session> {
  const holder = new SessionHolder<Session>(adapter.createSession(base), validate);
  edit(holder, update("a", "A", "B"));
  return holder;
}

describe("saveSession, carrying edits over (the default)", () => {
  it("installs the saved document when nothing was edited during the save", async () => {
    const holder = editedHolder();
    const result = await saveSession(holder, base, parts());

    expect(result).toMatchObject({ outcome: "written", carried: 0 });
    expect(holder.current().changes).toEqual([]);
    expect(holder.current().records).toEqual([{ id: "a", text: "B" }, { id: "b", text: "P" }]);
  });

  it("carries an edit to a different record, and saves it next time", async () => {
    const holder = editedHolder();
    const result = await saveSession(holder, base, parts(() => edit(holder, update("b", "P", "Q"))));

    expect(result.carried).toBe(1);
    expect(holder.current().changes).toEqual([update("b", "P", "Q")]);
    const next = prepare(holder.current(), result.snapshot);
    expect(JSON.parse(next.candidateText)).toEqual([{ id: "a", text: "B" }, { id: "b", text: "Q" }]);
  });

  /*
   * The bug this exists for. Declining the install kept A->B and B->C, which
   * squash to A->C and conflict with a store that now reads B.
   */
  it("carries an edit to the record being saved, and saves it next time", async () => {
    const holder = editedHolder();
    const result = await saveSession(holder, base, parts(() => edit(holder, update("a", "B", "C"))));

    expect(holder.current().changes).toEqual([update("a", "B", "C")]);
    const next = prepare(holder.current(), result.snapshot);
    expect(JSON.parse(next.candidateText)).toEqual([{ id: "a", text: "C" }, { id: "b", text: "P" }]);
  });

  it("carries edits onto a rebased save, which holds another writer's change", async () => {
    const holder = editedHolder();
    const theirs = snapshot([{ id: "a", text: "A" }, { id: "b", text: "P" }, { id: "c", text: "theirs" }]);
    let attempts = 0;
    const result = await saveSession(holder, base, parts(undefined, {
      write: async (candidateText) => {
        attempts += 1;
        if (attempts === 1) throw MOVED;
        edit(holder, update("b", "P", "Q"));
        return snapshot(JSON.parse(candidateText) as Note[]);
      },
      reload: async () => theirs,
    }));

    expect(result.outcome).toBe("written-after-rebase");
    expect(holder.current().records).toEqual([{ id: "a", text: "B" }, { id: "b", text: "Q" }, { id: "c", text: "theirs" }]);
  });

  it("reports a carried edit that conflicts with the rebased save, keeping the session and the saved result", async () => {
    const holder = editedHolder();
    const theirs = snapshot([{ id: "a", text: "A" }, { id: "b", text: "X" }]);
    let attempts = 0;
    const p = parts(undefined, {
      write: async (candidateText) => {
        attempts += 1;
        if (attempts === 1) throw MOVED;
        edit(holder, update("b", "P", "Q"));
        return snapshot(JSON.parse(candidateText) as Note[]);
      },
      reload: async () => theirs,
    });

    const error = await saveSession(holder, base, p).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SavedButNotAdopted);
    const failure = error as SavedButNotAdopted<Snapshot>;
    expect(failure.reason).toBe("conflict");
    expect(failure.cause).toBeInstanceOf(ReplayConflict);
    expect(failure.saved.snapshot.data).toEqual([{ id: "a", text: "B" }, { id: "b", text: "X" }]);
    expect(holder.current().changes).toEqual([update("a", "A", "B"), update("b", "P", "Q")]);
  });

  /*
   * An undo that swaps a saved change for a new one keeps the length the same,
   * so only comparing the changes themselves notices.
   */
  it("refuses to guess when the saved changes were rewritten during the save", async () => {
    const holder = editedHolder();
    const rewrite = () => {
      const current = holder.current();
      const undone: Session = { baseFileId: "f", changes: [update("b", "P", "Q")], records: [{ id: "a", text: "A" }, { id: "b", text: "Q" }] };
      holder.commit(current, undone);
    };

    const error = await saveSession(holder, base, parts(rewrite)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SavedButNotAdopted);
    expect((error as SavedButNotAdopted<Snapshot>).reason).toBe("rewritten");
    expect(holder.current().changes).toEqual([update("b", "P", "Q")]);
  });

  it("reports a carried session that fails validation, leaving the current one", async () => {
    let strict = false;
    const holder = editedHolder((session) => {
      if (strict && session.changes.length === 1 && session.records.some(({ text }) => text === "Q")) throw new Error("invalid");
    });
    const during = () => {
      edit(holder, update("b", "P", "Q"));
      strict = true;
    };

    const error = await saveSession(holder, base, parts(during)).catch((caught: unknown) => caught);
    expect((error as SavedButNotAdopted<Snapshot>).reason).toBe("invalid");
    expect(holder.current().changes).toHaveLength(2);
  });

  it("leaves every change in place, mid-save edits included, when the write fails", async () => {
    const holder = editedHolder();
    const failure = new Error("unconfirmed");
    const p = parts(undefined, {
      write: async () => {
        edit(holder, update("b", "P", "Q"));
        throw failure;
      },
    });

    await expect(saveSession(holder, base, p)).rejects.toBe(failure);
    expect(holder.current().changes).toEqual([update("a", "A", "B"), update("b", "P", "Q")]);
  });

  it("refuses a second save of the same holder while one is running", async () => {
    const holder = editedHolder();
    let second: Promise<unknown> | undefined;
    const first = await saveSession(holder, base, parts(() => {
      second = saveSession(holder, base, parts());
    }));

    await expect(second).rejects.toThrow(SaveInProgress);
    // And the guard is released once the first finishes.
    edit(holder, update("b", "P", "Q"));
    await expect(saveSession(holder, first.snapshot, parts())).resolves.toMatchObject({ outcome: "written" });
  });
});

describe("saveSession, blocking edits", () => {
  it("refuses edits while the upload is in flight, then installs the saved document", async () => {
    const holder = editedHolder();
    let refused: unknown;
    const during = () => {
      expect(holder.isLocked()).toBe(true);
      try {
        edit(holder, update("b", "P", "Q"));
      } catch (error: unknown) {
        refused = error;
      }
    };

    const result = await saveSession(holder, base, parts(during), { duringSave: "block" });

    expect(refused).toBeInstanceOf(SessionLocked);
    expect(result.carried).toBe(0);
    expect(holder.isLocked()).toBe(false);
    expect(holder.current().records).toEqual([{ id: "a", text: "B" }, { id: "b", text: "P" }]);
  });

  it("unlocks when the save fails, so the user can keep editing", async () => {
    const holder = editedHolder();
    const failure = new Error("offline");

    await expect(saveSession(holder, base, parts(undefined, { write: async () => { throw failure; } }), { duringSave: "block" })).rejects.toBe(failure);
    expect(holder.isLocked()).toBe(false);
    edit(holder, update("b", "P", "Q"));
    expect(holder.current().changes).toHaveLength(2);
  });
});
