/**
 * What an application must supply to reuse the replay engine.
 *
 * The split is the whole point of the abstraction. Deciding *whether* a change
 * conflicts is platform's, because that is a data-integrity rule that must not
 * vary between applications. Knowing *which record* a change refers to and
 * *what makes two records equal* is the application's, because that genuinely
 * differs -- fitness-board looks records up by slug, book-catalog has no stable
 * identity and must locate positionally.
 *
 * An adapter therefore only answers questions about records. It never decides
 * applied, no-op, or conflict, and `mutate` must contain no conflict logic.
 */

/** The snapshot fields the engine needs. Domain data stays opaque to it. */
export type ReplayableSnapshot = {
  fileId: string;
  documentText: string;
  data: unknown;
};

/** What a recorded change intends, in terms the engine can reason about. */
export type ChangeIntent<TRecord> =
  | { operation: "add"; after: TRecord }
  | { operation: "update"; before: TRecord; after: TRecord }
  | { operation: "delete"; before: TRecord };

export interface ReplayAdapter<TSnapshot extends ReplayableSnapshot, TSession, TChange, TRecord> {
  /**
   * A fresh session over the latest snapshot, carrying no recorded changes.
   *
   * Must be built from `snapshot.documentText`, not from `snapshot.data`. A
   * fresh parse yields an object graph sharing nothing with the snapshot, so a
   * rebase cannot reach into the caller's validated last-known-good copy.
   */
  createSession(snapshot: TSnapshot): TSession;

  /** The document a session was based on, so replay cannot cross documents. */
  baseFileId(session: TSession): string;

  /** Recorded changes, in the order they were recorded. */
  changes(session: TSession): readonly TChange[];

  /** What this change intends, and the records it was recorded against. */
  intent(change: TChange): ChangeIntent<TRecord>;

  /** The record this change refers to in the given session, or null if absent. */
  locate(session: TSession, change: TChange): TRecord | null;

  /** Whether two records are the same for conflict purposes. */
  equals(left: TRecord, right: TRecord): boolean;

  /** Perform the change. No conflict checks -- the engine has already decided. */
  mutate(session: TSession, change: TChange): void;
}
