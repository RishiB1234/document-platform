import type { ValidatedDocumentSnapshot } from "../document/ValidatedDocumentSnapshot.js";
import type { GoogleAccessTokenProvider } from "./GoogleAccessTokenProvider.js";
import type { GoogleDriveConfiguration } from "./GoogleDriveConfiguration.js";
import type { GoogleDriveFilePicker } from "./GoogleDriveFilePicker.js";

type DriveMetadata = {
  capabilities?: { canEdit?: boolean };
  headRevisionId?: string;
  id?: string;
  mimeType?: string;
  modifiedTime?: string;
  name?: string;
  size?: string;
  version?: string;
};

export class GoogleDriveDocumentSource<T> {
  constructor(
    private readonly configuration: GoogleDriveConfiguration,
    private readonly picker: GoogleDriveFilePicker,
    private readonly tokenProvider: GoogleAccessTokenProvider,
    private readonly parse: (text: string) => T,
  ) {}

  async load(selectFile: boolean, current: ValidatedDocumentSnapshot<T> | null = null): Promise<ValidatedDocumentSnapshot<T> | null> {
    const fileId = selectFile ? await this.picker.selectConfiguredFile() : this.configuration.fileId;
    if (!fileId) return null;
    if (fileId !== this.configuration.fileId) throw new Error("Refusing to read a different Drive file");
    const token = await this.tokenProvider.request();
    const metadata = await this.fetchMetadata(fileId, token);
    if (metadata.id !== fileId) throw new Error("Drive returned metadata for the wrong file");

    if (current?.fileId === fileId && ((metadata.headRevisionId && metadata.headRevisionId === current.revisionId) || (metadata.version && metadata.version === current.version))) {
      return {
        ...current,
        canEdit: metadata.capabilities?.canEdit === true,
        fileName: metadata.name ?? current.fileName,
        mimeType: metadata.mimeType ?? current.mimeType,
        modifiedTime: metadata.modifiedTime ?? current.modifiedTime,
        revisionId: metadata.headRevisionId ?? current.revisionId,
        size: this.parseSize(metadata.size),
        version: metadata.version ?? current.version,
      };
    }

    const documentText = await this.fetchContent(fileId, token);
    return {
      canEdit: metadata.capabilities?.canEdit === true,
      data: this.parse(documentText),
      documentText,
      fileId,
      fileName: metadata.name ?? this.configuration.expectedFileName,
      mimeType: metadata.mimeType ?? "application/json",
      modifiedTime: metadata.modifiedTime ?? null,
      revisionId: metadata.headRevisionId ?? null,
      size: this.parseSize(metadata.size),
      version: metadata.version ?? null,
    };
  }

  private async fetchMetadata(fileId: string, token: string): Promise<DriveMetadata> {
    const fields = "capabilities(canEdit),headRevisionId,id,mimeType,modifiedTime,name,size,version";
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set("fields", fields);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    await this.requireSuccess(response, "metadata");
    return response.json() as Promise<DriveMetadata>;
  }

  private async fetchContent(fileId: string, token: string): Promise<string> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set("alt", "media");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    await this.requireSuccess(response, "content");
    return response.text();
  }

  private async requireSuccess(response: Response, operation: string): Promise<void> {
    if (response.ok) return;
    if (response.status === 401) this.tokenProvider.clear();
    throw new Error(`Google Drive ${operation} request failed (${response.status})`);
  }

  private parseSize(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
}
