import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDriveFilePicker } from "../src/google/GoogleDriveFilePicker.js";
import type { GoogleAccessTokenProvider } from "../src/google/GoogleAccessTokenProvider.js";
import type { GoogleBrowserLibraries } from "../src/google/GoogleBrowserLibraries.js";
import type { GoogleDriveConfiguration } from "../src/google/GoogleDriveConfiguration.js";

/*
 * No jsdom here: the picker never touches `document`, only `window.google`, so
 * a stubbed global is the whole environment it needs.
 *
 * The guarantee worth testing is the last one. This application is configured
 * against exactly one Drive file, and the picker shows the account's whole
 * Drive. Picking the wrong file must be refused rather than quietly adopted.
 */

const configuration = {
  projectNumber: "project-9",
  apiKey: "api-key",
  fileId: "configured-file",
  expectedFileName: "document.json",
} as GoogleDriveConfiguration;

const libraries = { load: vi.fn(async () => {}) } as unknown as GoogleBrowserLibraries;
const tokenProvider = { request: vi.fn(async () => "token-1"), clear: vi.fn() } as unknown as GoogleAccessTokenProvider;

let callback: (response: { action?: string; docs?: Array<{ id?: string }> }) => void;
let setVisible: ReturnType<typeof vi.fn>;
let built: Record<string, unknown>;

function installPicker() {
  setVisible = vi.fn();
  built = {};
  const builder: Record<string, unknown> = {};
  const record = (name: string) => vi.fn((value: unknown) => { built[name] = value; return builder; });
  Object.assign(builder, {
    addView: record("view"),
    setAppId: record("appId"),
    setDeveloperKey: record("developerKey"),
    setOAuthToken: record("oauthToken"),
    setTitle: record("title"),
    setCallback: vi.fn((fn: typeof callback) => { callback = fn; return builder; }),
    build: vi.fn(() => ({ setVisible })),
  });
  const view: Record<string, unknown> = {};
  Object.assign(view, {
    setIncludeFolders: vi.fn(() => view),
    setSelectFolderEnabled: vi.fn(() => view),
    setMode: vi.fn(() => view),
  });
  vi.stubGlobal("window", {
    google: {
      picker: {
        Action: { CANCEL: "cancel", PICKED: "picked" },
        DocsView: function () { return view; },
        DocsViewMode: { LIST: "list" },
        PickerBuilder: function () { return builder; },
      },
    },
  });
}

const picker = () => new GoogleDriveFilePicker(configuration, libraries, tokenProvider);

/*
 * Open the picker and wait until it is actually on screen. The result is
 * wrapped in an object deliberately: an async function flattens a returned
 * promise, so returning `pending` directly would make awaiting this helper wait
 * for the user's selection, which has not happened yet.
 */
async function opened(): Promise<{ pending: Promise<string | null> }> {
  const pending = picker().selectConfiguredFile();
  await vi.waitFor(() => expect(setVisible).toHaveBeenCalledWith(true));
  return { pending };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("GoogleDriveFilePicker", () => {
  it("loads the libraries and obtains a token before opening anything", async () => {
    installPicker();
    const { pending } = await opened();
    expect(libraries.load).toHaveBeenCalled();
    expect(tokenProvider.request).toHaveBeenCalled();
    callback({ action: "cancel" });
    await pending;
  });

  it("configures the picker from the application's own credentials", async () => {
    installPicker();
    const { pending } = await opened();
    expect(built.appId).toBe("project-9");
    expect(built.developerKey).toBe("api-key");
    expect(built.oauthToken).toBe("token-1");
    expect(built.title).toBe("Select document.json");
    callback({ action: "cancel" });
    await pending;
  });

  it("returns the file id when the configured file is chosen", async () => {
    installPicker();
    const { pending } = await opened();
    callback({ action: "picked", docs: [{ id: "configured-file" }] });
    await expect(pending).resolves.toBe("configured-file");
  });

  /*
   * The guard that matters. The picker lists the account's entire Drive, and
   * this application is configured against one file. Adopting whatever was
   * clicked would point it at a document it has no schema for.
   */
  it("refuses a file that is not the configured one", async () => {
    installPicker();
    const { pending } = await opened();
    callback({ action: "picked", docs: [{ id: "somebody-elses-file" }] });
    await expect(pending).rejects.toThrow(/not the configured document\.json file/);
  });

  it("reports a cancellation as no selection rather than a failure", async () => {
    installPicker();
    const { pending } = await opened();
    callback({ action: "cancel" });
    await expect(pending).resolves.toBeNull();
  });

  it("rejects a pick that carries no file at all", async () => {
    installPicker();
    const { pending } = await opened();
    callback({ action: "picked", docs: [] });
    await expect(pending).rejects.toThrow(/did not return a file/);
  });

  /*
   * The picker emits other actions during its lifetime. Anything that is
   * neither a pick nor a cancel must leave the promise pending rather than
   * resolving to nothing.
   */
  it("ignores actions that are neither a pick nor a cancel", async () => {
    installPicker();
    const { pending } = await opened();
    const settled = vi.fn();
    void pending.then(settled, settled);

    callback({ action: "loaded" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).not.toHaveBeenCalled();

    callback({ action: "cancel" });
    await pending;
  });

  it("fails clearly when the picker library never initialized", async () => {
    vi.stubGlobal("window", { google: {} });
    await expect(picker().selectConfiguredFile()).rejects.toThrow(/Picker did not initialize/);
  });
});
