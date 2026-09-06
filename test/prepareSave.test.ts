import { describe, expect, it, vi } from "vitest";

import { DocumentReplay } from "../src/editing/DocumentReplay.js";
import { NothingToSave, UnrecordedMutation, prepareSave } from "../src/editing/prepareSave.js";
import type { ChangeIntent, ReplayAdapter, ReplayableSnapshot } from "../src/editing/ReplayAdapter.js";
import type { SquashAdapter } from "../src/editing/squashChanges.js";

/*
 * prepareSave arrived from fitness-board with no test: its only coverage was an
 * integration test with nine fitness imports, which stayed behind. That left
 * the package's save planning at 14% of statements -- the function that decides
 * what gets written to someone's document.
 *
 * A notes domain again, deliberately not fitness. Every guarantee below is
 * domain-neutral, and if any of them needed to know about weeks or sessions
 * this file could not exist.
 */

type Note = { id: string; text: string };
type NoteChange = { label: string } & ChangeIntent<Note>;
type Session = { notes: Note[]; recorded: NoteChange[]; fileId: string };
type Snapshot = ReplayableSnapshot & { notes: readonly Note[] };

const identityOf = (change: NoteChange) => (change.operation === "add" ? change.after.id : change.before.id);

const squash: SquashAdapter<NoteChange, Note> = {
  identityOf,
  intent: (change) => change,
  rebuild: (template, intent) => ({ ...intent, label: template.label }),
};

const replayAdapter: ReplayAdapter<Snapshot, Session, NoteChange, Note> = {
  createSession: (snapshot) => ({ notes: snapshot.notes.map((n) => ({ ...n })), recorded: [], fileId: snapshot.fileId }),
  baseFileId: (session) => session.fileId,
  changes: (session) => session.recorded,
  intent: (change) => change,
  locate: (session, change) => session.notes.find((n) => n.id === identityOf(change)) ?? null,
  equals: (a, b) => a.id === b.id && a.text === b.text,
  mutate: (session, change) => {
    const intent = change as ChangeIntent<Note>;
    if (intent.operation === "add") session.notes.push({ ...intent.after });
    else if (intent.operation === "delete") session.notes = session.notes.filter((n) => n.id !== intent.before.id);
    else {
      const index = session.notes.findIndex((n) => n.id === intent.before.id);
      session.notes[index] = { ...intent.after };
    }
    session.recorded.push(change);
  },
};

const serialize = (session: Session) => JSON.stringify(session.notes);
const snapshot = (notes: Note[], fileId = "file-a"): Snapshot => ({ fileId, documentText: JSON.stringify(notes), data: notes, notes });

type Parts = Parameters<typeof prepareSave<Snapshot, Session, NoteChange, Note>>[2];

function parts(over: Partial<Parts> = {}): Parts {
  return {
    replay: new DocumentReplay(replayAdapter),
    squash,
    changes: (session: Session) => session.recorded,
    baseFileId: (session: Session) => session.fileId,
    serialize,
    validate: () => {},
    ...over,
  };
}

/** A session built from a snapshot, then edited through the adapter. */
function edited(base: Snapshot, apply: (session: Session) => void): Session {
  const session = replayAdapter.createSession(base);
  apply(session);
  return session;
}

const add = (id: string, text: string): NoteChange => ({ operation: "add", after: { id, text }, label: id });
const update = (id: string, from: string, to: string): NoteChange => ({ operation: "update", before: { id, text: from }, after: { id, text: to }, label: id });
const remove = (id: string, text: string): NoteChange => ({ operation: "delete", before: { id, text }, label: id });

