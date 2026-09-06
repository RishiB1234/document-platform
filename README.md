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

### Install from the lockfile — `npm install` from scratch will fail

Use `npm ci`. A fresh resolution of this dependency set crashes npm itself:

```
npm error Cannot read properties of null (reading 'edgesOut')
```

It is an npm bug, not a configuration error, and it is reproducible with a
`package.json` containing nothing but `"vitest": "4.1.10"`. vitest 4.1.10
declares six optional peers pinned to exactly `4.1.10`; one of them,
`@vitest/browser-playwright`, published a `5.0.0` on 2026-09-03, and npm's
resolver walks into a node it has not materialised and dereferences null.

**The lockfile is what makes this repository installable.** It was seeded by
copying fitness-board's `package-lock.json`, whose resolutions predate that
publication, then letting npm reconcile it against this package's smaller
dependency set. The resolutions carry over, the resolver is never asked to
solve the peer graph again, and `npm ci` reproduces the tree exactly.

The general point, worth more than this instance: **an exact version in
`package.json` does not pin a build — the lockfile does.** `"vitest": "4.1.10"`
is as exact as a specifier gets and still cannot be installed today. Both
repositories depend on their lockfiles surviving; delete one and run
`npm install` and it will fail the same way.
