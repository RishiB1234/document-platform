# @rishib1234/document-platform

Domain-neutral platform for document-backed web applications — validated
snapshots, caching, Google Drive access, deterministic serialization, and
guarded editing.

Extracted from `fitness-board`, which proved these contracts through its stages
1–8. Consumed as a pinned git dependency; not published to the npm registry.

## The rule this package exists to keep

**No reverse dependency.** Nothing here imports an application, names a domain,
or reads a bundler global. The domain enters through injection — a parser as
`parse: (text) => T`, and adapters for replay, squashing and change description.
That inversion is what makes the package usable by more than one application,
and it is enforced by the package boundary rather than by review.

Scope is a **union**, not an intersection: everything any adopting application
has proven it needs, admitted where it is strictly usable by all of them, and
offered as options rather than mandates. An application brings its own parser
and chooses which capabilities to use.

## Status — extraction in progress

Moving layer by layer, bottom-up, so each layer compiles and tests standalone
before the next arrives.

| Layer | Contents | State |
| --- | --- | --- |
| 1. `document` | `canonicalJson`, `sessionVisibility`, snapshot and config types | **done** — 26 tests |
| 2. `validation`, `connectivity` | `JsonSchemaValidator` (ajv, type-only), `useOnlineStatus` | pending |
| 3. `cache` | validated last-known-good cache, cross-tab channel | pending |
| 4. `google` | token provider, library loader, configuration, picker, source, writer | pending |
| 5. `editing` core | `SessionHolder`, `DocumentReplay`, `ReplayAdapter`, squash, prepare/save, write failures | pending |
| 6. `ui`, review components, `build` | React surface | pending |

Neither consuming application has migrated yet. fitness-board goes first — it
already has a clean platform boundary, so it is an exact oracle for the move —
then book-catalog, whose infrastructure is interleaved with its domain and is
the real test of neutrality.

## Working notes

Node 22 or later. The default shell `node` in this environment is v16 and fails
with errors that look like project bugs; prefix commands with
`export PATH=/usr/local/opt/node@22/bin:$PATH`.

```
npm run typecheck
npm run build      # also runs on install, via prepare, for git consumers
npm test
```

**vitest is pinned to 5.0.0, not fitness-board's 4.1.10.** A fresh resolution of
4.1.10 crashes npm's peer resolver (`Cannot read properties of null (reading
'edgesOut')`) because `@vitest/browser-playwright@5.0.0` now exists in its peer
graph. fitness-board is unaffected only because its lockfile was resolved before
that package was published. The test runner is a devDependency and part of no
contract, so the versions need not match.