describe("prepareSave", () => {
  it("returns the squashed changes and the exact bytes to upload", () => {
    const base = snapshot([{ id: "a", text: "A" }]);
    const session = edited(base, (s) => {
      replayAdapter.mutate(s, update("a", "A", "B"));
      replayAdapter.mutate(s, update("a", "B", "C"));
    });

    const plan = prepareSave(session, base, parts());
    expect(plan.candidateText).toBe(JSON.stringify([{ id: "a", text: "C" }]));
    // Two updates to one record collapse to one.
    expect(plan.changes).toHaveLength(1);
  });

  /*
   * Step 1. The base fixes what "unchanged" means for every later comparison,
   * so a session and a snapshot describing different documents cannot be
   * compared at all.
   */
  it("refuses a session prepared against a different document", () => {
    const base = snapshot([{ id: "a", text: "A" }], "file-a");
    const session = edited(snapshot([{ id: "a", text: "A" }], "file-b"), (s) => {
      replayAdapter.mutate(s, update("a", "A", "B"));
    });
    expect(() => prepareSave(session, base, parts())).toThrow(/different document/);
  });

  describe("edits that must never contact the store", () => {
    it("rejects a session with nothing recorded", () => {
      const base = snapshot([{ id: "a", text: "A" }]);
      expect(() => prepareSave(edited(base, () => {}), base, parts())).toThrow(NothingToSave);
      try {
        prepareSave(edited(base, () => {}), base, parts());
      } catch (error) {
        expect((error as NothingToSave).reason).toBe("no-changes");
      }
    });

    it("rejects changes that cancel each other out", () => {
      const base = snapshot([]);
      const session = edited(base, (s) => {
        replayAdapter.mutate(s, add("a", "A"));
        replayAdapter.mutate(s, remove("a", "A"));
      });
      try {
        prepareSave(session, base, parts());
        expect.unreachable("expected NothingToSave");
      } catch (error) {
        expect((error as NothingToSave).reason).toBe("cancelled-out");
      }
    });

    /*
     * Semantically empty rather than syntactically empty: changes were recorded
     * and they do not cancel, but the base already reflects them -- someone else
     * made the same edit first.
     */
    it("rejects an edit the document already satisfies", () => {
      const base = snapshot([{ id: "a", text: "B" }]);
      const session: Session = { notes: [{ id: "a", text: "B" }], fileId: "file-a", recorded: [update("a", "A", "B")] };
      try {
        prepareSave(session, base, parts());
        expect.unreachable("expected NothingToSave");
      } catch (error) {
        expect((error as NothingToSave).reason).toBe("already-satisfied");
      }
    });
  });

  /*
   * Step 5's real purpose. The candidate is built from the RAW list and the
   * comparison replays the SQUASHED list, so this checks the squasher too.
   * Build the candidate from the squashed list and it would compare the squasher
   * against itself and verify nothing.
   */
  it("catches a candidate its own recorded changes do not reproduce", () => {
    const base = snapshot([{ id: "a", text: "A" }]);
    const session = edited(base, (s) => {
      replayAdapter.mutate(s, update("a", "A", "B"));
      // A mutation that bypassed the recorder entirely.
      s.notes.push({ id: "ghost", text: "never recorded" });
    });
    expect(() => prepareSave(session, base, parts())).toThrow(UnrecordedMutation);
  });

  /*
   * The same check, aimed at the squasher rather than the caller. Note that a
   * lone change is emitted untouched and never rebuilt, so a squasher can only
   * distort an edit when it actually combines two -- which is why this needs two
   * updates to one record to reach the rebuild path at all.
   */
  it("catches a squasher that alters the meaning of the edit it rebuilds", () => {
    const base = snapshot([{ id: "a", text: "A" }]);
    const session = edited(base, (s) => {
      replayAdapter.mutate(s, update("a", "A", "B"));
      replayAdapter.mutate(s, update("a", "B", "C"));
    });
    const dishonest: SquashAdapter<NoteChange, Note> = {
      ...squash,
      rebuild: (template, intent) => ({
        ...(intent as ChangeIntent<Note>),
        after: { id: "a", text: "tampered" },
        label: template.label,
      } as NoteChange),
    };
    expect(() => prepareSave(session, base, parts({ squash: dishonest }))).toThrow(UnrecordedMutation);
  });

  it("accepts an honest rebuild of the same two changes", () => {
    const base = snapshot([{ id: "a", text: "A" }]);
    const session = edited(base, (s) => {
      replayAdapter.mutate(s, update("a", "A", "B"));
      replayAdapter.mutate(s, update("a", "B", "C"));
    });
    expect(prepareSave(session, base, parts()).candidateText)
      .toBe(JSON.stringify([{ id: "a", text: "C" }]));
  });

  describe("ordering of the steps", () => {
    /*
     * Step 4 is admission control, not verification: it runs before the document
     * can reach the store, and its failure must surface as itself rather than as
     * a later, more confusing complaint.
     */
    it("validates the whole document, and lets that failure through unchanged", () => {
      const base = snapshot([{ id: "a", text: "A" }]);
      const session = edited(base, (s) => { replayAdapter.mutate(s, update("a", "A", "B")); });
      const validate = vi.fn(() => { throw new Error("collectively inconsistent"); });
      expect(() => prepareSave(session, base, parts({ validate }))).toThrow("collectively inconsistent");
      expect(validate).toHaveBeenCalledOnce();
    });

    /*
     * An empty edit must cost nothing. Serializing and validating a session
     * with no recorded changes is work done for a save that cannot happen.
     */
    it("does no work at all for a session with nothing recorded", () => {
      const base = snapshot([{ id: "a", text: "A" }]);
      const validate = vi.fn();
      const serializeSpy = vi.fn(serialize);
      expect(() => prepareSave(edited(base, () => {}), base, parts({ validate, serialize: serializeSpy })))
        .toThrow(NothingToSave);
      expect(validate).not.toHaveBeenCalled();
      expect(serializeSpy).not.toHaveBeenCalled();
    });
  });

  it("names each refusal distinctly, so a caller can tell them apart", () => {
    expect(new NothingToSave("no-changes").message).toMatch(/no recorded changes/);
    expect(new NothingToSave("cancelled-out").message).toMatch(/cancel each other out/);
    expect(new NothingToSave("already-satisfied").message).toMatch(/already reflects/);
    expect(new NothingToSave("no-changes").name).toBe("NothingToSave");
    expect(new UnrecordedMutation().name).toBe("UnrecordedMutation");
  });
});
