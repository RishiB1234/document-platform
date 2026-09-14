import { expect, it } from "vitest";

import { DocumentReplay } from "../src/editing/DocumentReplay";
import { prepareSave } from "../src/editing/prepareSave";
import type { ChangeIntent, ReplayAdapter, ReplayableSnapshot } from "../src/editing/ReplayAdapter";
import { saveSession } from "../src/editing/saveSession";
import { SessionHolder } from "../src/editing/SessionHolder";
import type { SquashAdapter } from "../src/editing/squashChanges";

type Change = { at: number } & ChangeIntent<string>;
type Snapshot = ReplayableSnapshot & { data: string[] };
type Session = { baseFileId: string; changes: Change[]; records: string[] };

const snapshot = (records: string[]): Snapshot => ({
  fileId: "f",
  documentText: JSON.stringify(records),
  data: records,
});

const intentOf = (change: Change): ChangeIntent<string> => {
  switch (change.operation) {
    case "add":
      return { operation: "add", after: change.after };
    case "update":
      return { operation: "update", before: change.before, after: change.after };
    case "delete":
      return { operation: "delete", before: change.before };
  }
};

const adapter: ReplayAdapter<Snapshot, Session, Change, string> = {
  createSession: (from) => ({
    baseFileId: from.fileId,
    changes: [],
    records: JSON.parse(from.documentText) as string[],
  }),
  baseFileId: (session) => session.baseFileId,
  changes: (session) => session.changes,
  intent: intentOf,
  locate: (session, change) => session.records[change.at] ?? null,
  equals: (left, right) => left === right,
  mutate: (session, change) => {
    if (change.operation !== "update") throw new Error("updates only");
    session.records[change.at] = change.after;
    session.changes.push(structuredClone(change));
  },
};

const replay = new DocumentReplay(adapter);
const squash: SquashAdapter<Change, string> = {
  identityOf: (change) => String(change.at),
  intent: adapter.intent,
  rebuild: (template, intent) => ({ at: template.at, ...intent }),
};
const update = (at: number): Change => ({ operation: "update", at, before: "A", after: "B" });

/*
 * `ChangeIntent` does not identify the target of a change. A positional
 * adapter may carry that only on TChange, so equal intents are not enough to
 * prove that the saved history remains the current history's prefix.
 */
it.fails("does not mistake an identical intent at another position for the saved change", async () => {
  const base = snapshot(["A", "A"]);
  const initial = adapter.createSession(base);
  adapter.mutate(initial, update(0));
  const holder = new SessionHolder(initial, () => {});

  await saveSession(holder, base, {
    prepare: (session, from) =>
      prepareSave(session, from, {
        replay,
        squash,
        changes: adapter.changes,
        baseFileId: adapter.baseFileId,
        serialize: (value) => JSON.stringify(value.records),
        validate: () => {},
      }),
    write: async (candidateText) => {
      const current = holder.current();
      // Undo slot 0, then make the same A->B edit to slot 1 while saving.
      holder.commit(current, { baseFileId: "f", changes: [update(1)], records: ["A", "B"] });
      return snapshot(JSON.parse(candidateText) as string[]);
    },
    reload: async () => base,
    replay,
    isMoved: () => false,
    changes: adapter.changes,
    intent: adapter.intent,
  });

  expect(holder.current().records).toEqual(["A", "B"]);
});
