import type { ChangeDescription } from "./ChangeDescription.js";

/**
 * The one place a list of pending changes is laid out, shared by both review
 * panels so they cannot drift into describing the same edit differently.
 */
export function ChangeSummaryList({ descriptions }: { descriptions: readonly ChangeDescription[] }) {
  return (
    <ol className="pending-list">
      {descriptions.map((description, index) => (
        // Recorded changes are an append-only list within a session, and a
        // squashed list is derived from it in order, so position is stable for
        // as long as any of these are rendered.
        <li key={index}>
          <strong>{description.title}</strong>
          {description.fields.length > 0 && (
            <ul className="pending-fields">{description.fields.map((field) => <li key={field}>{field}</li>)}</ul>
          )}
        </li>
      ))}
    </ol>
  );
}
