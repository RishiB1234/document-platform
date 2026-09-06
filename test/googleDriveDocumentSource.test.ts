import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDriveDocumentSource } from "../src/google/GoogleDriveDocumentSource";
import type { GoogleDriveConfiguration } from "../src/google/GoogleDriveConfiguration";
import type { GoogleDriveFilePicker } from "../src/google/GoogleDriveFilePicker";
import type { GoogleAccessTokenProvider } from "../src/google/GoogleAccessTokenProvider";

const configuration = {
  applicationId: "test-app",
  schemaVersion: 1,
  clientId: "client",
  apiKey: "key",
  projectNumber: "project",
  fileId: "configured-file",
  expectedFileName: "document.json",
  cacheKey: () => "test-app:configured-file",
} as unknown as GoogleDriveConfiguration;

const picker = { selectConfiguredFile: vi.fn(async () => "configured-file") } as unknown as GoogleDriveFilePicker;
const tokenProvider = { request: vi.fn(async () => "token"), clear: vi.fn() } as unknown as GoogleAccessTokenProvider;

describe("GoogleDriveDocumentSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads metadata and admits content through the supplied parser", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "configured-file", name: "document.json", capabilities: { canEdit: true }, headRevisionId: "r1", version: "1", size: "11" }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{"value":7}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const source = new GoogleDriveDocumentSource(configuration, picker, tokenProvider, (text) => JSON.parse(text) as { value: number });
    const result = await source.load(false);
    expect(result?.data).toEqual({ value: 7 });
    expect(result?.canEdit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears the in-memory token after an unauthorized Drive response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const source = new GoogleDriveDocumentSource(configuration, picker, tokenProvider, JSON.parse);
    await expect(source.load(false)).rejects.toThrow(/metadata request failed \(401\)/);
    expect(tokenProvider.clear).toHaveBeenCalled();
  });

  it("refuses a picker result that differs from the configured file", async () => {
    const wrongPicker = { selectConfiguredFile: vi.fn(async () => "other-file") } as unknown as GoogleDriveFilePicker;
    const source = new GoogleDriveDocumentSource(configuration, wrongPicker, tokenProvider, JSON.parse);
    await expect(source.load(true)).rejects.toThrow(/different Drive file/);
  });
});
