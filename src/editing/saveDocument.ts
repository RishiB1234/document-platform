import type { DocumentReplay } from "./DocumentReplay.js";
import type { SavePlan } from "./prepareSave.js";
import type { ReplayableSnapshot } from "./ReplayAdapter.js";

export type SaveOutcome =
  /** The first attempt succeeded. */
  | "written"
  /** The document had moved; the edit was rebased onto it and written. */
  | "written-after-rebase"
  /** The document already reflected the edit, so nothing was written. */
  | "already-applied";

export type SaveResult<TSnapshot> = {
  /** What the store holds now, verified by reading it back. */
  snapshot: TSnapshot;
  outcome: SaveOutcome;
};

/** The document moved twice while this edit was being written. */
export class ConcurrentWriterDetected extends Error {
  constructor() {
    super("The document changed again while this edit was being rebased onto it; your changes are still here, unsaved");
    this.name = "ConcurrentWriterDetected";
  }
}

/**
 * Coordinates one reload, one rebase, and one retry after the document moves.
 *
 * **Exactly one.** A second failure stops and preserves the local edits.
 * Retrying further would mean another writer is racing at this speed, and a
 * loop is worse than an honest failure -- it turns a visible conflict into an
 * application that appears to hang while quietly fighting for the document.
 *
 * A conflict during the rebase is not retried at all: it propagates, the
 * original session stays current, and every recorded change is still there.
 *
 * An unconfirmed write is never retried. It is the one failure where the store
 * may already hold the new revision, so a retry compounds an unknown state; it
 * propagates so the caller can put the session into recovery.
 */
export async function saveDocument<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord>(
  session: TSession,
  base: TSnapshot,
  parts: {
    prepare: (session: TSession, base: TSnapshot) => SavePlan<TChange>;
    write: (candidateText: string, base: TSnapshot) => Promise<TSnapshot>;
    reload: () => Promise<TSnapshot>;
    replay: DocumentReplay<TSnapshot, TSession, TChange, TRecord>;
    /** True when the failure means the document moved before the upload. */
    isMoved: (error: unknown) => boolean;
  },
): Promise<SaveResult<TSnapshot>> {
  const plan = parts.prepare(session, base);

  try {
    return { snapshot: await parts.write(plan.candidateText, base), outcome: "written" };
  } catch (error: unknown) {
    if (!parts.isMoved(error)) throw error;
  }

  const latest = await parts.reload();

  // Replays the squashed list, which is what makes an interrupted save
  // self-healing: an upload that landed but could not be confirmed replays as
  // no-ops rather than conflicting or being applied twice.
  const rebased = parts.replay.replayChanges(plan.changes, latest);

  // Nothing to apply means the document already reflects this edit -- it
  // reached the store by another route, usually this application's own
  // unconfirmed upload. That is success, not an error to report.
  if (rebased.applied === 0) return { snapshot: latest, outcome: "already-applied" };

  // Re-prepared against the new base: squashing, admission and the
  // replay-equality check all run again, because the document they were
  // checked against has changed.
  const rebasedPlan = parts.prepare(rebased.session, latest);

  try {
    return { snapshot: await parts.write(rebasedPlan.candidateText, latest), outcome: "written-after-rebase" };
  } catch (error: unknown) {
    if (parts.isMoved(error)) throw new ConcurrentWriterDetected();
    throw error;
  }
}
