import type { GoogleBrowserLibraries } from "./GoogleBrowserLibraries.js";
import type { GoogleDriveConfiguration } from "./GoogleDriveConfiguration.js";

type TokenResponse = { access_token?: string; error?: string; error_description?: string; expires_in?: number };
type TokenClient = { requestAccessToken(options: { prompt: string }): void };
type GoogleIdentityWindow = Window & {
  google?: { accounts?: { oauth2?: { initTokenClient(options: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback: (error: { type?: string }) => void;
  }): TokenClient } } };
};

export class GoogleAccessTokenProvider {
  private static readonly scope = "https://www.googleapis.com/auth/drive.file";
  private static readonly expiryMarginMilliseconds = 60_000;
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly configuration: GoogleDriveConfiguration,
    private readonly libraries: GoogleBrowserLibraries,
  ) {}

  async request(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - GoogleAccessTokenProvider.expiryMarginMilliseconds) {
      return this.accessToken;
    }
    await this.libraries.load();
    return this.requestNewToken();
  }

  clear(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private requestNewToken(): Promise<string> {
    const oauth2 = (window as GoogleIdentityWindow).google?.accounts?.oauth2;
    if (!oauth2) return Promise.reject(new Error("Google Identity Services did not initialize"));
    return new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.configuration.clientId,
        scope: GoogleAccessTokenProvider.scope,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(`Google authorization failed: ${response.error_description ?? response.error ?? "Unknown error"}`));
            return;
          }
          this.accessToken = response.access_token;
          this.expiresAt = Date.now() + (response.expires_in ?? 3_600) * 1_000;
          resolve(response.access_token);
        },
        error_callback: (error) => reject(new Error(`Google authorization did not complete: ${error.type ?? "Unknown error"}`)),
      });
      client.requestAccessToken({ prompt: "" });
    });
  }
}
