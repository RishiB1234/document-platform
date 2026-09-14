# `@rishib1234/document-platform`

A TypeScript platform for web applications whose source of truth is a JSON
document.

It handles the infrastructure around that document: loading it, validating it,
keeping a safe local copy, opening it from Google Drive, recording edits,
detecting conflicts, reviewing changes, and saving verified bytes back to the
store. The application supplies the meaning of the document and its changes.

For example, a web app called **Troy War Simulator** could store armies and
battles in one `troy-war.json` file. This package can safely move that document
through the browser and Google Drive. Troy War Simulator still decides how an
army attacks, what counts as a valid unit, and how a battle changes the record.

```text
Google Drive or bundled JSON
            |
            v
    load and validate
            |
            v
 validated snapshot ----> private browser cache
            |
            v
 isolated edit session
            |
            v
 replay + validate + review
            |
            v
 guarded write and read-back verification
```

## What the platform provides

| Area | Supported functions |
| --- | --- |
| Documents | Parse and validate incoming JSON, produce deterministic JSON, load a bundled document, download the exact stored bytes |
| Google Drive | Configure one expected file, authenticate, open the picker, read metadata and content, check edit permission, upload, and verify the result |
| Cache | Keep the last validated snapshot in IndexedDB and notify other tabs when it changes |
| Editing | Install immutable edit sessions atomically, replay add/update/delete changes, detect conflicts, and squash repeated edits to the same record |
| Saving | Reject empty or invalid saves, detect unrecorded mutation, rebase once if the document moved, carry over or block edits made during a save, and preserve local edits when saving cannot continue safely |
| React UI | Online status, Drive and cache hooks, editing status, change summaries, save review, modal, and build stamp components |

The core package has no React runtime requirement. React hooks and components
live in a separate entry point:

```ts
import {
  BundledDocumentSource,
  ConcurrentWriterDetected,
  DocumentCacheChannel,
  DocumentDownloader,
  DocumentMovedBeforeWrite,
  DocumentReplay,
  GoogleAccessTokenProvider,
  GoogleBrowserLibraries,
  GoogleDriveConfiguration,
  GoogleDriveDocumentSource,
  GoogleDriveDocumentWriter,
  GoogleDriveFilePicker,
  ReplayConflict,
  SavedButNotAdopted,
  SessionHolder,
  SessionLocked,
  ValidatedDocumentCache,
  WriteUnconfirmed,
  canonicalJson,
  isRecordId,
  mintRecordId,
  prepareSave,
  saveSession,
  visibleSnapshot,
  type ChangeIntent,
  type ReplayAdapter,
  type SquashAdapter,
  type ValidatedDocumentSnapshot,
} from "@rishib1234/document-platform";

import {
  EditingStatusBar,
  SaveReviewPanel,
  useGoogleDriveSync,
  useOnlineStatus,
  useValidatedDocumentCache,
} from "@rishib1234/document-platform/react";
```

## Troy War Simulator: a worked example

Troy War Simulator is an example consumer, not an application included in this
repository. Its document might look like this:

```json
{
  "schemaVersion": 1,
  "armies": [
    { "id": "trjy5n8k2m", "name": "Trojans", "strength": 900 },
    { "id": "ach3an7x5q", "name": "Achaeans", "strength": 1100 }
  ],
  "battles": []
}
```

The application first defines its own domain contract:

```ts
type Army = {
  id: string;
  name: string;
  strength: number;
};

type Battle = {
  id: string;
  attackerId: string;
  defenderId: string;
  victorId: string;
};

type WarDocument = {
  schemaVersion: 1;
  armies: Army[];
  battles: Battle[];
};

type ArmyChange = {
  kind: "army";
  armyId: string;
  intent: ChangeIntent<Army>;
};

type WarSession = {
  baseFileId: string;
  data: WarDocument;
  changes: ArmyChange[];
};
```

Every persisted record has a stable record ID. Troy War Simulator uses the
platform's 10-character format for armies and battles, and requires IDs to be
unique across the whole document. An ID identifies the record for its entire
lifetime: editing, moving, or replaying a record never changes it.

The format and the generator come from the platform; which objects are records
is the application's to say:

```ts
function allRecordIds(document: WarDocument): Set<string> {
  return new Set([
    ...document.armies.map(army => army.id),
    ...document.battles.map(battle => battle.id),
  ]);
}
```

