
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { ValidatedDocumentCache } from "../src/cache/ValidatedDocumentCache";
import type { ValidatedDocumentSnapshot } from "../src/document/ValidatedDocumentSnapshot";

type TestData = { value: number };
const parse = (text: string): TestData => {
  const value = JSON.parse(text) as Partial<TestData>;
  if (typeof value.value !== "number") throw new Error("invalid test data");
  return value as TestData;
};

function snapshot(fileId: string, text = '{"value":7}'): ValidatedDocumentSnapshot<TestData> {
  return { canEdit: true, data: parse(text), documentText: text, fileId, fileName: "test.json", mimeType: "application/json", modifiedTime: null, revisionId: "revision-1", size: text.length, version: "1" };
}

describe("ValidatedDocumentCache", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("drive-json-app-cache");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  it("revalidates cached text and never restores cached edit authority", async () => {
    const cache = new ValidatedDocumentCache("test-app", "file-a", 1, parse);
    await cache.save(snapshot("file-a"), "2026-08-31T00:00:00.000Z");
    const cached = await cache.load();
    expect(cached?.snapshot.data).toEqual({ value: 7 });
    expect(cached?.snapshot.canEdit).toBe(false);
  });

  it("partitions records by application and file", async () => {
    const first = new ValidatedDocumentCache("app-a", "file-a", 1, parse);
    const second = new ValidatedDocumentCache("app-a", "file-b", 1, parse);
    await first.save(snapshot("file-a"), "2026-08-31T00:00:00.000Z");
    expect(await second.load()).toBeNull();
    expect((await first.load())?.snapshot.fileId).toBe("file-a");
  });

  it("refuses to store a snapshot for a different file", async () => {
    const cache = new ValidatedDocumentCache("test-app", "file-a", 1, parse);
    await expect(cache.save(snapshot("file-b"), "2026-08-31T00:00:00.000Z")).rejects.toThrow(/different Drive file/);
  });
});

/*
 * The guards below were all untested when this cache was extracted: mutating
 * each one left the suite green. They are the reason this implementation was
 * chosen over the reference application's, so they are the last things that
 * should be resting on inspection.
 */
describe("ValidatedDocumentCache guards", () => {
  const verifiedAt = "2026-09-06T00:00:00.000Z";

  function writeRecord(record: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("drive-json-app-cache", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("validated-documents")) {
          open.result.createObjectStore("validated-documents", { keyPath: "cacheKey" });
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction("validated-documents", "readwrite");
        transaction.objectStore("validated-documents").put(record);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
    });
  }

  /*
   * The cache key is `applicationId:fileId` and carries no schema version, so a
   * record written by an older release is found by key and only this check
   * rejects it. Without it, a schema change would serve data shaped for the
   * previous one -- which is precisely what bumping schemaVersion is for.
   */
  it("withholds a record written under a different schema version", async () => {
    await new ValidatedDocumentCache("app-a", "file-a", 1, parse).save(snapshot("file-a"), verifiedAt);
    const afterBump = new ValidatedDocumentCache("app-a", "file-a", 2, parse);
    expect(await afterBump.load()).toBeNull();
  });

  it("still serves the record to a cache on the matching version", async () => {
    await new ValidatedDocumentCache("app-a", "file-a", 2, parse).save(snapshot("file-a"), verifiedAt);
    expect((await new ValidatedDocumentCache("app-a", "file-a", 2, parse).load())?.snapshot.data).toEqual({ value: 7 });
  });

  /*
   * Defence in depth: the key already separates applications and files, so a
   * mismatch here means the stored record disagrees with the key it is filed
   * under. Reachable only through a collision or a hand-edited database, which
   * is exactly when a silent wrong answer would be worst.
   */
  it("withholds a record whose contents disagree with the key it is filed under", async () => {
    await writeRecord({
      cacheKey: "app-a:file-a", applicationId: "a-different-app", schemaVersion: 1,
      documentText: '{"value":7}', fileId: "file-a", fileName: "test.json",
      mimeType: "application/json", modifiedTime: null, revisionId: "r1", size: 11,
      verifiedAt, version: "1",
    });
    expect(await new ValidatedDocumentCache("app-a", "file-a", 1, parse).load()).toBeNull();
  });

  it("withholds a record naming a different file than the one requested", async () => {
    await writeRecord({
      cacheKey: "app-a:file-a", applicationId: "app-a", schemaVersion: 1,
      documentText: '{"value":7}', fileId: "a-different-file", fileName: "test.json",
      mimeType: "application/json", modifiedTime: null, revisionId: "r1", size: 11,
      verifiedAt, version: "1",
    });
    expect(await new ValidatedDocumentCache("app-a", "file-a", 1, parse).load()).toBeNull();
  });

  /*
   * A cached document that no longer parses is not merely unusable, it is a
   * trap: every later load would pay to re-read and re-fail it. Loading it
   * deletes it, so the next start is a clean miss rather than a repeat failure.
   */
  it("deletes a cached document that no longer parses, rather than failing on it forever", async () => {
    await new ValidatedDocumentCache("app-a", "file-a", 1, parse).save(snapshot("file-a"), verifiedAt);

    const strict = (text: string): TestData => {
      const value = JSON.parse(text) as Partial<TestData>;
      if (value.value !== 42) throw new Error("no longer acceptable");
      return value as TestData;
    };
    expect(await new ValidatedDocumentCache("app-a", "file-a", 1, strict).load()).toBeNull();

    // The record is gone, not merely rejected: the original parser cannot find
    // it either.
    expect(await new ValidatedDocumentCache("app-a", "file-a", 1, parse).load()).toBeNull();
  });
});
