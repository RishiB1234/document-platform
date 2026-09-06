import type { DocumentReplay } from "./DocumentReplay.js";
import type { ReplayableSnapshot } from "./ReplayAdapter.js";
import { squashChanges, type SquashAdapter } from "./squashChanges.js";

/** Everything a write needs, and nothing that has touched the network. */
export type SavePlan<TChange> = {
  /** The squashed net changes -- what the store would be asked to reflect. */
  changes: readonly TChange[];
  /** The exact bytes to upload. */
  candidateText: string;
};

/** The edit reduces to nothing, so the store must not be contacted. */
export class NothingToSave extends Error {
  constructor(readonly reason: "no-changes" | "cancelled-out" | "already-satisfied") {
    super(
      reason === "no-changes"
        ? "There are no recorded changes to save"
        : reason === "cancelled-out"
          ? "The recorded changes cancel each other out"
          : "The document already reflects every recorded change",
    );
    this.name = "NothingToSave";
  }
}

/** The candidate and the recorded changes disagree about what this edit is. */
export class UnrecordedMutation extends Error {
  constructor() {
    super("The candidate document does not match a replay of its own recorded changes");
    this.name = "UnrecordedMutation";
  }
}

/**
 * Steps 1-5 of the guarded save transaction: everything that decides *what* to
 * write, before anything is asked of the network.
 *
 * Pure and synchronous by design. Requesting a token or contacting the store
 * before this has passed would prompt for an edit that turns out to be empty or
 * inadmissible, and every check here is cheaper than a round trip.
 */
export function prepareSave<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord>(
  session: TSession,
  base: TSnapshot,
  parts: {
    replay: DocumentReplay<TSnapshot, TSession, TChange, TRecord>;
    squash: SquashAdapter<TChange, TRecord>;
    changes: (session: TSession) => readonly TChange[];
    baseFileId: (session: TSession) => string;
    serialize: (session: TSession) => string;
    validate: (session: TSession) => void;
  },
): SavePlan<TChange> {
  // Step 1. The base fixes what "unchanged" means for every comparison below,
  // so a session and a snapshot describing different documents cannot be
  // compared at all.
  if (parts.baseFileId(session) !== base.fileId) {
    throw new Error("Cannot save an edit session against a different document");
  }

  const raw = parts.changes(session);
  if (raw.length === 0) throw new NothingToSave("no-changes");

  // Step 3. One deterministic serialization, so steps 5 and the post-write
  // verification compare meaning rather than formatting.
  const candidateText = parts.serialize(session);

  // Step 4. Admission control, not verification: the same path downloaded data
  // passes through, run before the document can reach the store rather than
  // after. Members of a batch can each be valid and collectively inconsistent,
  // and only whole-document validation catches that.
  parts.validate(session);

  // Squashing happens here and nowhere else. The candidate above was built from
  // the raw list on purpose -- see the comparison below.
  const changes = squashChanges(raw, parts.squash);
  if (changes.length === 0) throw new NothingToSave("cancelled-out");

  // Step 5. Replay the squashed list against the exact base. Two different
  // failures are caught here, which is why this is not a duplicate of step 4:
  const replayed = parts.replay.replayChanges(changes, base);

  // ...an edit that reduces to nothing against its own base, such as a change
  // made and then undone. Semantically empty edits must not contact the store.
  if (replayed.applied === 0) throw new NothingToSave("already-satisfied");

  // ...and a candidate that its own recorded changes do not reproduce. That is
  // a mutation which bypassed the change recorder, or a squash that altered the
  // meaning of the edit. Comparing a replay of the *squashed* list against a
  // candidate built from the *raw* list is what makes this a real check: build
  // the candidate from the squashed list and it would compare the squasher
  // against itself and verify nothing.
  if (parts.serialize(replayed.session) !== candidateText) throw new UnrecordedMutation();

  return { changes, candidateText };
}
