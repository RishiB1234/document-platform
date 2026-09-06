import type { DriveJsonApplicationConfig } from "../document/DriveJsonApplicationConfig.js";

export type GoogleDriveCredentials = {
  clientId: string;
  apiKey: string;
  projectNumber: string;
  fileId: string;
};

export class GoogleDriveConfiguration {
  private constructor(
    readonly applicationId: string,
    readonly schemaVersion: number,
    readonly clientId: string,
    readonly apiKey: string,
    readonly projectNumber: string,
    readonly fileId: string,
    readonly expectedFileName: string,
  ) {}

  static create(application: DriveJsonApplicationConfig, credentials: GoogleDriveCredentials): GoogleDriveConfiguration {
    return new GoogleDriveConfiguration(
      application.applicationId,
      application.schemaVersion,
      GoogleDriveConfiguration.require(credentials.clientId, "clientId"),
      GoogleDriveConfiguration.require(credentials.apiKey, "apiKey"),
      GoogleDriveConfiguration.require(credentials.projectNumber, "projectNumber"),
      GoogleDriveConfiguration.require(credentials.fileId, "fileId"),
      application.documentName,
    );
  }

  cacheKey(): string {
    return `${this.applicationId}:${this.fileId}`;
  }

  private static require(value: string | undefined, name: keyof GoogleDriveCredentials): string {
    const trimmed = value?.trim();
    if (!trimmed) throw new Error(`Missing Google Drive configuration: ${name}`);
    return trimmed;
  }
}
