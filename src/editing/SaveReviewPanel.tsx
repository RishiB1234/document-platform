import type { ReactNode } from "react";

import type { ChangeDescription } from "./ChangeDescription.js";
import { ChangeSummaryList } from "./ChangeSummaryList.js";
import { NothingToSave, UnrecordedMutation } from "./prepareSave.js";

/**
 * Step 6: the human-readable summary of what would be written.
 *
 * It lists the **squashed** changes, not the recorded ones -- those are what the
 * document would be asked to reflect, and reviewing the raw list would review an
 * edit that is not the one being performed. Five keystroke-saves to one week are
 * one change to the document.
 *
 * Everything after this point is machinery, so the refusals are shown in full
 * rather than reduced to a disabled button. The refusal types are platform's,
 * which is why explaining them is too: an application that wrote its own
 * wording for these would be writing a second definition of when a save is
 * allowed.
 */
export function SaveReviewPanel({ descriptions, candidateBytes, recordedCount, error, notice, onSave, busy = false, onCancel }: { descriptions: readonly ChangeDescription[] | null; candidateBytes: number | null; recordedCount: number; error: unknown; notice?: ReactNode; onSave?: () => void; busy?: boolean; onCancel: () => void }) {
  return (
    <section className="panel record-editor" aria-label="Review save">
      <h3>Review what would be written</h3>
      {descriptions && (
        <>
          <p>
            {recordedCount} recorded {recordedCount === 1 ? "edit" : "edits"} reduce to {descriptions.length}{" "}
            {descriptions.length === 1 ? "change" : "changes"} against the loaded document
            {candidateBytes === null ? "" : `, and ${candidateBytes.toLocaleString()} bytes of validated JSON`}.
          </p>
          <ChangeSummaryList descriptions={descriptions} />
        </>
      )}
      {error !== null && error !== undefined && <p className="editor-issue" role="alert">{explainRefusal(error)}</p>}
      {notice && <p className="gate-message">{notice}</p>}
      <div className="editor-actions">
        {onSave && (
          // Disabled without a plan rather than hidden: the reason a save is
          // unavailable is the useful part, and it is stated above.
          <button className="primary-action" type="button" disabled={!descriptions || busy} onClick={onSave}>
            {busy ? "Saving…" : "Save to the store"}
          </button>
        )}
        <button type="button" onClick={onCancel}>{onSave ? "Cancel" : "Close"}</button>
      </div>
    </section>
  );
}

/** Why a prepared save was refused, in terms a person can act on. */
export function explainRefusal(error: unknown): string {
  if (error instanceof NothingToSave) return `${error.message}. The store would not be contacted.`;
  if (error instanceof UnrecordedMutation) {
    return "This edit cannot be saved: the document does not match a replay of its own recorded changes. Something changed the working copy without recording it. Discard the pending changes and redo the edit.";
  }
  // Admission failures land here -- a candidate that is invalid whole-document.
  return error instanceof Error ? error.message : "This edit cannot be prepared for saving.";
}
