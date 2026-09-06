import { useState, type ReactNode } from "react";

import type { ChangeDescription } from "./ChangeDescription.js";
import { ChangeSummaryList } from "./ChangeSummaryList.js";

export type BarAction = { label: string; onClick: () => void };

/**
 * What is pending, pinned to the bottom of the viewport.
 *
 * This used to be a panel at the top of the page, which pushed the data the
 * user came to read off the screen and grew taller with every edit. A status
 * bar stays out of the way, stays visible while scrolling, and keeps the
 * primary actions within thumb reach on a phone.
 *
 * The detail is collapsed by default: the count is what matters while editing,
 * and the full review belongs in the save dialog. Expanding is still offered,
 * because "what exactly have I changed" is a fair question to ask mid-edit.
 */
export function EditingStatusBar({ descriptions, selection, notice, onReview, onDiscard }: {
  descriptions: readonly ChangeDescription[];
  /** A pending bulk selection, which is not yet a recorded change. */
  selection?: { summary: string; review: BarAction; clear: BarAction } | null;
  notice?: ReactNode;
  onReview?: () => void;
  onDiscard: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (descriptions.length === 0 && !selection) return null;

  return (
    <div className="editing-bar" role="region" aria-label="Pending edits">
      {selection && (
        <div className="editing-bar-row">
          <span>{selection.summary}</span>
          <button type="button" onClick={selection.review.onClick}>{selection.review.label}</button>
          <button type="button" onClick={selection.clear.onClick}>{selection.clear.label}</button>
        </div>
      )}
      {descriptions.length > 0 && (
        <div className="editing-bar-row">
          <button type="button" className="editing-bar-count" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {descriptions.length} pending {descriptions.length === 1 ? "change" : "changes"}
          </button>
          {onReview && <button type="button" className="primary-action" onClick={onReview}>Review &amp; save</button>}
          <button type="button" onClick={onDiscard}>Discard all</button>
        </div>
      )}
      {expanded && descriptions.length > 0 && (
        <div className="editing-bar-detail">
          <ChangeSummaryList descriptions={descriptions} />
          {notice && <p className="gate-message">{notice}</p>}
        </div>
      )}
    </div>
  );
}
