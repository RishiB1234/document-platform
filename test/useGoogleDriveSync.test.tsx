// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGoogleDriveSync } from "../src/google/useGoogleDriveSync.js";
import type { GoogleDriveDocumentSource } from "../src/google/GoogleDriveDocumentSource.js";
import type { ValidatedDocumentSnapshot } from "../src/document/ValidatedDocumentSnapshot.js";

/*
 * This hook holds four refs, and each one exists for a failure that only
 * happens in a browser: a second connect while the first is in flight, a load
 * that returns after the component is gone, and the requirement that a failed
 * or cancelled sync still reports the last snapshot it *did* have rather than
 * blanking the screen.
 *
 * None of that is reachable from a string render, which is why the whole file
 * sat at zero coverage.
 */

type Doc = { value: number };

const snapshot = (value: number): ValidatedDocumentSnapshot<Doc> => ({
  canEdit: true, data: { value }, documentText: `{"value":${value}}`, fileId: "file-a",
  fileName: "document.json", mimeType: "application/json", modifiedTime: null,
  revisionId: `r${value}`, size: 11, version: `${value}`,
});

function fakeSource(load: GoogleDriveDocumentSource<Doc>["load"]) {
  return { load: vi.fn(load) } as unknown as GoogleDriveDocumentSource<Doc> & { load: ReturnType<typeof vi.fn> };
}

