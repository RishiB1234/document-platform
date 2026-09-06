// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOnlineStatus } from "../src/connectivity/useOnlineStatus.js";

/*
 * jsdom is opt-in per file, not the default environment. Most of this package
 * is better tested in real Node -- IndexedDB through fake-indexeddb,
 * BroadcastChannel natively -- and a simulated DOM everywhere would only add
 * approximation where none is needed.
 *
 * What these tests prove is wiring: that listeners are attached, that state
 * follows the events, and that nothing is left behind on unmount. What they
 * cannot prove is browser behaviour; jsdom's events are a reimplementation. A
 * hook whose entire job is subscribing and unsubscribing is exactly the case
 * where wiring coverage is the coverage that matters.
 */

function Indicator() {
  return <span data-testid="status">{useOnlineStatus() ? "online" : "offline"}</span>;
}

const status = () => screen.getByTestId("status").textContent;
const setBrowserOnline = (online: boolean) =>
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });

afterEach(() => {
  // Auto-cleanup only registers itself when vitest globals are enabled, and they
  // are not: without this, every render accumulates in one shared document.
  cleanup();
  setBrowserOnline(true);
  vi.restoreAllMocks();
});

describe("useOnlineStatus", () => {
  it("starts from what the browser already reports", () => {
    setBrowserOnline(false);
    render(<Indicator />);
    expect(status()).toBe("offline");
  });

  it("follows the browser going offline and coming back", () => {
    render(<Indicator />);
    expect(status()).toBe("online");

    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(status()).toBe("offline");

    act(() => { window.dispatchEvent(new Event("online")); });
    expect(status()).toBe("online");
  });

  /*
   * The half a string-rendering test can never reach. Every mounted copy of a
   * component adds listeners to one shared window, so a hook that does not
   * remove them leaks on every unmount and keeps updating components that are
   * gone.
   */
  it("removes both listeners on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(<Indicator />);
    const added = add.mock.calls.filter(([event]) => event === "online" || event === "offline");
    expect(added).toHaveLength(2);

    unmount();
    const removed = remove.mock.calls.filter(([event]) => event === "online" || event === "offline");
    expect(removed).toHaveLength(2);
    // The same function references, or the removal silently does nothing.
    expect(removed.map(([, handler]) => handler)).toEqual(added.map(([, handler]) => handler));
  });

  it("stops responding to events once unmounted", () => {
    const { unmount } = render(<Indicator />);
    unmount();
    // Would throw an update-after-unmount error if the listener survived.
    expect(() => act(() => { window.dispatchEvent(new Event("offline")); })).not.toThrow();
  });

  it("subscribes once, not on every render", () => {
    const add = vi.spyOn(window, "addEventListener");
    const { rerender } = render(<Indicator />);
    rerender(<Indicator />);
    rerender(<Indicator />);
    expect(add.mock.calls.filter(([event]) => event === "online").length).toBe(1);
  });
});
