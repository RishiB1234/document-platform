import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleAccessTokenProvider } from "../src/google/GoogleAccessTokenProvider.js";
import type { GoogleBrowserLibraries } from "../src/google/GoogleBrowserLibraries.js";
import type { GoogleDriveConfiguration } from "../src/google/GoogleDriveConfiguration.js";

/*
 * Untested in fitness-board and untested here until the extraction measured it,
 * though it needs no DOM: everything it touches is reachable by stubbing a
 * `window` global. This is the component that decides how often a person is
 * asked to authorize, and how long a token stays in memory.
 */

type TokenCallback = (response: Record<string, unknown>) => void;
type ErrorCallback = (error: { type?: string }) => void;

let respond: TokenCallback;
let fail: ErrorCallback;
let requestAccessToken: ReturnType<typeof vi.fn>;
let initTokenClient: ReturnType<typeof vi.fn>;

const configuration = { clientId: "client-123" } as GoogleDriveConfiguration;
const libraries = { load: vi.fn(async () => {}) } as unknown as GoogleBrowserLibraries;

function installGoogleIdentity() {
  requestAccessToken = vi.fn();
  initTokenClient = vi.fn((options: { callback: TokenCallback; error_callback: ErrorCallback }) => {
    respond = options.callback;
    fail = options.error_callback;
    return { requestAccessToken };
  });
  vi.stubGlobal("window", { google: { accounts: { oauth2: { initTokenClient } } } });
}

/** Drive the asynchronous request/callback handshake in one step. */
async function tokenFrom(provider: GoogleAccessTokenProvider, response: Record<string, unknown>): Promise<string> {
  const pending = provider.request();
  await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());
  respond(response);
  return pending;
}

const granted = (over: Record<string, unknown> = {}) => ({ access_token: "token-1", expires_in: 3_600, ...over });

beforeEach(() => { installGoogleIdentity(); vi.mocked(libraries.load).mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("GoogleAccessTokenProvider", () => {
  it("requests the drive.file scope and the configured client, and never prompts unnecessarily", async () => {
    const provider = new GoogleAccessTokenProvider(configuration, libraries);
    expect(await tokenFrom(provider, granted())).toBe("token-1");

    expect(initTokenClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: "client-123",
      scope: "https://www.googleapis.com/auth/drive.file",
    }));
    // The silent path: an empty prompt reuses an existing Google session.
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "" });
  });

  it("loads the Google libraries before asking for a token", async () => {
    const provider = new GoogleAccessTokenProvider(configuration, libraries);
    await tokenFrom(provider, granted());
    expect(libraries.load).toHaveBeenCalled();
  });

  /*
   * The point of holding the token at all: a second request inside its lifetime
   * must not reach Google, or every save would risk a visible prompt.
   */
  it("reuses a live token instead of asking again", async () => {
    const provider = new GoogleAccessTokenProvider(configuration, libraries);
    await tokenFrom(provider, granted());

    expect(await provider.request()).toBe("token-1");
    expect(initTokenClient).toHaveBeenCalledOnce();
    expect(requestAccessToken).toHaveBeenCalledOnce();
  });

  /*
   * A token is refreshed a minute before it expires. Without the margin, a token
   * that passes the check can still expire in flight, and the failure lands
   * mid-write rather than before it.
   */
  describe("the expiry margin", () => {
    it("still reuses a token with more than a minute left", async () => {
      vi.useFakeTimers();
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      await tokenFrom(provider, granted({ expires_in: 300 }));

      vi.advanceTimersByTime(200_000); // 100 seconds left
      expect(await provider.request()).toBe("token-1");
      expect(requestAccessToken).toHaveBeenCalledOnce();
    });

    it("replaces a token inside its final minute, before it can expire mid-write", async () => {
      vi.useFakeTimers();
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      await tokenFrom(provider, granted({ expires_in: 300 }));

      vi.advanceTimersByTime(250_000); // 50 seconds left: inside the margin
      const second = provider.request();
      await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalledTimes(2));
      respond(granted({ access_token: "token-2" }));
      expect(await second).toBe("token-2");
    });

    it("treats a response with no stated lifetime as an hour", async () => {
      vi.useFakeTimers();
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      await tokenFrom(provider, { access_token: "token-1" });

      vi.advanceTimersByTime(3_000_000); // 50 minutes
      expect(await provider.request()).toBe("token-1");
      expect(requestAccessToken).toHaveBeenCalledOnce();
    });
  });

  it("forgets the token on clear, so the next request asks again", async () => {
    const provider = new GoogleAccessTokenProvider(configuration, libraries);
    await tokenFrom(provider, granted());

    provider.clear();
    const second = provider.request();
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalledTimes(2));
    respond(granted({ access_token: "token-2" }));
    expect(await second).toBe("token-2");
  });

  describe("failures", () => {
    it("rejects when Google Identity Services never initialized", async () => {
      vi.stubGlobal("window", {});
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      await expect(provider.request()).rejects.toThrow(/did not initialize/);
    });

    it("reports the description Google gave for a refusal", async () => {
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      const pending = provider.request();
      await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());
      respond({ error: "access_denied", error_description: "The user denied access" });
      await expect(pending).rejects.toThrow(/The user denied access/);
    });

    it("rejects a response carrying no token at all, even without an error", async () => {
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      const pending = provider.request();
      await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());
      respond({ expires_in: 3_600 });
      await expect(pending).rejects.toThrow(/authorization failed/);
    });

    it("rejects when the flow does not complete, naming the reason", async () => {
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      const pending = provider.request();
      await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());
      fail({ type: "popup_closed" });
      await expect(pending).rejects.toThrow(/popup_closed/);
    });

    /*
     * A failed request must leave nothing behind: the next attempt has to ask
     * again rather than serve a token that was never granted.
     */
    it("caches nothing after a failure", async () => {
      const provider = new GoogleAccessTokenProvider(configuration, libraries);
      const pending = provider.request();
      await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());
      respond({ error: "access_denied" });
      await expect(pending).rejects.toThrow();

      const second = provider.request();
      await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalledTimes(2));
      respond(granted({ access_token: "token-2" }));
      expect(await second).toBe("token-2");
    });
  });
});