`mintRecordId` takes anything with a `has(id)` method, draws from
`crypto.getRandomValues` without modulo bias, and retries a bounded number of
times if the new ID is already taken, throwing rather than falling back to a
predictable value. `RECORD_ID_ALPHABET` and `RECORD_ID_LENGTH` are exported for
anything outside TypeScript that must agree with the format. Traversal stays in
the application: only Troy War Simulator knows that armies and battles are its
records, so it builds the taken set and the platform never walks the document.

Here is a deliberately small parser. A production app would usually report
more precise errors and validate every nested field:

```ts
function parseWarDocument(text: string): WarDocument {
  const value: unknown = JSON.parse(text);

  if (
    typeof value !== "object" || value === null ||
    !("schemaVersion" in value) || value.schemaVersion !== 1 ||
    !("armies" in value) || !Array.isArray(value.armies) ||
    !("battles" in value) || !Array.isArray(value.battles)
  ) {
    throw new Error("This is not a Troy War Simulator v1 document");
  }

  const document = value as WarDocument;
  const ids = [
    ...document.armies.map(army => army.id),
    ...document.battles.map(battle => battle.id),
  ];

  if (!ids.every(isRecordId)) {
    throw new Error("Every record needs a valid 10-character record ID");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("Record IDs must be unique across the whole document");
  }

  return document;
}
```

That parser is the boundary between untrusted text and application data. The
platform calls it whenever a document enters from a bundle, Drive, or cache,
and again before a candidate can be saved. The platform does not prescribe a
validation library. An app can use a hand-written parser or the optional
`JsonSchemaValidator` helper with a compiled validator.

### 1. Start with a bundled campaign

A bundled document gives first-time visitors a real, read-only example without
requiring Google credentials:

```ts
const demo = new BundledDocumentSource<WarDocument>(
  "/troy-war.json",
  parseWarDocument,
);

const war = await demo.load();
```

### 2. Connect the real document

The deployed app can configure one expected Google Drive file and load it as a
validated snapshot:

```ts
const application = {
  applicationId: "troy-war-simulator",
  schemaVersion: 1,
  documentName: "troy-war.json",
};

const config = GoogleDriveConfiguration.create(
  application,
  {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY,
    projectNumber: import.meta.env.VITE_GOOGLE_PROJECT_NUMBER,
    fileId: import.meta.env.VITE_TROY_DOCUMENT_ID,
  },
);

const libraries = new GoogleBrowserLibraries();
const tokenProvider = new GoogleAccessTokenProvider(config, libraries);
const picker = new GoogleDriveFilePicker(config, libraries, tokenProvider);
const source = new GoogleDriveDocumentSource(
  config, picker, tokenProvider, parseWarDocument,
);
const writer = new GoogleDriveDocumentWriter(
  config.fileId, tokenProvider, parseWarDocument,
);

function requireSnapshot<T>(
  value: ValidatedDocumentSnapshot<T> | null,
): ValidatedDocumentSnapshot<T> {
  if (!value) throw new Error("No document was selected");
  return value;
}

const snapshot = requireSnapshot(await source.load(true));
```

The snapshot contains parsed data, exact source text, file identity, revision
information, metadata, and current edit permission. The picker and source
refuse a different Drive file even if it has the expected name.

### 3. Cache only validated data

`ValidatedDocumentCache` stores the last validated snapshot in IndexedDB. It
re-parses cached text on read and discards an invalid entry. A
`DocumentCacheChannel` lets other tabs refresh after the cache changes.

```ts
const cache = new ValidatedDocumentCache<WarDocument>(
  "troy-war-simulator", config.fileId, 1, parseWarDocument,
);
const cacheChannel = new DocumentCacheChannel("troy-war-simulator");

await cache.save(snapshot, new Date().toISOString());
cacheChannel.announceChange();

const cached = await cache.load();
const documentToShow = visibleSnapshot(
  verifiedThisSession,
  liveSnapshot,
  cached?.snapshot ?? null,
);
```

A cached private document is not displayed before the current browser session
has authorized access. `visibleSnapshot` exposes a live snapshot, or a cached
fallback, only after that authorization has happened.

### 4. Record changes in an isolated session

Troy War Simulator creates its own session and change types. `SessionHolder`
provides the safe installation boundary:

