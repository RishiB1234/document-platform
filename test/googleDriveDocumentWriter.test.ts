import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDriveDocumentWriter } from "../src/google/GoogleDriveDocumentWriter";
import { DocumentMovedBeforeWrite, WriteNotPermitted, WriteUnconfirmed } from "../src/editing/writeFailures";
import type { GoogleAccessTokenProvider } from "../src/google/GoogleAccessTokenProvider";
import type { ValidatedDocumentSnapshot } from "../src/document/ValidatedDocumentSnapshot";

type Doc = { value: number };

const BASE_TEXT = '{"value":1}\n';
const CANDIDATE = '{"value":2}\n';

const tokenProvider = { request: vi.fn(async () => "token"), clear: vi.fn() } as unknown as GoogleAccessTokenProvider;

const base: ValidatedDocumentSnapshot<Doc> = {
  canEdit: true,
  data: { value: 1 },
  documentText: BASE_TEXT,
  fileId: "configured-file",
  fileName: "document.json",
  mimeType: "application/json",
  modifiedTime: "2026-09-01T00:00:00Z",
  revisionId: "r1",
  size: 12,
  version: "1",
};

const metadata = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ id: "configured-file", name: "document.json", capabilities: { canEdit: true }, headRevisionId: "r1", version: "1", size: "12", mimeType: "application/json", modifiedTime: "2026-09-01T00:00:00Z", ...over }), { status: 200 });
const body = (text: string) => new Response(text, { status: 200 });
const ok = () => new Response("", { status: 200 });

/** The five requests a clean write makes, in order. */
const happyPath = () =>
  vi.fn()
    .mockResolvedValueOnce(metadata())                                  // step 8
    .mockResolvedValueOnce(body(BASE_TEXT))                             // step 11
    .mockResolvedValueOnce(ok())                                        // step 12
    .mockResolvedValueOnce(metadata({ headRevisionId: "r2", version: "2" })) // step 13
    .mockResolvedValueOnce(body(CANDIDATE));                            // step 13

const writer = () => new GoogleDriveDocumentWriter<Doc>("configured-file", tokenProvider, (text) => JSON.parse(text) as Doc);
const uploads = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");

