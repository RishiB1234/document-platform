/**
 * How a guarded write can fail, named by what the caller must do next.
 *
 * These live beside the transaction rather than beside any particular store,
 * because the distinction they draw is the transaction's: it is what decides
 * whether an application may retry, must rebase, or must stop accepting edits.
 * A store adapter throws them; the orchestration and the UI branch on them.
 */

/** The document moved before the write. Reload, rebase, and try once more. */
export class DocumentMovedBeforeWrite extends Error {
  constructor(detail: string) {
    super(`The document changed before this write could start: ${detail}`);
    this.name = "DocumentMovedBeforeWrite";
  }
}

/** Live permission refused the write. Not retryable: nothing will change it. */
export class WriteNotPermitted extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "WriteNotPermitted";
  }
}

/**
 * The upload was sent and its result could not be confirmed.
 *
 * The one failure whose handling differs from every other: the store may or may
 * not already hold the new revision, so retrying compounds an unknown state.
 * The caller must reload and re-verify, and must stop accepting edits until it
 * does -- see "An unconfirmed save makes the session read-only".
 */
export class WriteUnconfirmed extends Error {
  constructor(detail: string, readonly cause?: unknown) {
    super(`The upload was sent but could not be confirmed: ${detail}`);
    this.name = "WriteUnconfirmed";
  }
}
