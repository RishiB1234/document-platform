import { afterEach, describe, expect, it, vi } from "vitest";

import { BundledDocumentSource } from "../src/document/BundledDocumentSource.js";

type Doc = { title: string };

const parse = (text: string): Doc => {
  const value = JSON.parse(text) as Doc;
  if (typeof value.title !== "string") throw new Error("not a document");
  return value;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BundledDocumentSource", () => {
  it("returns the parsed document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: "shipped" })),
    ));

    await expect(new BundledDocumentSource("/doc.json", parse).load())
      .resolves.toEqual({ title: "shipped" });
  });

  it("requests exactly the url it was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: "shipped" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new BundledDocumentSource("/nested/doc.json", parse).load();

    expect(fetchMock).toHaveBeenCalledWith("/nested/doc.json");
  });

  /*
   * A bundled document is checked in by hand, which is exactly why it is
   * validated: it is the one source with nobody upstream to have refused it
   * first, and a reader seeing a malformed document render is worse than seeing
   * an error.
   */
  it("refuses a document its validator rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ headline: "wrong shape" })),
    ));

    await expect(new BundledDocumentSource("/doc.json", parse).load())
      .rejects.toThrow("not a document");
  });

  it("reports the status when the document cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("", { status: 404 }),
    ));

    await expect(new BundledDocumentSource("/missing.json", parse).load())
      .rejects.toThrow("(404)");
  });
});