describe("GoogleDriveDocumentWriter", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("returns what Drive holds afterwards, not the local candidate", async () => {
    const fetchMock = happyPath();
    vi.stubGlobal("fetch", fetchMock);
    const result = await writer().write(CANDIDATE, base);
    expect(result.documentText).toBe(CANDIDATE);
    expect(result.data).toEqual({ value: 2 });
    expect(result.revisionId).toBe("r2");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("uploads the complete candidate as one PATCH to the upload endpoint", async () => {
    const fetchMock = happyPath();
    vi.stubGlobal("fetch", fetchMock);
    await writer().write(CANDIDATE, base);
    const [[url, init]] = uploads(fetchMock);
    expect(String(url)).toContain("/upload/drive/v3/files/configured-file");
    expect(String(url)).toContain("uploadType=media");
    expect((init as RequestInit).body).toBe(CANDIDATE);
  });

  describe("refuses before uploading anything", () => {
    it("when the base snapshot names a different file", async () => {
      const fetchMock = happyPath();
      vi.stubGlobal("fetch", fetchMock);
      await expect(writer().write(CANDIDATE, { ...base, fileId: "somewhere-else" })).rejects.toThrow(WriteNotPermitted);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("when Drive returns metadata for the wrong file", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(metadata({ id: "another-file" }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(writer().write(CANDIDATE, base)).rejects.toThrow(/metadata for the wrong file/);
      expect(uploads(fetchMock)).toHaveLength(0);
    });

    it("when live permission says the file is not editable", async () => {
      // A cached canEdit is not authorization. This is the live check.
      const fetchMock = vi.fn().mockResolvedValueOnce(metadata({ capabilities: { canEdit: false } }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(writer().write(CANDIDATE, base)).rejects.toThrow(WriteNotPermitted);
      expect(uploads(fetchMock)).toHaveLength(0);
    });

    it("when the revision moved", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(metadata({ headRevisionId: "r9", version: "9" }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(writer().write(CANDIDATE, base)).rejects.toThrow(DocumentMovedBeforeWrite);
      expect(uploads(fetchMock)).toHaveLength(0);
    });

    it("when the content differs although the revision matches", async () => {
      // Not redundant with the revision check: a revision id can be unchanged
      // while the bytes are not the ones this edit was built on.
      const fetchMock = vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(body('{"value":99}\n'));
      vi.stubGlobal("fetch", fetchMock);
      await expect(writer().write(CANDIDATE, base)).rejects.toThrow(/contents are no longer/);
      expect(uploads(fetchMock)).toHaveLength(0);
    });

    it("when neither side carries a revision identifier to compare", async () => {
      // Cannot tell must read as moved. A guard that passes when it has nothing
      // to compare is worse than no guard, because it looks like protection.
      const fetchMock = vi.fn().mockResolvedValueOnce(metadata({ headRevisionId: undefined, version: undefined }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(writer().write(CANDIDATE, { ...base, revisionId: null, version: null })).rejects.toThrow(DocumentMovedBeforeWrite);
      expect(uploads(fetchMock)).toHaveLength(0);
    });
  });

  describe("reports an unconfirmed write once the upload has been sent", () => {
    it("when Drive cannot be read back", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(body(BASE_TEXT))
        .mockResolvedValueOnce(ok())
        .mockRejectedValueOnce(new Error("network gone"));
      vi.stubGlobal("fetch", fetchMock);
      await expect(writer().write(CANDIDATE, base)).rejects.toThrow(WriteUnconfirmed);
      // The upload was sent. That is exactly why this is not retryable.
      expect(uploads(fetchMock)).toHaveLength(1);
    });

    it("when the revision did not move, meaning the write silently did nothing", async () => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(body(BASE_TEXT))
        .mockResolvedValueOnce(ok())
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(body(CANDIDATE)));
      await expect(writer().write(CANDIDATE, base)).rejects.toThrow(/still reports the revision/);
    });

    it("when the stored bytes are not the ones uploaded", async () => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(body(BASE_TEXT))
        .mockResolvedValueOnce(ok())
        .mockResolvedValueOnce(metadata({ headRevisionId: "r2", version: "2" }))
        .mockResolvedValueOnce(body('{"value":3}\n')));
      await expect(writer().write(CANDIDATE, base)).rejects.toThrow(/different content than was uploaded/);
    });

    it("when what Drive now holds does not pass validation", async () => {
      const strict = new GoogleDriveDocumentWriter<Doc>("configured-file", tokenProvider, () => { throw new Error("schema says no"); });
      vi.stubGlobal("fetch", happyPath());
      await expect(strict.write(CANDIDATE, base)).rejects.toThrow(/does not pass validation/);
    });

    it("keeps the underlying failure rather than replacing it", async () => {
      const cause = new Error("network gone");
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(metadata())
        .mockResolvedValueOnce(body(BASE_TEXT))
        .mockResolvedValueOnce(ok())
        .mockRejectedValueOnce(cause));
      await expect(writer().write(CANDIDATE, base)).rejects.toMatchObject({ cause });
    });
  });

  it("requests a token once, and only when the write actually starts", async () => {
    vi.stubGlobal("fetch", happyPath());
    await writer().write(CANDIDATE, base);
    expect(tokenProvider.request).toHaveBeenCalledTimes(1);
  });

  it("clears the in-memory token after an unauthorized response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(writer().write(CANDIDATE, base)).rejects.toThrow(/\(401\)/);
    expect(tokenProvider.clear).toHaveBeenCalled();
  });

  it("treats a failed upload as retryable rather than unconfirmed", async () => {
    // The request did not land, so the previous snapshot is still usable and
    // the caller may try again -- unlike a failure after the upload.
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(metadata())
      .mockResolvedValueOnce(body(BASE_TEXT))
      .mockResolvedValueOnce(new Response("nope", { status: 500 })));
    const failure = await writer().write(CANDIDATE, base).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(WriteUnconfirmed);
    expect((failure as Error).message).toMatch(/upload request failed \(500\)/);
  });
});

/*
 * Drive populates headRevisionId for binary-ish files and version for others,
 * so either identifier may be absent. Every test above supplies both and
 * therefore only ever exercises the headRevisionId branch -- removing the
 * version fallback entirely left the suite green.
 *
 * That gap is the wrong way round: a JSON document is exactly the kind of file
 * Drive may describe with version alone, so the untested branch is plausibly
 * the one that runs in production.
 */
describe("GoogleDriveDocumentWriter revision comparison without headRevisionId", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const versionOnly = (over: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({
      id: "configured-file", name: "document.json", capabilities: { canEdit: true },
      version: "1", size: "12", mimeType: "application/json",
      modifiedTime: "2026-09-01T00:00:00Z", ...over,
    }), { status: 200 });

  const versionBase: ValidatedDocumentSnapshot<Doc> = { ...base, revisionId: null };

  it("writes when version still matches the one the edit was based on", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(versionOnly())
      .mockResolvedValueOnce(body(BASE_TEXT))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(versionOnly({ version: "2" }))
      .mockResolvedValueOnce(body(CANDIDATE));
    vi.stubGlobal("fetch", fetchMock);

    const written = await writer().write(CANDIDATE, versionBase);
    expect(written.documentText).toBe(CANDIDATE);
    expect(uploads(fetchMock)).toHaveLength(1);
  });

  it("refuses when version moved on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(versionOnly({ version: "9" })));
    await expect(writer().write(CANDIDATE, versionBase)).rejects.toThrow(DocumentMovedBeforeWrite);
  });

  /*
   * And the post-upload half of the same branch: a write that leaves version
   * untouched did nothing, whichever identifier Drive reports.
   */
  it("reports a write that left version unchanged as unconfirmed", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(versionOnly())
      .mockResolvedValueOnce(body(BASE_TEXT))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(versionOnly())
      .mockResolvedValueOnce(body(CANDIDATE)));
    await expect(writer().write(CANDIDATE, versionBase)).rejects.toThrow(WriteUnconfirmed);
  });
});
