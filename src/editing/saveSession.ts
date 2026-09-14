import { canonicalJson } from "../document/canonicalJson.js";
import type { DocumentReplay, ReplayResult } from "./DocumentReplay.js";
import type { SavePlan } from "./prepareSave.js";
import type { ReplayableSnapshot } from "./ReplayAdapter.js";
import { ReplayConflict } from "./ReplayConflict.js";
import { saveDocument, type SaveResult } from "./saveDocument.js";
import type { SessionHolder } from "./SessionHolder.js";

/**
 * What happens to edits the user makes while an upload is in flight.
 *
 *   - `"carry-over"` (default): editing continues. Once the write is verified,
 *     the changes recorded after the save began are replayed onto the saved
 *     document, and that session is installed.
 *   - `"block"`: the holder is locked for the duration, so every commit throws
 *     `SessionLocked` and the saved document is installed as-is.
 */
export type DuringSave = "carry-over" | "block";

export type SaveSessionResult<TSnapshot> = SaveResult<TSnapshot> & {
  /**
   * Changes recorded during the save that were replayed onto the saved
   * document and are still pending. Excludes any the saved document already
   * satisfied -- such as another writer's identical edit arriving by rebase --
   * because replay drops those rather than recording them.
   */
  carried: number;
};

/** A save of this holder is already running. */
export class SaveInProgress extends Error {
  constructor() {
    super("This document is already being saved");
    this.name = "SaveInProgress";
  }
}

/**
 * The write succeeded, but the holder could not be moved onto what was saved.
 *
 * Carries the verified result, because the store really did change: the
 * application still needs `saved.snapshot` as its new base and cache entry.
 * The holder keeps the session it had, with every change still recorded.
 */
export class SavedButNotAdopted<TSnapshot> extends Error {
  constructor(
    /**
     * - `conflict`: an edit made during the save no longer applies to what was
     *   saved -- a rebase brought in another writer's change to the same record.
     * - `rewritten`: the session's earlier changes were altered while saving,
     *   such as by an undo, so there is no well-defined set of later edits.
     * - `invalid`: the carried-over session failed validation.
     */
    readonly reason: "conflict" | "rewritten" | "invalid",
    readonly saved: SaveResult<TSnapshot>,
    readonly cause?: unknown,
  ) {
    super(
      reason === "conflict"
        ? "Saved, but an edit you made while saving conflicts with the saved document"
        : reason === "rewritten"
          ? "Saved, but your earlier changes were altered while saving"
          : "Saved, but the edits you made while saving do not form a valid document",
    );
    this.name = "SavedButNotAdopted";
  }
}

export type SaveSessionParts<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord> = {
  prepare: (session: TSession, base: TSnapshot) => SavePlan<TChange>;
  write: (candidateText: string, base: TSnapshot) => Promise<TSnapshot>;
  reload: () => Promise<TSnapshot>;
  replay: DocumentReplay<TSnapshot, TSession, TChange, TRecord>;
  isMoved: (error: unknown) => boolean;
  /**
   * Recorded changes, in order. Each must be plain JSON data: carrying over
   * compares whole changes by canonical JSON, and a change that cannot be
   * canonicalized is refused before anything is written.
   */
  changes: (session: TSession) => readonly TChange[];
};

const saving = new WeakSet<object>();

/**
 * Saves the holder's current session and installs the result in the holder.
 *
 * `saveDocument` alone cannot do the second half safely. The session it saved
 * is stale the moment the user edits during the upload, and the two obvious
 * installs both fail: replacing the session discards the edit, and declining
 * keeps a session whose next save squashes the saved change with the new one
 * -- `A->B` then `B->C` becomes `A->C`, which conflicts with a store that now
 * reads `B`. The user would conflict with their own write.
 *
 * Carrying over avoids both. Only the changes recorded after the save began
 * are replayed, onto the verified snapshot; their `before` values describe the
 * state that was just written, so they apply cleanly unless a rebase brought in
 * a real conflict. A failed save changes nothing here: the session keeps every
 * recorded change, exactly as `saveDocument` leaves it.
 */
export async function saveSession<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord>(
  holder: SessionHolder<TSession>,
  base: TSnapshot,
  parts: SaveSessionParts<TSnapshot, TSession, TChange, TRecord>,
  options: { duringSave?: DuringSave } = {},
): Promise<SaveSessionResult<TSnapshot>> {
  if (saving.has(holder)) throw new SaveInProgress();
  saving.add(holder);

  try {
    const session = holder.current();
    // Taken before the write, so a change that cannot be compared fails while
    // nothing has reached the store, rather than after the write has landed.
    const savedChanges = parts.changes(session).map((change) => canonicalJson(change));
    const release = options.duringSave === "block" ? holder.lock() : () => {};
    let saved: SaveResult<TSnapshot>;
    try {
      saved = await saveDocument(session, base, parts);
    } finally {
      // Released before adopting: the install below is itself a commit.
      release();
    }
    return { ...saved, carried: adopt(holder, session, savedChanges, saved, parts) };
  } finally {
    saving.delete(holder);
  }
}

/** Moves the holder onto the saved document, replaying later edits. */
function adopt<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord>(
  holder: SessionHolder<TSession>,
  session: TSession,
  savedChanges: readonly string[],
  saved: SaveResult<TSnapshot>,
  parts: SaveSessionParts<TSnapshot, TSession, TChange, TRecord>,
): number {
  const current = holder.current();
  const now = parts.changes(current);

  // The later edits are the tail after the changes that were saved, which is
  // only meaningful if those are still its prefix. Compared as whole changes,
  // by canonical JSON:
  //
  //   - Not by identity. Sessions are copied to be edited, so the change
  //     objects are usually clones.
  //   - Not by length. An undo that removed a saved change and recorded
  //     another in its place passes a length check and silently drops both.
  //   - Not by intent. An intent need not say which record it targets -- a
  //     positional adapter keeps the target on the change -- so `slot 0: A->B`
  //     and `slot 1: A->B` share an intent and are different edits.
  //
  // The whole change is sufficient because it is all replay ever sees:
  // `locate` and `mutate` receive the session and the change, nothing else.
  // Two changes with equal canonical JSON therefore replay identically. The
  // comparison can only err towards "rewritten" -- say, a change rebuilt with
  // a fresh timestamp -- which refuses loudly instead of losing an edit.
  const prefixKept =
    current === session ||
    (now.length >= savedChanges.length && savedChanges.every((text, index) => sameChange(text, now[index])));
  if (!prefixKept) throw new SavedButNotAdopted("rewritten", saved);

  const tail = now.slice(savedChanges.length);
  let replayed: ReplayResult<TSession>;
  try {
    replayed = parts.replay.replayChanges(tail, saved.snapshot);
  } catch (error: unknown) {
    if (error instanceof ReplayConflict) throw new SavedButNotAdopted("conflict", saved, error);
    throw error;
  }

  // Synchronous from reading `current` to here, so the commit cannot lose a
  // race; what it can still do is refuse the carried session as invalid.
  try {
    holder.commit(current, replayed.session);
  } catch (error: unknown) {
    throw new SavedButNotAdopted("invalid", saved, error);
  }
  // Applied, not the tail's length: no-ops are dropped from the new session,
  // so counting them would report pending work the holder does not have.
  return replayed.applied;
}

/** A change recorded after the save began can be anything, JSON or not. */
function sameChange(savedText: string, change: unknown): boolean {
  try {
    return canonicalJson(change) === savedText;
  } catch {
    return false;
  }
}
