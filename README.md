# @rishib1234/document-platform

Domain-neutral platform for document-backed web applications — validated
snapshots, caching, Google Drive access, deterministic serialization, and
guarded editing.

Extracted from `fitness-board`, which proved these contracts through its stages
1–8. Consumed as a pinned git dependency; not published to the npm registry.

## How this was built

Written by RishiB1234 with Claude Opus 5 (Anthropic), pair-programming
throughout. Every commit carries a `Co-Authored-By: Claude Opus 5` trailer, so
the attribution is in the history rather than only in this paragraph.

The method is worth stating because it shaped the result. The package was
extracted from a working application one layer at a time, bottom-up, with the
full suite green before each layer was allowed to land. Every safety property
was verified by breaking it: mutate the code that enforces the guarantee, watch
the intended test fail, restore. That pass repeatedly found guarantees resting
on nothing -- the cache's load guards, the validator's error formatting, a
revision branch that production probably uses -- each of which had looked tested
and was not.

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
| 2. `validation`, `connectivity` | `JsonSchemaValidator` (ajv, type-only), `useOnlineStatus` | **done** — 34 tests |
| 3. `cache` | validated last-known-good cache, cross-tab channel | **done** — 42 tests |
| 4. `google` | token provider, library loader, configuration, picker, source, writer, `writeFailures` | **done** — 74 tests |
| 5. `editing` core | `SessionHolder`, `DocumentReplay`, `ReplayAdapter`, squash, prepare/save | **done** — 165 tests |
| 6. `ui`, review components, `build` | React surface | **done** — 239 tests, 96.7% |

Neither consuming application has migrated yet. fitness-board goes first — it
already has a clean platform boundary, so it is an exact oracle for the move —
then book-catalog, whose infrastructure is interleaved with its domain and is
the real test of neutrality.

## Two entry points

```ts
import { SessionHolder, canonicalJson } from "@rishib1234/document-platform";
import { Modal, useOnlineStatus }        from "@rishib1234/document-platform/react";
```

The split keeps `react` a genuinely optional peer dependency. A single barrel
re-exporting the hooks would make it required in practice, because Node resolves
every re-export eagerly: a consumer without React could not import the package
at all, not even for `canonicalJson`. An optional dependency that the only
entry point demands is not optional.

`ajv` needs no such split. `JsonSchemaValidator` imports it for types only, so
nothing loads it at runtime and an application that supplies its own parser
never installs it.

## Working notes

Node 22 or later. The default shell `node` in this environment is v16 and fails
with errors that look like project bugs; prefix commands with
`export PATH=/usr/local/opt/node@22/bin:$PATH`.

```
npm run typecheck
npm run build      # also runs on install, via prepare, for git consumers
npm test
npm run coverage   # V8 coverage, mapped back through source maps
```

jsdom is opt-in per file, through a `// @vitest-environment jsdom` docblock.
The default environment is Node: IndexedDB comes from `fake-indexeddb` and
`BroadcastChannel` is native, and a simulated DOM everywhere would only add
approximation where none is needed.

### npm 11 or later is required to install this package

Homebrew's `node@22` bundles npm 10.9.8, whose dependency resolver crashes on
this package's devDependencies:

```
npm error Cannot read properties of null (reading 'edgesOut')
```

It is a bug in that npm, fixed upstream — npm 12 resolves the identical
`package.json` cleanly, with no flags and no lockfile. If you hit it, upgrade
npm rather than changing what the package depends on:

```
npm install -g npm@latest
```

Note that `export PATH=/usr/local/opt/node@22/bin:$PATH` puts Homebrew's
bundled npm ahead of the upgraded one on this machine. `npm -v` should report
11 or later; if it reports 10.x, the upgrade is being shadowed and
`/usr/local/bin/npm` is the one you want.

## License

MIT — see [LICENSE](LICENSE).
