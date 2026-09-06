import type { ReplayAdapter, ReplayableSnapshot } from "./ReplayAdapter.js";
import { ReplayConflict } from "./ReplayConflict.js";

export type ReplayResult<TSession> = {
  /** A new session over the latest document. Never installed by replay. */
  session: TSession;
  /** Changes that altered the new session. */
  applied: number;
  /** Changes the latest document already satisfied. */
  noOps: number;
};

/**
 * Rebases one edit session's recorded changes onto the latest document.
 *
 * Pure: it reads the original session and the latest snapshot, and returns a
 * new session. It installs nothing -- the caller commits the result through a
 * SessionHolder, which is where the compare-and-swap lives. Replay therefore
 * cannot corrupt anything a caller can see, and a conflict simply means no
 * session comes back.
 *
 * Atomicity comes from that shape rather than from cleanup: every recorded
 * change applies to the new session, or the call throws and the new session is
 * unreachable. It is never returned, never attached to the error, and never
 * installed. A half-applied change set could be internally inconsistent -- a
 * record referencing another whose addition failed -- and that document would
 * become the source of truth in a state nobody chose.
 *
 * The conflict decision lives here rather than in the adapter because it is a
 * data-integrity rule that must not vary between applications. The adapter is
 * asked only where a record is and whether two records are equal.
 */
export class DocumentReplay<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord> {
  constructor(private readonly adapter: ReplayAdapter<TSnapshot, TSession, TChange, TRecord>) {}

  replay(originalSession: TSession, latest: TSnapshot): ReplayResult<TSession> {
    if (this.adapter.baseFileId(originalSession) !== latest.fileId) {
      throw new Error("Cannot replay changes onto a different document");
    }
    return this.replayChanges(this.adapter.changes(originalSession), latest);
  }

  /**
   * Replays an explicit change list rather than a session's own.
   *
   * The save path needs this: it replays the *squashed* list while the
   * candidate was built from the raw one, and comparing the two serializations
   * is what proves the squasher did not change the meaning of the edit. There
   * is no session carrying the squashed list, and inventing one only to read it
   * back would be a way for a half-built session to escape.
   *
   * The caller owns the document-identity check that `replay` performs, because
   * a bare change list carries no base file id.
   */
  replayChanges(changes: readonly TChange[], latest: TSnapshot): ReplayResult<TSession> {
    const session = this.adapter.createSession(latest);
    // A fresh session carrying changes would double-apply them, and the result
    // would still serialize cleanly -- nothing downstream would notice.
    if (this.adapter.changes(session).length > 0) {
      throw new Error("Replay requires a session with no recorded changes");
    }

    // The adapter must build its session from documentText, giving an object
    // graph that shares nothing with the snapshot. If it aliases snapshot.data
    // instead, mutation here would reach into the caller's validated
    // last-known-good copy -- so prove isolation rather than trusting it.
    const untouched = JSON.stringify(latest.data);

    let applied = 0;
    let noOps = 0;
    try {
      for (const change of changes) {
        // decide() throws before mutate() is reached for a conflicting change,
        // so the new session only ever advances by changes that were cleared.
        if (this.decide(session, change)) {
          this.adapter.mutate(session, change);
          applied += 1;
        } else {
          noOps += 1;
        }
      }
    } finally {
      // Runs on the conflict path too -- a conflict partway through is exactly
      // when an aliasing adapter would have leaked into the caller's snapshot.
      // Throwing from `finally` replaces an in-flight ReplayConflict, and that
      // is deliberate: a corrupted snapshot outranks a conflict, and reporting
      // "someone else changed this" while the caller's document is damaged
      // would hide the more serious failure.
      if (JSON.stringify(latest.data) !== untouched) {
        throw new Error(
          "Replay mutated the snapshot it was rebasing onto: createSession must return an isolated copy built from documentText",
        );
      }
    }

    return { session, applied, noOps };
  }

  /** True to mutate, false for an idempotent no-op; throws on conflict. */
  private decide(session: TSession, change: TChange): boolean {
    const intent = this.adapter.intent(change);
    const latest = this.adapter.locate(session, change);

    switch (intent.operation) {
      case "add":
        // Absent is the normal case. Present and identical means the addition
        // reached the document by another route. Present and different means
        // something else now occupies this identity.
        if (latest === null) return true;
        if (this.adapter.equals(latest, intent.after)) return false;
        throw this.conflict(change, "was added elsewhere with different data");

      case "update":
        if (latest === null) throw this.conflict(change, "no longer exists");
        // Already equal to the intended result. This is what makes an
        // interrupted save self-healing: an upload that succeeded but could
        // not be confirmed replays as no-ops rather than being applied twice.
        if (this.adapter.equals(latest, intent.after)) return false;
        if (this.adapter.equals(latest, intent.before)) return true;
        throw this.conflict(change, "was also changed elsewhere");

      case "delete":
        // Already absent is success, not failure: the intent was absence.
        if (latest === null) return false;
        if (this.adapter.equals(latest, intent.before)) return true;
        throw this.conflict(change, "was changed elsewhere and is no longer the record that was deleted");
    }
  }

  private conflict(change: TChange, detail: string): ReplayConflict {
    // Describes the collision without interpolating record contents: a
    // conflict message must not spill the document into logs.
    return new ReplayConflict(`A record you changed ${detail}`, change);
  }
}
