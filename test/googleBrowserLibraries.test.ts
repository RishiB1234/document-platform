// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleBrowserLibraries } from "../src/google/GoogleBrowserLibraries.js";

/*
 * More than a script tag: this holds a load-once promise, drops it again if the
 * load fails, reuses a script another instance already added, and waits for the
 * picker on top of the two scripts. All of that is wiring, and all of it was at
 * zero coverage.
 *
 * jsdom does not fetch the scripts -- nothing here proves Google's code loads.
 * It proves this class reacts correctly to being told that it did or did not.
 */

const scripts = () => [...document.head.querySelectorAll("script")];
const scriptFor = (id: string) => document.getElementById(id) as HTMLScriptElement | null;

/** Report success on both script tags, the way a browser would. */
const bothScriptsLoad = () => scripts().forEach((script) => script.dispatchEvent(new Event("load")));

function installGapi(behaviour: "callback" | "onerror" | "ontimeout" = "callback") {
  const load = vi.fn((_library: string, options: Record<string, () => void>) => {
    options[behaviour]!();
  });
  (window as unknown as { gapi: unknown }).gapi = { load };
  return load;
}

afterEach(() => {
  document.head.innerHTML = "";
  delete (window as unknown as { gapi?: unknown }).gapi;
  delete (window as unknown as { google?: unknown }).google;
  vi.restoreAllMocks();
});

describe("GoogleBrowserLibraries", () => {
  it("adds both Google scripts, deferred and async, and resolves once the picker is ready", async () => {
    installGapi();
    const libraries = new GoogleBrowserLibraries();
    const pending = libraries.load();

    expect(scriptFor("google-identity-services")?.src).toBe("https://accounts.google.com/gsi/client");
    expect(scriptFor("google-api-loader")?.src).toBe("https://apis.google.com/js/api.js");
    expect(scripts().every((s) => s.async && s.defer)).toBe(true);

    bothScriptsLoad();
    await expect(pending).resolves.toBeUndefined();
  });

  /*
   * The load-once promise. Two callers -- a token request and a picker open --
   * arriving together must not each append their own copy of Google's scripts.
   */
  it("loads once however many callers ask", async () => {
    installGapi();
    const libraries = new GoogleBrowserLibraries();
    const first = libraries.load();
    const second = libraries.load();

    // Promise identity is the memoization: counting scripts does not test it,
    // because loadScript finds an existing tag by id and reuses it either way.
    expect(second).toBe(first);
    expect(scripts()).toHaveLength(2);

    bothScriptsLoad();
    await Promise.all([first, second]);
    expect(scripts()).toHaveLength(2);

    // And still the same promise once resolved, rather than a fresh load.
    expect(libraries.load()).toBe(first);
  });

  it("does not re-add a script that already reported success", async () => {
    installGapi();
    await (async () => {
      const pending = new GoogleBrowserLibraries().load();
      bothScriptsLoad();
      await pending;
    })();

    // A second instance, as a fresh mount would create.
    const second = new GoogleBrowserLibraries();
    await expect(second.load()).resolves.toBeUndefined();
    expect(scripts()).toHaveLength(2);
  });

  describe("failure", () => {
    it("rejects naming the script that failed, and removes it", async () => {
      installGapi();
      const pending = new GoogleBrowserLibraries().load();
      scriptFor("google-identity-services")!.dispatchEvent(new Event("error"));

      await expect(pending).rejects.toThrow(/accounts\.google\.com\/gsi\/client/);
      expect(scriptFor("google-identity-services")).toBeNull();
    });

    /*
     * The retry path. A failed load must clear the cached promise, or a network
     * blip at startup would leave the application permanently unable to sign in
     * with no way back short of a reload.
     */
    it("forgets a failed load, so a later attempt genuinely retries", async () => {
      installGapi();
      const libraries = new GoogleBrowserLibraries();

      const first = libraries.load();
      scriptFor("google-identity-services")!.dispatchEvent(new Event("error"));
      await expect(first).rejects.toThrow();

      document.head.innerHTML = "";
      const second = libraries.load();
      expect(scripts()).toHaveLength(2);
      bothScriptsLoad();
      await expect(second).resolves.toBeUndefined();
    });

    it("rejects when the API loader never arrived", async () => {
      const pending = new GoogleBrowserLibraries().load();
      bothScriptsLoad();
      await expect(pending).rejects.toThrow(/API Loader did not initialize/);
    });

    it("reports a picker that fails to load", async () => {
      installGapi("onerror");
      const pending = new GoogleBrowserLibraries().load();
      bothScriptsLoad();
      await expect(pending).rejects.toThrow(/Picker failed to load/);
    });

    it("reports a picker that never answers", async () => {
      installGapi("ontimeout");
      const pending = new GoogleBrowserLibraries().load();
      bothScriptsLoad();
      await expect(pending).rejects.toThrow(/timed out/);
    });
  });

  it("skips the picker load entirely when it is already present", async () => {
    const load = installGapi();
    (window as unknown as { google: unknown }).google = { picker: {} };

    const pending = new GoogleBrowserLibraries().load();
    bothScriptsLoad();
    await expect(pending).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});