```ts
function createSession(snapshot: ValidatedDocumentSnapshot<WarDocument>): WarSession {
  return {
    baseFileId: snapshot.fileId,
    data: parseWarDocument(snapshot.documentText),
    changes: [],
  };
}

function validateWarSession(session: WarSession): void {
  parseWarDocument(canonicalJson(session.data));
}

const holder = new SessionHolder(createSession(snapshot), validateWarSession);
const base = holder.current();
const draft = structuredClone(base);
const army = draft.data.armies.find(item => item.id === "ach3an7x5q")!;
const before = structuredClone(army);
army.strength = 940;
draft.changes.push({
  kind: "army",
  armyId: army.id,
  intent: { operation: "update", before, after: structuredClone(army) },
});

holder.commit(base, draft);
```

Adding an army mints its ID once and records that same ID in the change. Replay
reuses it; it never generates a replacement:

```ts
const base = holder.current();
const draft = structuredClone(base);
const newArmy: Army = {
  id: mintRecordId(allRecordIds(draft.data)),
  name: "Myrmidons",
  strength: 300,
};

draft.data.armies.push(newArmy);
draft.changes.push({
  kind: "army",
  armyId: newArmy.id,
  intent: { operation: "add", after: structuredClone(newArmy) },
});

holder.commit(base, draft);
```

The app copies and changes the draft; the platform validates and swaps it in as
one operation. Failed validation or a stale base leaves the visible session
unchanged.

For replay, the app supplies a `ReplayAdapter` that says how to create a
session, find an army or battle by stable ID, compare records, and apply a
change. `DocumentReplay` owns the decision to apply a change, treat it as
already applied, or report a conflict.

```ts
const warReplayAdapter: ReplayAdapter<
  ValidatedDocumentSnapshot<WarDocument>,
  WarSession,
  ArmyChange,
  Army
> = {
  createSession,
  baseFileId: session => session.baseFileId,
  changes: session => session.changes,
  intent: change => change.intent,
  locate: (session, change) =>
    session.data.armies.find(army => army.id === change.armyId) ?? null,
  equals: (left, right) => canonicalJson(left) === canonicalJson(right),
  mutate: (session, change) => {
    const index = session.data.armies.findIndex(army => army.id === change.armyId);
    const intent = change.intent;

    if (intent.operation === "add") session.data.armies.push(intent.after);
    if (intent.operation === "update") session.data.armies[index] = intent.after;
    if (intent.operation === "delete") session.data.armies.splice(index, 1);
    session.changes.push(change);
  },
};

const replay = new DocumentReplay(warReplayAdapter);
const result = replay.replayChanges(pendingChanges, latestSnapshot);
```

The replay adapter contains domain mechanics only. It does not decide whether a
change conflicts; `DocumentReplay` makes that decision before calling `mutate`.

### 5. Prepare and review the save

`prepareSave` performs the complete local check before the app requests a token
or contacts Drive. It:

1. Confirms the session belongs to the loaded file.
2. Refuses a session with no recorded changes.
3. Serializes deterministically and validates the whole candidate.
4. Squashes repeated changes to each stable record ID.
5. Replays those changes against the base and confirms they reproduce the exact candidate.

```ts
const warSquashAdapter: SquashAdapter<ArmyChange, Army> = {
  identityOf: change => change.armyId,
  intent: change => change.intent,
  rebuild: (template, intent) => ({ ...template, intent }),
};

const session = holder.current();
const plan = prepareSave(session, snapshot, {
  replay,
  squash: warSquashAdapter,
  changes: session => session.changes,
  baseFileId: session => session.baseFileId,
  serialize: session => canonicalJson(session.data),
  validate: validateWarSession,
});
```

The app can turn `plan.changes` into Troy-specific descriptions such as
“Reduce Achaean strength from 1,100 to 940.” `SaveReviewPanel` displays those
net changes and the validated JSON byte count before the user saves.

```ts
const descriptions = plan.changes.map(change => {
  const intent = change.intent;
  if (intent.operation === "add") {
    return { title: `Add ${intent.after.name}`, fields: [] };
  }
  if (intent.operation === "delete") {
    return { title: `Remove ${intent.before.name}`, fields: [] };
  }
  return {
    title: `Update ${intent.after.name}`,
    fields: [`Strength: ${intent.before.strength} → ${intent.after.strength}`],
  };
});
```

```tsx
<EditingStatusBar
  descriptions={descriptions}
  onReview={() => setReviewing(true)}
  onDiscard={discardPendingChanges}
/>

{reviewing && (
  <SaveReviewPanel
    descriptions={descriptions}
    candidateBytes={new Blob([plan.candidateText]).size}
    recordedCount={session.changes.length}
    error={null}
    onSave={save}
    onCancel={() => setReviewing(false)}
  />
)}
```

