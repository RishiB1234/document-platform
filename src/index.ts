/*
 * The package's public surface. Extraction proceeds layer by layer, bottom-up,
 * and this file grows one layer at a time -- a layer is only exported once it
 * compiles and tests standalone in this repository.
 *
 * Layer 1: document.   No dependencies at all, not even on each other.
 * Layer 2: validation, connectivity. Optional peers: ajv (types only), react.
 * Layer 3: cache. Validated last-known-good store plus the cross-tab channel.
 * Layer 4: google, plus editing/writeFailures -- the write failure vocabulary
 *          the Drive writer raises. It has no dependencies of its own and sits
 *          below google despite its path, which is kept so that fitness-board's
 *          migration stays a path rewrite rather than a reorganisation.
 * Layer 5: editing core. The copy-apply-validate-swap boundary, the replay
 *          engine and its conflict decision, squashing, and the guarded save.
 */
export { canonicalJson, CanonicalJsonError } from "./document/canonicalJson.js";
export { visibleSnapshot } from "./document/sessionVisibility.js";
export type { ValidatedDocumentSnapshot, CachedValidatedDocument } from "./document/ValidatedDocumentSnapshot.js";
export type { DriveJsonApplicationConfig } from "./document/DriveJsonApplicationConfig.js";

export { JsonSchemaValidator, JsonDocumentValidationError } from "./validation/JsonSchemaValidator.js";
export { useOnlineStatus } from "./connectivity/useOnlineStatus.js";

export { ValidatedDocumentCache } from "./cache/ValidatedDocumentCache.js";
export { DocumentCacheChannel } from "./cache/DocumentCacheChannel.js";
export { useValidatedDocumentCache } from "./cache/useValidatedDocumentCache.js";

export { GoogleDriveConfiguration } from "./google/GoogleDriveConfiguration.js";
export type { GoogleDriveCredentials } from "./google/GoogleDriveConfiguration.js";
export { GoogleAccessTokenProvider } from "./google/GoogleAccessTokenProvider.js";
export { GoogleBrowserLibraries } from "./google/GoogleBrowserLibraries.js";
export { GoogleDriveFilePicker } from "./google/GoogleDriveFilePicker.js";
export { GoogleDriveDocumentSource } from "./google/GoogleDriveDocumentSource.js";
export { GoogleDriveDocumentWriter } from "./google/GoogleDriveDocumentWriter.js";
export { useGoogleDriveSync } from "./google/useGoogleDriveSync.js";
export { DocumentMovedBeforeWrite, WriteNotPermitted, WriteUnconfirmed } from "./editing/writeFailures.js";

export { SessionHolder, SessionCommitConflict } from "./editing/SessionHolder.js";
export { DocumentReplay } from "./editing/DocumentReplay.js";
export { ReplayConflict } from "./editing/ReplayConflict.js";
export type { ReplayAdapter, ReplayableSnapshot, ChangeIntent } from "./editing/ReplayAdapter.js";
export { squashChanges } from "./editing/squashChanges.js";
export type { SquashAdapter } from "./editing/squashChanges.js";
export { prepareSave } from "./editing/prepareSave.js";
export type { SavePlan } from "./editing/prepareSave.js";
export { saveDocument } from "./editing/saveDocument.js";
export type { ChangeDescription } from "./editing/ChangeDescription.js";
