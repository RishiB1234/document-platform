import type { ChangeIntent } from "./ReplayAdapter.js";

/**
 * What squashing needs from an application, and nothing more.
 *
 * Deliberately separate from `ReplayAdapter`: replay never needs a record's
 * identity as a value -- it asks `locate` instead -- and widening that contract
 * for a second caller would make every future adapter implement something its
 * replay path does not use.
 */
export interface SquashAdapter<TChange, TRecord> {
  /** One comparable key naming the record a change refers to. */
  identityOf(change: TChange): string;
  intent(change: TChange): ChangeIntent<TRecord>;
  /** A change like `template`, carrying `intent` instead of its own. */
  rebuild(template: TChange, intent: ChangeIntent<TRecord>): TChange;
}

/** A sequence of changes to one record that cannot have been recorded. */
export class UnsquashableHistory extends Error {
  constructor(identity: string, detail: string) {
    // Names the identity, never record contents: this can reach a log.
    super(`Cannot squash the recorded changes to ${identity}: ${detail}`);
    this.name = "UnsquashableHistory";
  }
}

/**
 * Collapses repeated changes to one record into a single net change.
 *
 * Runs at the save boundary and nowhere else. The session keeps the raw ordered
 * list, so undo still works and this stays a pure function that can be tested
 * standalone -- a bug in it cannot corrupt anything that persists.
 *
 * **Why the recorded history is rewritten at all.** Replaying `A→B` then `B→C`
 * against a document that already reads `C` fails: the first change matches
 * neither its `before` nor its `after`, so it conflicts on a document that is
 * already exactly what the user wanted. That is the ordinary shape of the
 * recovery path -- two edits, one save, one lost confirmation -- so unsquashed
 * replay breaks the flow the design prescribes. Squashed, `A→C` no-ops cleanly.
 *
 * **Why that is safe.** The candidate is built from the raw list and the
 * squashed list is replayed against the base, with the two serializations
 * required to match. A squashing bug is therefore a refused save, loudly,
 * before anything reaches the store.
 *
 * **Why this is sound only because identity is immutable.** A rename is a
 * delete and an add at two *different* identities, so it never collapses into
 * an update. Relax that rule and this table starts merging renames, which is a
 * silent record overwrite.
 *
 * Ordering is by first appearance. The conflict decision is per-record so
 * cross-record order cannot affect it, but mutations append and the candidate
 * bytes must stay deterministic.
 */
export function squashChanges<TChange, TRecord>(
  changes: readonly TChange[],
  adapter: SquashAdapter<TChange, TRecord>,
): TChange[] {
  const groups = new Map<string, { members: TChange[]; net: ChangeIntent<TRecord> | null }>();

  for (const change of changes) {
    const identity = adapter.identityOf(change);
    const intent = adapter.intent(change);
    const group = groups.get(identity);
    if (!group) {
      groups.set(identity, { members: [change], net: intent });
      continue;
    }
    group.members.push(change);
    group.net = combine(identity, group.net, intent);
  }

  const squashed: TChange[] = [];
  for (const { members, net } of groups.values()) {
    // An add followed by a delete leaves nothing to write.
    if (net === null) continue;
    // A single change is emitted untouched. Rebuilding it would be a
    // round trip through the constructors for no gain, and this keeps the
    // common case free of any reconstruction at all.
    squashed.push(members.length === 1 ? members[0]! : adapter.rebuild(members[members.length - 1]!, net));
  }
  return squashed;
}

/** The net of one record's history so far, combined with its next change. */
function combine<TRecord>(
  identity: string,
  net: ChangeIntent<TRecord> | null,
  next: ChangeIntent<TRecord>,
): ChangeIntent<TRecord> | null {
  if (net === null) {
    // The record was added and deleted; anything after that is a fresh add.
    if (next.operation === "add") return next;
    throw new UnsquashableHistory(identity, `a ${next.operation} follows a delete of a record that was never in the document`);
  }

  switch (net.operation) {
    case "add":
      // Still an add, now of the later contents: the base has never seen it.
      if (next.operation === "update") return { operation: "add", after: next.after };
      if (next.operation === "delete") return null;
      throw new UnsquashableHistory(identity, "two additions of the same record");

    case "update":
      // `before` stays the original: the intermediate states were never in the
      // document the changes will be replayed against.
      if (next.operation === "update") return { operation: "update", before: net.before, after: next.after };
      if (next.operation === "delete") return { operation: "delete", before: net.before };
      throw new UnsquashableHistory(identity, "an addition of a record that already exists");

    case "delete":
      // Deleted then re-added at the same identity is an update in net effect,
      // and asks replay the same questions a delete-plus-add would.
      if (next.operation === "add") return { operation: "update", before: net.before, after: next.after };
      throw new UnsquashableHistory(identity, `a ${next.operation} follows a delete`);
  }
}
