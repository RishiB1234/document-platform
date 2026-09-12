import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentDownloader } from "../src/document/DocumentDownloader.js";
import type { ValidatedDocumentSnapshot } from "../src/document/ValidatedDocumentSnapshot.js";

type Anchor = {
  click: ReturnType<typeof vi.fn>;
  download: string;
  href: string;
  remove: ReturnType<typeof vi.fn>;
  style: { display: string };
};

function browser() {
  const anchor: Anchor = {
    click: vi.fn(),
    download: "",
    href: "",
    remove: vi.fn(),
    style: { display: "" },
  };
  const append = vi.fn();
  const createObjectURL = vi.fn().mockReturnValue("blob:the-document");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("document", {
    body: { append },
    createElement: vi.fn().mockReturnValue(anchor),
  });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  return { anchor, append, createObjectURL, revokeObjectURL };
}

const snapshot = (overrides: Partial<ValidatedDocumentSnapshot<unknown>> = {}) => ({
  documentText: "{\n  \"schema_version\": 1\n}\n",
  fileName: "document.json",
  ...overrides,
}) as ValidatedDocumentSnapshot<unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DocumentDownloader", () => {
  /*
   * The stored bytes, not a re-serialization of the parsed document. A
   * downloaded file that differs from what the store holds -- by a key order, a
   * dropped unknown field, a newline -- is the one outcome this feature must
   * not produce, and it is the outcome nobody would notice.
   */
  it("downloads the exact stored text", async () => {
    const { createObjectURL } = browser();
    const document = snapshot();

    new DocumentDownloader("fallback.json").download(document);

    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(await blob.text()).toBe(document.documentText);
  });

  it("names the file as the store does", () => {
    const { anchor } = browser();

    new DocumentDownloader("fallback.json").download(snapshot({ fileName: "stored.json" }));

    expect(anchor.download).toBe("stored.json");
  });

  it("falls back to the given name when the store has none", () => {
    const { anchor } = browser();

    new DocumentDownloader("fallback.json").download(snapshot({ fileName: "" }));

    expect(anchor.download).toBe("fallback.json");
  });

  it("cleans up the anchor and the blob url", () => {
    const { anchor, append, revokeObjectURL } = browser();

    new DocumentDownloader("fallback.json").download(snapshot());

    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    // A blob url left alive holds the whole document in memory, and the click
    // has already started the download by this point.
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:the-document");
  });
});
