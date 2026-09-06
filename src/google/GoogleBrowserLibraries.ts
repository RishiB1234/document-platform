type GoogleApiLoader = {
  load(library: string, options: {
    callback: () => void;
    onerror: () => void;
    timeout: number;
    ontimeout: () => void;
  }): void;
};

type GoogleWindow = Window & {
  gapi?: GoogleApiLoader;
  google?: { accounts?: unknown; picker?: unknown };
};

export class GoogleBrowserLibraries {
  private loadPromise: Promise<void> | null = null;

  load(): Promise<void> {
    this.loadPromise ??= this.loadOnce().catch((error: unknown) => {
      this.loadPromise = null;
      throw error;
    });
    return this.loadPromise;
  }

  private async loadOnce(): Promise<void> {
    await Promise.all([
      this.loadScript("google-identity-services", "https://accounts.google.com/gsi/client"),
      this.loadScript("google-api-loader", "https://apis.google.com/js/api.js"),
    ]);
    await this.loadPicker();
  }

  private loadScript(id: string, source: string): Promise<void> {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === "true") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = existing ?? document.createElement("script");
      const loaded = () => { script.dataset.loaded = "true"; resolve(); };
      const failed = () => { script.remove(); reject(new Error(`Unable to load ${source}`)); };
      script.addEventListener("load", loaded, { once: true });
      script.addEventListener("error", failed, { once: true });
      if (!existing) {
        script.id = id;
        script.src = source;
        script.async = true;
        script.defer = true;
        document.head.append(script);
      }
    });
  }

  private loadPicker(): Promise<void> {
    const googleWindow = window as GoogleWindow;
    if (googleWindow.google?.picker) return Promise.resolve();
    if (!googleWindow.gapi) return Promise.reject(new Error("Google API Loader did not initialize"));
    return new Promise((resolve, reject) => {
      googleWindow.gapi!.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Google Picker failed to load")),
        timeout: 10_000,
        ontimeout: () => reject(new Error("Google Picker load timed out")),
      });
    });
  }
}
