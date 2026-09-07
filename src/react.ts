/*
 * The React surface, behind its own subpath so that `react` can stay an
 * optional peer dependency rather than one the package's only entry point
 * silently requires. Import from "@rishib1234/document-platform/react".
 */

export { useOnlineStatus } from "./connectivity/useOnlineStatus.js";
export { useValidatedDocumentCache } from "./cache/useValidatedDocumentCache.js";
export type { DocumentCacheState } from "./cache/useValidatedDocumentCache.js";
export { useGoogleDriveSync } from "./google/useGoogleDriveSync.js";
export type { GoogleDriveSyncState } from "./google/useGoogleDriveSync.js";

export { ChangeSummaryList } from "./editing/ChangeSummaryList.js";
export { EditingStatusBar } from "./editing/EditingStatusBar.js";
export { SaveReviewPanel, explainRefusal } from "./editing/SaveReviewPanel.js";
export { Modal } from "./ui/Modal.js";
export { BuildStamp } from "./build/BuildStamp.js";
export type { BuildIdentity } from "./build/BuildStamp.js";