const sync = (source: GoogleDriveDocumentSource<Doc>, onVerified = vi.fn(async () => {}), selectFile = false) =>
  renderHook(() => useGoogleDriveSync(source, onVerified, selectFile, null));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("useGoogleDriveSync", () => {
  it("starts idle and does nothing until asked", () => {
    const source = fakeSource(async () => snapshot(1));
    const { result } = sync(source);
    expect(result.current.state).toEqual({ status: "idle", completedAt: null, snapshot: null });
    expect(source.load).not.toHaveBeenCalled();
  });

  it("reports a verified document, and hands it on before showing it", async () => {
    const order: string[] = [];
    const onVerified = vi.fn(async () => { order.push("persisted"); });
    const source = fakeSource(async () => snapshot(1));
    const { result } = sync(source, onVerified);

    await act(async () => { await result.current.connect(); });
    order.push("state set");

    expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ fileId: "file-a" }), expect.any(String));
    // Persisted first: a snapshot shown but not cached would vanish on reload.
    expect(order).toEqual(["persisted", "state set"]);
    expect(result.current.state).toMatchObject({ status: "ready", snapshot: { data: { value: 1 } } });
  });

  it("passes the file-selection request through to the source", async () => {
    const source = fakeSource(async () => snapshot(1));
    const { result } = sync(source, vi.fn(async () => {}), true);
    await act(async () => { await result.current.connect(); });
    expect(source.load).toHaveBeenCalledWith(true, null);
  });

  /*
   * The connecting guard. Two clicks on Sync, or a click while a sync is
   * already running, must not start a second load -- that would race two
   * snapshots into the same state.
   */
  it("ignores a second connect while one is in flight", async () => {
    let release: (value: ValidatedDocumentSnapshot<Doc>) => void = () => {};
    const source = fakeSource(() => new Promise((resolve) => { release = resolve; }));
    const { result } = sync(source);

    let first: Promise<void>;
    act(() => { first = result.current.connect(); });
    await waitFor(() => expect(result.current.state.status).toBe("connecting"));

    await act(async () => { await result.current.connect(); });
    expect(source.load).toHaveBeenCalledOnce();

    await act(async () => { release(snapshot(1)); await first; });
    expect(result.current.state.status).toBe("ready");
  });

  it("accepts a new connect once the previous one finished", async () => {
    const source = fakeSource(async () => snapshot(1));
    const { result } = sync(source);
    await act(async () => { await result.current.connect(); });
    await act(async () => { await result.current.connect(); });
    expect(source.load).toHaveBeenCalledTimes(2);
  });

  /*
   * Everything below is the same rule: a sync that does not succeed must not
   * erase what the user already has on screen. The refs exist for this.
   */
  describe("keeping what was already loaded", () => {
    it("remembers the last snapshot while reconnecting", async () => {
      let release: (value: ValidatedDocumentSnapshot<Doc>) => void = () => {};
      const source = fakeSource(async () => snapshot(1));
      const { result } = sync(source);
      await act(async () => { await result.current.connect(); });
      const completedAt = (result.current.state as { completedAt: string }).completedAt;

      source.load.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      let second: Promise<void>;
      act(() => { second = result.current.connect(); });

      expect(result.current.state).toMatchObject({
        status: "connecting", completedAt, snapshot: { data: { value: 1 } },
      });
      await act(async () => { release(snapshot(2)); await second; });
    });

    it("keeps the previous snapshot when a sync is cancelled", async () => {
      const source = fakeSource(async () => snapshot(1));
      const { result } = sync(source);
      await act(async () => { await result.current.connect(); });

      source.load.mockResolvedValueOnce(null);
      await act(async () => { await result.current.connect(); });

      expect(result.current.state).toMatchObject({ status: "cancelled", snapshot: { data: { value: 1 } } });
    });

    it("keeps the previous snapshot when a sync fails, and says why", async () => {
      const source = fakeSource(async () => snapshot(1));
      const { result } = sync(source);
      await act(async () => { await result.current.connect(); });

      source.load.mockRejectedValueOnce(new Error("Drive is unreachable"));
      await act(async () => { await result.current.connect(); });

      expect(result.current.state).toMatchObject({
        status: "error", message: "Drive is unreachable", snapshot: { data: { value: 1 } },
      });
    });

    it("describes a non-Error rejection rather than rendering nothing useful", async () => {
      const source = fakeSource(async () => { throw "a bare string"; });
      const { result } = sync(source);
      await act(async () => { await result.current.connect(); });
      expect(result.current.state).toMatchObject({ status: "error", message: "Unknown synchronization error" });
    });
  });

  it("recovers: a failure does not prevent the next attempt", async () => {
    const source = fakeSource(async () => { throw new Error("offline"); });
    const { result } = sync(source);
    await act(async () => { await result.current.connect(); });
    expect(result.current.state.status).toBe("error");

    source.load.mockResolvedValueOnce(snapshot(3));
    await act(async () => { await result.current.connect(); });
    expect(result.current.state).toMatchObject({ status: "ready", snapshot: { data: { value: 3 } } });
  });

  /*
   * `acceptVerified` is how the save flow installs a post-upload snapshot
   * without going through Drive again.
   */
  it("adopts a snapshot handed to it directly, persisting it too", async () => {
    const onVerified = vi.fn(async () => {});
    const { result } = sync(fakeSource(async () => null), onVerified);

    await act(async () => { await result.current.acceptVerified(snapshot(5), "2026-09-06T00:00:00.000Z"); });

    expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ data: { value: 5 } }), "2026-09-06T00:00:00.000Z");
    expect(result.current.state).toEqual({
      status: "ready", completedAt: "2026-09-06T00:00:00.000Z", snapshot: expect.objectContaining({ data: { value: 5 } }),
    });
  });

  describe("after unmount", () => {
    it("does not set state from a load that finishes late", async () => {
      let release: (value: ValidatedDocumentSnapshot<Doc>) => void = () => {};
      const source = fakeSource(() => new Promise((resolve) => { release = resolve; }));
      const { result, unmount } = sync(source);

      let pending: Promise<void>;
      act(() => { pending = result.current.connect(); });
      unmount();

      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => { release(snapshot(1)); await pending; });
      expect(errors).not.toHaveBeenCalled();
    });

    it("does not set state from a failure that arrives late", async () => {
      let fail: (error: Error) => void = () => {};
      const source = fakeSource(() => new Promise((_resolve, reject) => { fail = reject; }));
      const { result, unmount } = sync(source);

      let pending: Promise<void>;
      act(() => { pending = result.current.connect(); });
      unmount();

      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => { fail(new Error("too late")); await pending; });
      expect(errors).not.toHaveBeenCalled();
    });
  });
});
