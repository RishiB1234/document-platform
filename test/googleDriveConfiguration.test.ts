import { describe, expect, it } from "vitest";

import { GoogleDriveConfiguration, type GoogleDriveCredentials } from "../src/google/GoogleDriveConfiguration";
import type { DriveJsonApplicationConfig } from "../src/document/DriveJsonApplicationConfig";

const application: DriveJsonApplicationConfig = {
  applicationId: "test-app",
  documentName: "test-document.json",
  schemaVersion: 1,
};

const credentials: GoogleDriveCredentials = {
  clientId: "client",
  apiKey: "key",
  projectNumber: "project",
  fileId: "file",
};

describe("GoogleDriveConfiguration", () => {
  it("composes application identity with supplied deployment credentials", () => {
    const configuration = GoogleDriveConfiguration.create(application, credentials);
    expect(configuration.applicationId).toBe("test-app");
    expect(configuration.schemaVersion).toBe(1);
    expect(configuration.expectedFileName).toBe("test-document.json");
    expect(configuration.fileId).toBe("file");
    expect(configuration.cacheKey()).toBe("test-app:file");
  });

  it.each(["clientId", "apiKey", "projectNumber", "fileId"] as const)("rejects a missing %s", (field) => {
    expect(() => GoogleDriveConfiguration.create(application, { ...credentials, [field]: "" }))
      .toThrow(`Missing Google Drive configuration: ${field}`);
  });

  it.each(["clientId", "apiKey", "projectNumber", "fileId"] as const)("rejects a whitespace-only %s", (field) => {
    expect(() => GoogleDriveConfiguration.create(application, { ...credentials, [field]: "   " }))
      .toThrow(`Missing Google Drive configuration: ${field}`);
  });

  it("trims surrounding whitespace from deployment values", () => {
    const configuration = GoogleDriveConfiguration.create(application, { ...credentials, fileId: "  file  " });
    expect(configuration.fileId).toBe("file");
  });
});
