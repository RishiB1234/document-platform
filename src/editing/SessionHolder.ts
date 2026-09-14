/**
 * Owns the current edit session and is the only way it can change.
 *
 * Every state transition is copy -> apply -> validate -> swap. Callers build a
 * new session from the current one and commit it; nothing mutates a session
 * that is already visible. Two properties follow, and both are structural
 * rather than conventions a caller has to remember:
 *
 *   - **Atomic.** The only observable transition is one assignment. A batch
 *     that fails halfway leaves a discarded draft and nothing else -- there is
 *     no partially applied state for anyone to read, cache, or upload. This is
 *     what makes a failing member of a bulk edit harmless.
 *   - **Always valid.** `commit` validates before swapping, so the current
 *     session has always passed the full admission path. A batch whose members
 *     are each individually fine can still be collectively inconsistent, and
 *     only whole-document validation catches that.
 *
 * The compare-and-swap is on object identity. Nothing mutates in place, so
 * `current` can only change by another commit, and every commit installs a new
 * object -- identity is therefore exact, and unlike a version counter it cannot
 * be forgotten. In a single-threaded runtime a synchronous
 * copy-apply-validate-commit can never lose the race; the CAS is what catches
 * the day someone slips an `await` into that path, and what lets an
 * asynchronous caller (the save flow, installing a post-upload snapshot)
 * decline to install rather than clobber an edit made while it was in flight.
 */
export class SessionCommitConflict extends Error {
  constructor() {
    super("The session changed while this commit was being prepared");
    this.name = "SessionCommitConflict";
  }
}

/** A commit was attempted while the holder is locked for a save. */
export class SessionLocked extends Error {
  constructor() {
    super("Editing is paused while this document is being saved");
    this.name = "SessionLocked";
  }
}

export class SessionHolder<TSession> {
  private session: TSession;
  private locked = false;

  /**
   * @param initial     a session that has already been validated.
   * @param validate    throws if a candidate session is not admissible.
   */
  constructor(initial: TSession, private readonly validate: (session: TSession) => void) {
    this.session = initial;
  }

  current(): TSession {
    return this.session;
  }

  /**
   * Install `next` only if the current session is still `base`.
   *
   * Rejects without changing anything when the session moved on, or when
   * `next` fails validation. A caller that loses the race keeps its own work:
   * nothing here mutates the caller's draft.
   */
  commit(base: TSession, next: TSession): void {
    if (this.locked) throw new SessionLocked();
    if (this.session !== base) throw new SessionCommitConflict();
    // Validate before swapping, never after: a failed validation must leave
    // the previous session in place rather than needing to be undone.
    this.validate(next);
    this.session = next;
  }

  /**
   * Best-effort install for asynchronous callers, such as the save flow
   * adopting a verified post-upload snapshot. Returns false when the session
   * moved while the caller was awaiting, so it can decline rather than discard
   * an edit made in the meantime. Declining alone is not enough after a save:
   * a saved change and a later edit to the same record squash into one that
   * conflicts with the store. `saveSession` carries later edits over instead.
   */
  tryCommit(base: TSession, next: TSession): boolean {
    if (this.locked) throw new SessionLocked();
    if (this.session !== base) return false;
    this.validate(next);
    this.session = next;
    return true;
  }

  /** True while a save holds the lock and every commit is refused. */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Refuse every commit until the returned release is called.
   *
   * For a save that would rather freeze editing than carry edits across it.
   * A second lock while one is held throws: two saves of one session at once
   * is a caller bug, and silently sharing the lock would let the first release
   * unfreeze editing under the second. Releasing twice is harmless.
   */
  lock(): () => void {
    if (this.locked) throw new SessionLocked();
    this.locked = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locked = false;
    };
  }
}
