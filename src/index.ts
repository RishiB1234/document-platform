/*
 * The core surface: everything that runs without React.
 *
 * The React half -- hooks and components -- lives behind the "./react" subpath
 * instead. That split is not tidiness. `react` is declared an optional peer
 * dependency, and a single barrel exporting the hooks would make it required in
 * practice: importing the package at all would fail for a consumer that does
 * not have React, because Node resolves every re-export eagerly. An optional
 * dependency the only entry point demands is not optional.
 *
 * `ajv` is genuinely optional and needs no such split: JsonSchemaValidator
 * imports it for types only, so nothing loads it at runtime.
 */

export { canonicalJson, CanonicalJsonError } from "./document/canonicalJson.js";
export { visibleSnapshot } from "./document/sessionVisibility.js";
export type { ValidatedDocumentSnapshot, CachedValidatedDocument } from "./document/ValidatedDocumentSnapshot.js";
export type { DriveJsonApplicationConfig } from "./document/DriveJsonApplicationConfig.js";

export { JsonSchemaValidator, JsonDocumentValidationError } from "./validation/JsonSchemaValidator.js";

export { ValidatedDocumentCache } from "./cache/ValidatedDocumentCache.js";
export { DocumentCacheChannel } from "./cache/DocumentCacheChannel.js";

export { GoogleDriveConfiguration } from "./google/GoogleDriveConfiguration.js";
export type { GoogleDriveCredentials } from "./google/GoogleDriveConfiguration.js";
export { GoogleAccessTokenProvider } from "./google/GoogleAccessTokenProvider.js";
export { GoogleBrowserLibraries } from "./google/GoogleBrowserLibraries.js";
export { GoogleDriveFilePicker } from "./google/GoogleDriveFilePicker.js";
export { GoogleDriveDocumentSource } from "./google/GoogleDriveDocumentSource.js";
export { GoogleDriveDocumentWriter } from "./google/GoogleDriveDocumentWriter.js";
export { DocumentMovedBeforeWrite, WriteNotPermitted, WriteUnconfirmed } from "./editing/writeFailures.js";

export { SessionHolder, SessionCommitConflict } from "./editing/SessionHolder.js";
export { DocumentReplay } from "./editing/DocumentReplay.js";
export { ReplayConflict } from "./editing/ReplayConflict.js";
export type { ReplayAdapter, ReplayableSnapshot, ChangeIntent } from "./editing/ReplayAdapter.js";
export { squashChanges, UnsquashableHistory } from "./editing/squashChanges.js";
export type { SquashAdapter } from "./editing/squashChanges.js";
export { prepareSave, NothingToSave, UnrecordedMutation } from "./editing/prepareSave.js";
export type { SavePlan } from "./editing/prepareSave.js";
export { saveDocument } from "./editing/saveDocument.js";
export type { ChangeDescription } from "./editing/ChangeDescription.js";
