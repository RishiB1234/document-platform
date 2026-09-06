import type { GoogleAccessTokenProvider } from "./GoogleAccessTokenProvider.js";
import type { GoogleBrowserLibraries } from "./GoogleBrowserLibraries.js";
import type { GoogleDriveConfiguration } from "./GoogleDriveConfiguration.js";

type PickerResponse = { action?: string; docs?: Array<{ id?: string }> };
type PickerInstance = { setVisible(visible: boolean): void };
type PickerView = { setIncludeFolders(value: boolean): PickerView; setMode(value: unknown): PickerView; setSelectFolderEnabled(value: boolean): PickerView };
type PickerBuilder = { addView(view: PickerView): PickerBuilder; setAppId(value: string): PickerBuilder; setCallback(value: (response: PickerResponse) => void): PickerBuilder; setDeveloperKey(value: string): PickerBuilder; setOAuthToken(value: string): PickerBuilder; setTitle(value: string): PickerBuilder; build(): PickerInstance };
type PickerApi = { Action: { CANCEL: string; PICKED: string }; DocsView: new () => PickerView; DocsViewMode: { LIST: unknown }; PickerBuilder: new () => PickerBuilder };
type PickerWindow = Window & { google?: { picker?: PickerApi } };

export class GoogleDriveFilePicker {
  constructor(
    private readonly configuration: GoogleDriveConfiguration,
    private readonly libraries: GoogleBrowserLibraries,
    private readonly tokenProvider: GoogleAccessTokenProvider,
  ) {}

  async selectConfiguredFile(): Promise<string | null> {
    await this.libraries.load();
    const token = await this.tokenProvider.request();
    const api = (window as PickerWindow).google?.picker;
    if (!api) throw new Error("Google Picker did not initialize");
    return new Promise((resolve, reject) => {
      const view = new api.DocsView().setIncludeFolders(false).setSelectFolderEnabled(false).setMode(api.DocsViewMode.LIST);
      new api.PickerBuilder()
        .addView(view)
        .setAppId(this.configuration.projectNumber)
        .setDeveloperKey(this.configuration.apiKey)
        .setOAuthToken(token)
        .setTitle(`Select ${this.configuration.expectedFileName}`)
        .setCallback((response) => {
          if (response.action === api.Action.CANCEL) { resolve(null); return; }
          if (response.action !== api.Action.PICKED) return;
          const selected = response.docs?.[0]?.id;
          if (!selected) { reject(new Error("Google Picker did not return a file")); return; }
          if (selected !== this.configuration.fileId) { reject(new Error(`That is not the configured ${this.configuration.expectedFileName} file`)); return; }
          resolve(selected);
        }).build().setVisible(true);
    });
  }
}