### 6. Save with conflict protection

`saveSession` saves the holder's session (preparation, writing, one bounded
rebase) and then moves the holder onto what was saved:

```ts
const prepareWarSave = (session: WarSession, base: ValidatedDocumentSnapshot<WarDocument>) =>
  prepareSave(session, base, {
    replay,
    squash: warSquashAdapter,
    changes: value => value.changes,
    baseFileId: value => value.baseFileId,
    serialize: value => canonicalJson(value.data),
    validate: validateWarSession,
  });

const saveParts = {
  prepare: prepareWarSave,
  write: (text: string, base: ValidatedDocumentSnapshot<WarDocument>) => writer.write(text, base),
  reload: () => source.load(false).then(requireSnapshot),
  replay,
  isMoved: (error: unknown) => error instanceof DocumentMovedBeforeWrite,
  changes: (session: WarSession) => session.changes,
  intent: (change: ArmyChange) => change.intent,
};

const result = await saveSession(holder, snapshot, saveParts);
await cache.save(result.snapshot, new Date().toISOString());
```

Before uploading, `GoogleDriveDocumentWriter` checks live edit permission, file
identity, revision, and current bytes. After uploading, it reads the document
back, verifies the revision and exact content, parses it again, and returns the
verified snapshot Drive actually holds.

If another writer changed the document first, the platform reloads it and
replays Troy War Simulator's net changes once. The result reports what happened:

- `written`: the original write succeeded.
- `written-after-rebase`: the remote document moved, the changes still applied cleanly, and the rebased document was written.
- `already-applied`: the latest remote document already contains every intended change.

A conflicting army edit raises `ReplayConflict`. A second concurrent move stops
with `ConcurrentWriterDetected`. An upload whose outcome cannot be confirmed
raises `WriteUnconfirmed` and is not retried blindly. In each case the local
session retains its pending changes, and each is exported so the app can branch
on it by type:

```ts
try {
  await saveSession(holder, snapshot, saveParts);
} catch (error) {
  if (error instanceof ReplayConflict) showConflict(error);
  else if (error instanceof ConcurrentWriterDetected) askToRetryLater();
  else if (error instanceof WriteUnconfirmed) enterRecovery();
  else if (error instanceof SavedButNotAdopted) useSavedBase(error.saved.snapshot);
  else throw error;
}
```

#### Editing while a save runs

Choose what happens to edits made during the upload.

**Carry over** (default). Editing continues. After the write is verified, edits
made during the save are replayed onto the saved document and stay pending for
the next save:

```ts
const result = await saveSession(holder, snapshot, saveParts);
result.carried; // edits made during the save, still pending
```

**Block.** Editing pauses. Every `holder.commit` throws `SessionLocked` until
the save settles, whether it succeeds or fails:

```ts
await saveSession(holder, snapshot, saveParts, { duringSave: "block" });

// In the edit path, or disable the controls with holder.isLocked():
try {
  holder.commit(base, draft);
} catch (error) {
  if (error instanceof SessionLocked) showNotice("Saving… try again in a moment");
  else throw error;
}
```

If carrying over fails after the write succeeded, `saveSession` throws
`SavedButNotAdopted`. Its `reason` is `conflict` (a rebase brought in another
writer's change to the same record), `rewritten` (earlier changes were altered
mid-save, for example by undo) or `invalid`. `error.saved` is the verified
result, which becomes the app's new base; the holder keeps every change. A
second `saveSession` on the same holder while one is running throws
`SaveInProgress`.

### 7. Use the React hooks

The hooks wrap the cache and Drive state transitions while leaving snapshot
ownership with the application:

```tsx
function TroyWarApp() {
  const online = useOnlineStatus();
  const cached = useValidatedDocumentCache(cache, cacheChannel);
  const drive = useGoogleDriveSync(
    source,
    cached.save,
    true,
    liveSnapshot,
  );

  return (
    <>
      <button disabled={!online} onClick={drive.connect}>
        {drive.state.status === "connecting" ? "Connecting…" : "Open campaign"}
      </button>
      {cached.state.status === "ready" && <p>Validated copy available</p>}
    </>
  );
}
```

In a real component, `drive.state.snapshot` becomes the live snapshot after a
successful connection. The cached snapshot is only used through the session
visibility rule described above.

### 8. Download the exact document

Downloading uses `snapshot.documentText`, so the user receives the exact bytes
that were read from the store rather than a fresh serialization:

