// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useValidatedDocumentCache } from "../src/cache/useValidatedDocumentCache.js";
import type { DocumentCacheChannel } from "../src/cache/DocumentCacheChannel.js";
import type { ValidatedDocumentCache } from "../src/cache/ValidatedDocumentCache.js";
import type { ValidatedDocumentSnapshot } from "../src/document/ValidatedDocumentSnapshot.js";

/*
 * The hook is the seam between the cache and the cross-tab channel, and every
 * interesting thing it does happens after render: reading on mount, re-reading
 * when another tab announces a change, announcing after its own writes, and
 * refusing to touch state once unmounted.
 */

type Doc = { value: number };

const snapshot = (value: number): ValidatedDocumentSnapshot<Doc> => ({
  canEdit: true, data: { value }, documentText: `{"value":${value}}`, fileId: "file-a",
  fileName: "document.json", mimeType: "application/json", modifiedTime: null,
  revisionId: "r1", size: 11, version: "1",
});

function fakeStore(load: () => Promise<{ snapshot: ValidatedDocumentSnapshot<Doc>; verifiedAt: string } | null>) {
  return {
    load: vi.fn(load),
    save: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  } as unknown as ValidatedDocumentCache<Doc> & { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
}

function fakeChannel() {
  let listener: (() => void) | null = null;
  const stop = vi.fn(() => { listener = null; });
  return {
    announceChange: vi.fn(),
    onChange: vi.fn((fn: () => void) => { listener = fn; return stop; }),
    close: vi.fn(),
    /** Stand in for another tab announcing a change. */
    fire: () => listener?.(),
    stop,
  } as unknown as DocumentCacheChannel & { announceChange: ReturnType<typeof vi.fn>; onChange: ReturnType<typeof vi.fn>; fire: () => void; stop: ReturnType<typeof vi.fn> };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("useValidatedDocumentCache", () => {
  it("starts loading, then reports what the cache held", async () => {
    const store = fakeStore(async () => ({ snapshot: snapshot(7), verifiedAt: "2026-09-06T00:00:00.000Z" }));
    const { result } = renderHook(() => useValidatedDocumentCache(store, fakeChannel()));

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toMatchObject({ status: "ready", cached: { verifiedAt: "2026-09-06T00:00:00.000Z" } });
  });

  it("reports an empty cache as empty rather than as a failure", async () => {
    const { result } = renderHook(() => useValidatedDocumentCache(fakeStore(async () => null), fakeChannel()));
    await waitFor(() => expect(result.current.state.status).toBe("empty"));
  });

  it("surfaces the reason a read failed", async () => {
    const store = fakeStore(async () => { throw new Error("database is closing"); });
    const { result } = renderHook(() => useValidatedDocumentCache(store, fakeChannel()));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "database is closing" }));
  });

  it("describes a non-Error rejection rather than rendering nothing useful", async () => {
    const store = fakeStore(async () => { throw "just a string"; });
    const { result } = renderHook(() => useValidatedDocumentCache(store, fakeChannel()));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "Unknown document cache error" }));
  });

  /*
   * The whole reason the channel exists: another tab wrote the shared record,
   * and this one is still showing what it read on mount.
   */
  it("re-reads when another tab announces a change", async () => {
    let value = 1;
    const store = fakeStore(async () => ({ snapshot: snapshot(value), verifiedAt: "t" }));
    const channel = fakeChannel();
    const { result } = renderHook(() => useValidatedDocumentCache(store, channel));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    value = 2;
    act(() => { channel.fire(); });
    await waitFor(() => {
      expect(result.current.state).toMatchObject({ cached: { snapshot: { data: { value: 2 } } } });
    });
    expect(store.load).toHaveBeenCalledTimes(2);
  });

  describe("writing through the hook", () => {
    it("saves, adopts the snapshot immediately, and tells the other tabs", async () => {
      const store = fakeStore(async () => null);
      const channel = fakeChannel();
      const { result } = renderHook(() => useValidatedDocumentCache(store, channel));
      await waitFor(() => expect(result.current.state.status).toBe("empty"));

      await act(async () => { await result.current.save(snapshot(9), "2026-09-06T01:00:00.000Z"); });

      expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ fileId: "file-a" }), "2026-09-06T01:00:00.000Z");
      expect(result.current.state).toMatchObject({ status: "ready", cached: { verifiedAt: "2026-09-06T01:00:00.000Z" } });
      expect(channel.announceChange).toHaveBeenCalledOnce();
    });

    it("clears, empties, and tells the other tabs", async () => {
      const store = fakeStore(async () => ({ snapshot: snapshot(7), verifiedAt: "t" }));
      const channel = fakeChannel();
      const { result } = renderHook(() => useValidatedDocumentCache(store, channel));
      await waitFor(() => expect(result.current.state.status).toBe("ready"));

      await act(async () => { await result.current.clear(); });

      expect(store.clear).toHaveBeenCalledOnce();
      expect(result.current.state.status).toBe("empty");
      expect(channel.announceChange).toHaveBeenCalledOnce();
    });

    /*
     * A failed write must not leave the caller believing it succeeded, and must
     * not announce a change that never happened.
     */
    it("does not adopt or announce a save that failed", async () => {
      const store = fakeStore(async () => null);
      store.save.mockRejectedValueOnce(new Error("quota exceeded"));
      const channel = fakeChannel();
      const { result } = renderHook(() => useValidatedDocumentCache(store, channel));
      await waitFor(() => expect(result.current.state.status).toBe("empty"));

      await expect(act(async () => { await result.current.save(snapshot(9), "t"); })).rejects.toThrow("quota exceeded");
      expect(result.current.state.status).toBe("empty");
      expect(channel.announceChange).not.toHaveBeenCalled();
    });
  });

  describe("unmount", () => {
    it("stops listening to the channel", async () => {
      const channel = fakeChannel();
      const { unmount, result } = renderHook(() => useValidatedDocumentCache(fakeStore(async () => null), channel));
      await waitFor(() => expect(result.current.state.status).toBe("empty"));

      unmount();
      expect(channel.stop).toHaveBeenCalled();
    });

    /*
     * A read in flight when the component goes away must not try to set state on
     * it. That is what the `active` flag is for, and it is invisible to any test
     * that only renders to a string.
     */
    it("ignores a read that finishes after unmount", async () => {
      let finish: (value: null) => void = () => {};
      const store = fakeStore(() => new Promise((resolve) => { finish = resolve; }));
      const { unmount } = renderHook(() => useValidatedDocumentCache(store, fakeChannel()));

      unmount();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => { finish(null); await Promise.resolve(); });
      expect(errors).not.toHaveBeenCalled();
    });
  });
});
