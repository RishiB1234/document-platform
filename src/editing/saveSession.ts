import { canonicalJson } from "../document/canonicalJson.js";
import type { DocumentReplay } from "./DocumentReplay.js";
import type { SavePlan } from "./prepareSave.js";
import type { ChangeIntent, ReplayableSnapshot } from "./ReplayAdapter.js";
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
  /** Changes recorded during the save and replayed onto the saved document. */
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
  changes: (session: TSession) => readonly TChange[];
  intent: (change: TChange) => ChangeIntent<TRecord>;
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
    const release = options.duringSave === "block" ? holder.lock() : () => {};
    let saved: SaveResult<TSnapshot>;
    try {
      saved = await saveDocument(session, base, parts);
    } finally {
      // Released before adopting: the install below is itself a commit.
      release();
    }
    return { ...saved, carried: adopt(holder, session, saved, parts) };
  } finally {
    saving.delete(holder);
  }
}

/** Moves the holder onto the saved document, replaying later edits. */
function adopt<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord>(
  holder: SessionHolder<TSession>,
  session: TSession,
  saved: SaveResult<TSnapshot>,
  parts: SaveSessionParts<TSnapshot, TSession, TChange, TRecord>,
): number {
  const current = holder.current();
  const before = parts.changes(session);
  const now = parts.changes(current);

  // The later edits are the tail after the changes that were saved, which is
  // only meaningful if those are still its prefix. Compared by intent rather
  // than identity: sessions are copied to be edited, so the change objects are
  // usually clones. An undo that removed a saved change and recorded another
  // in its place would pass a length check and silently drop both.
  const prefixKept =
    current === session ||
    (now.length >= before.length &&
      before.every((change, index) => canonicalJson(parts.intent(change)) === canonicalJson(parts.intent(now[index]!))));
  if (!prefixKept) throw new SavedButNotAdopted("rewritten", saved);

  const tail = now.slice(before.length);
  let next: TSession;
  try {
    next = parts.replay.replayChanges(tail, saved.snapshot).session;
  } catch (error: unknown) {
    if (error instanceof ReplayConflict) throw new SavedButNotAdopted("conflict", saved, error);
    throw error;
  }

  // Synchronous from reading `current` to here, so the commit cannot lose a
  // race; what it can still do is refuse the carried session as invalid.
  try {
    holder.commit(current, next);
  } catch (error: unknown) {
    throw new SavedButNotAdopted("invalid", saved, error);
  }
  return tail.length;
}