```ts
const downloader = new DocumentDownloader<WarDocument>("troy-war.json");
downloader.download(snapshot);
```

## The application/platform boundary

| Troy War Simulator owns | This package owns |
| --- | --- |
| `WarDocument`, `Army`, and `Battle` types | Validated snapshot and source contracts |
| JSON schema and domain validation | Calling the injected parser at every admission boundary |
| Stable record IDs and record equality | Replay decisions and conflict reporting |
| How a battle changes army strength | Atomic session installation |
| Change constructors and human descriptions | Squashing and save-plan integrity checks |
| Screens and simulation rules | Drive access, cache, guarded writes, and generic review UI |

The platform never imports an application or interprets its records. Domain
knowledge enters through `parse` functions and small replay, squash, and
description adapters.

Before adopting the package, an application must decide its own policy for
unknown fields, stable identity, array ordering, record equality, and
serialization. These choices affect conflict handling and byte-for-byte save
verification, so they should be explicit before the first write.

## Public API

The core entry point exports:

- Document handling: `canonicalJson`, `CanonicalJsonError`, `visibleSnapshot`,
  `BundledDocumentSource`, `DocumentDownloader`, and document/snapshot types.
- Validation: `JsonSchemaValidator`, `JsonDocumentValidationError`.
- Record identity: `RECORD_ID_ALPHABET`, `RECORD_ID_LENGTH`, `isRecordId`,
  `recordIdOf`, `mintRecordId`, and the `TakenIds` type.
- Cache: `ValidatedDocumentCache`, `DocumentCacheChannel`.
- Google Drive: `GoogleDriveConfiguration`, `GoogleAccessTokenProvider`,
  `GoogleBrowserLibraries`, `GoogleDriveFilePicker`,
  `GoogleDriveDocumentSource`, and `GoogleDriveDocumentWriter`.
- Editing: `SessionHolder`, `DocumentReplay`, `squashChanges`, `prepareSave`,
  `saveDocument`, `saveSession`, and their adapter, option and result types.
- Editing failures: `SessionCommitConflict`, `SessionLocked`, `ReplayConflict`,
  `UnsquashableHistory`, `NothingToSave`, `UnrecordedMutation`,
  `ConcurrentWriterDetected`, `SaveInProgress`, `SavedButNotAdopted`,
  `DocumentMovedBeforeWrite`, `WriteNotPermitted`, `WriteUnconfirmed`.

The React entry point exports `useOnlineStatus`, `useValidatedDocumentCache`,
`useGoogleDriveSync`, `ChangeSummaryList`, `EditingStatusBar`,
`SaveReviewPanel`, `Modal`, and `BuildStamp`.

Read [`src/index.ts`](src/index.ts) and [`src/react.ts`](src/react.ts) for the
exact current export surface and signatures.

## Installation

The package is consumed from a pinned Git tag rather than the npm registry:

```json
{
  "dependencies": {
    "@rishib1234/document-platform": "github:RishiB1234/document-platform#v0.1.5"
  }
}
```

Node 22.12 or later and npm 11 or later are required. React and Ajv are optional
peer dependencies; install them only when the chosen entry point or validation
strategy needs them.

## Repository development

```sh
npm run typecheck
npm run build
npm test
npm run coverage
```

`npm run build` also runs during installation through the `prepare` script so a
pinned Git consumer receives `dist`. The default test environment is Node;
individual component tests opt into jsdom.

## Design constraints

- A validated snapshot or installed session is never mutated in place.
- Empty, cancelled-out, invalid, or unrecorded edits never reach the store.
- Saves compare deterministic document bytes, not only object shape.
- Google Drive v3 does not provide a true conditional write for this flow. The
  metadata and content checks reduce risk but leave a check/upload window, so an
  application must treat each document as single-writer.
- A cached private document is only a fallback inside an already authorized
  browser session.
- Every adopting app must test its own production headers, third-party origins,
  artifact privacy, and real browser sign-in/write path.

## Project status

All platform layers are extracted and released. The package currently has
document, validation, connectivity, cache, Google Drive, editing, save, and
React UI surfaces. New capabilities are added only after a real consuming
application proves the requirement.

### TODO

- Move book-catalog onto `saveSession`: it installs the saved snapshot as a
  fresh session today, losing edits made mid-save (Codex review of its PR #2,
  finding #1). Then check fitness-board for the same gap.

## License

MIT — see [`LICENSE`](LICENSE).
