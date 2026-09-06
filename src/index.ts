/*
 * The package's public surface. Extraction proceeds layer by layer, bottom-up,
 * and this file grows one layer at a time -- a layer is only exported once it
 * compiles and tests standalone in this repository.
 *
 * Layer 1: document.   No dependencies at all, not even on each other.
 * Layer 2: validation, connectivity. Optional peers: ajv (types only), react.
 */
export { canonicalJson, CanonicalJsonError } from "./document/canonicalJson.js";
export { visibleSnapshot } from "./document/sessionVisibility.js";
export type { ValidatedDocumentSnapshot, CachedValidatedDocument } from "./document/ValidatedDocumentSnapshot.js";
export type { DriveJsonApplicationConfig } from "./document/DriveJsonApplicationConfig.js";

export { JsonSchemaValidator, JsonDocumentValidationError } from "./validation/JsonSchemaValidator.js";
export { useOnlineStatus } from "./connectivity/useOnlineStatus.js";
