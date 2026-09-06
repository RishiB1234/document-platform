import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentCacheChannel } from "../src/cache/DocumentCacheChannel.js";

/*
 * Untested in fitness-board and untested here until the extraction measured it,
 * despite needing no DOM at all: BroadcastChannel is part of Node 22. The
 * absence was habit, not obstacle.
 *
 * A browser never delivers a tab its own announcement, and Node's
 * implementation follows that, so every test here uses two channels: one
 * standing in for the writing tab, one for the reading tab.
 */

const opened: DocumentCacheChannel[] = [];
const channel = (applicationId: string) => {
  const created = new DocumentCacheChannel(applicationId);
  opened.push(created);
  return created;
};

/** BroadcastChannel delivery is asynchronous; give it a turn to arrive. */
const delivered = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  while (opened.length > 0) opened.pop()!.close();
  vi.unstubAllGlobals();
});

describe("DocumentCacheChannel", () => {
  it("tells another tab that the cache changed", async () => {
    const writer = channel("app-a");
    const reader = channel("app-a");
    const heard = vi.fn();
    reader.onChange(heard);

    writer.announceChange();
    await delivered();
    expect(heard).toHaveBeenCalledOnce();
  });

  it("does not announce to the tab that made the change", async () => {
    const writer = channel("app-a");
    const heard = vi.fn();
    writer.onChange(heard);

    writer.announceChange();
    await delivered();
    expect(heard).not.toHaveBeenCalled();
  });

  /*
   * The channel is named per application, so two applications sharing a browser
   * cannot make each other re-read a cache that did not change.
   */
  it("keeps applications from hearing each other", async () => {
    const writer = channel("app-a");
    const other = channel("app-b");
    const heard = vi.fn();
    other.onChange(heard);

    writer.announceChange();
    await delivered();
    expect(heard).not.toHaveBeenCalled();
  });

  it("stops delivering once the listener is removed", async () => {
    const writer = channel("app-a");
    const reader = channel("app-a");
    const heard = vi.fn();
    const stop = reader.onChange(heard);

    stop();
    writer.announceChange();
    await delivered();
    expect(heard).not.toHaveBeenCalled();
  });

  it("ignores traffic on the channel that is not its own signal", async () => {
    const reader = channel("app-a");
    const heard = vi.fn();
    reader.onChange(heard);

    const raw = new BroadcastChannel("app-a-cache");
    raw.postMessage("something else entirely");
    await delivered();
    raw.close();
    expect(heard).not.toHaveBeenCalled();
  });

  /*
   * Losing the channel costs a tab its freshness, never its correctness, so it
   * must go quiet rather than take the document down with it. Old browsers, and
   * any runtime without the API.
   */
  describe("where BroadcastChannel does not exist", () => {
    it("constructs, announces and closes without throwing", () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const quiet = new DocumentCacheChannel("app-a");
      expect(() => quiet.announceChange()).not.toThrow();
      expect(() => quiet.close()).not.toThrow();
    });

    it("returns an unsubscribe that is safe to call", () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const quiet = new DocumentCacheChannel("app-a");
      const stop = quiet.onChange(() => { throw new Error("must never run"); });
      expect(() => stop()).not.toThrow();
    });
  });
});
