import type { ValidatedDocumentSnapshot } from "../document/ValidatedDocumentSnapshot.js";
import { DocumentMovedBeforeWrite, WriteNotPermitted, WriteUnconfirmed } from "../editing/writeFailures.js";
import type { GoogleAccessTokenProvider } from "./GoogleAccessTokenProvider.js";

type DriveMetadata = {
  capabilities?: { canEdit?: boolean };
  headRevisionId?: string;
  id?: string;
  mimeType?: string;
  modifiedTime?: string;
  name?: string;
  size?: string;
  version?: string;
};

/**
 * Steps 7-15 of the guarded save transaction: everything that talks to Drive.
 *
 * The ordering is not incidental and none of these checks is redundant with
 * another. Each states what it prevents; a step whose failure mode is not
 * understood is a step someone will delete as duplicated.
 *
 * Note what these checks are not: steps 8-11 read, verify, and *then* upload as
 * a separate request. Drive v3 offers no conditional write, so that gap is a
 * real window. This is a check, not a compare-and-swap, and the application is
 * single-writer per document by construction -- see "Accepted limitation".
 */
export class GoogleDriveDocumentWriter<T> {
  constructor(
    private readonly fileId: string,
    private readonly tokenProvider: GoogleAccessTokenProvider,
    private readonly parse: (text: string) => T,
  ) {}

  /**
   * Writes `candidateText` over the configured file, returning the verified
   * snapshot Drive actually holds afterwards.
   *
   * `base` is the exact snapshot the edit was built on. Everything before the
   * upload compares against it, which is why it must be the edit's base and not
   * merely a recent read.
   */
  async write(candidateText: string, base: ValidatedDocumentSnapshot<T>): Promise<ValidatedDocumentSnapshot<T>> {
    if (base.fileId !== this.fileId) throw new WriteNotPermitted("Refusing to write to a different Drive file");

    // Step 7. Only now: after the candidate is built, validated, and reviewed,
    // so a token is never requested for an edit that turns out to be empty or
    // inadmissible, and it stays short-lived.
    const token = await this.tokenProvider.request();

    // Step 8. Immediately before the write, because the revision check below is
    // only as fresh as this call. Metadata read earlier in the flow is stale.
    const before = await this.fetchMetadata(token);

    // Step 9. Live permission is the authorization boundary; a cached canEdit
    // is not. The id check refuses a document that merely shares a name.
    if (before.id !== this.fileId) throw new WriteNotPermitted("Drive returned metadata for the wrong file");
    if (before.capabilities?.canEdit !== true) throw new WriteNotPermitted("Google Drive reports this file is not editable by this account");

    // Step 10. No last-writer-wins: someone else's edit is not ours to discard
    // without a decision.
    if (!this.sameRevision(before, base)) throw new DocumentMovedBeforeWrite("its revision is no longer the one this edit was based on");

    // Step 11. Not redundant with step 10. A revision identifier can change
    // without the content differing, and content can differ in ways a revision
    // comparison misses. This compares the bytes the edit was actually built on.
    const currentText = await this.fetchContent(token);
    if (currentText !== base.documentText) throw new DocumentMovedBeforeWrite("its contents are no longer the ones this edit was based on");

    // Step 12. The complete document, never a partial or field-level write.
    await this.upload(candidateText, token);

    // Everything from here has already sent the upload. A failure now means
    // Drive may hold the new revision, so these are WriteUnconfirmed rather
    // than ordinary failures, and the caller must not simply retry.
    let after: DriveMetadata;
    let storedText: string;
    try {
      // Step 13. A successful HTTP response is not evidence the document is
      // correct. Ask Drive what it now holds.
      after = await this.fetchMetadata(token);
      storedText = await this.fetchContent(token);
    } catch (error: unknown) {
      throw new WriteUnconfirmed("Drive could not be read back", error);
    }

    // Step 14. Three separate failures: a write that silently did nothing, a
    // write that arrived corrupted, and a document that no longer parses.
    if (this.sameRevision(after, base)) throw new WriteUnconfirmed("Drive still reports the revision this edit was based on");
    if (storedText !== candidateText) throw new WriteUnconfirmed("Drive returned different content than was uploaded");

    let data: T;
    try {
      data = this.parse(storedText);
    } catch (error: unknown) {
      throw new WriteUnconfirmed("the document Drive now holds does not pass validation", error);
    }

    // Step 15. What Drive returned, not the local candidate, so memory and
    // cache reflect the store rather than what was hoped for.
    return {
      canEdit: after.capabilities?.canEdit === true,
      data,
      documentText: storedText,
      fileId: this.fileId,
      fileName: after.name ?? base.fileName,
      mimeType: after.mimeType ?? base.mimeType,
      modifiedTime: after.modifiedTime ?? null,
      revisionId: after.headRevisionId ?? null,
      size: this.parseSize(after.size),
      version: after.version ?? null,
    };
  }

  /**
   * Whether metadata still describes the revision `base` was read at.
   *
   * Drive populates `headRevisionId` for binary-ish files and `version` for
   * others, so either may be absent. When neither identifier is available on
   * both sides the answer is "cannot tell", which must read as *moved*: a
   * revision guard that silently passes when it has nothing to compare is worse
   * than no guard, because it looks like protection.
   */
  private sameRevision(metadata: DriveMetadata, base: ValidatedDocumentSnapshot<T>): boolean {
    if (metadata.headRevisionId && base.revisionId) return metadata.headRevisionId === base.revisionId;
    if (metadata.version && base.version) return metadata.version === base.version;
    return false;
  }

  private async fetchMetadata(token: string): Promise<DriveMetadata> {
    const fields = "capabilities(canEdit),headRevisionId,id,mimeType,modifiedTime,name,size,version";
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(this.fileId)}`);
    url.searchParams.set("fields", fields);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    await this.requireSuccess(response, "metadata");
    return response.json() as Promise<DriveMetadata>;
  }

  private async fetchContent(token: string): Promise<string> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(this.fileId)}`);
    url.searchParams.set("alt", "media");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    await this.requireSuccess(response, "content");
    return response.text();
  }

  private async upload(candidateText: string, token: string): Promise<void> {
    const url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(this.fileId)}`);
    url.searchParams.set("uploadType", "media");
    const response = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: candidateText,
    });
    await this.requireSuccess(response, "upload");
  }

  private async requireSuccess(response: Response, operation: string): Promise<void> {
    if (response.ok) return;
    if (response.status === 401) this.tokenProvider.clear();
    throw new Error(`Google Drive ${operation} request failed (${response.status})`);
  }

  private parseSize(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
}
