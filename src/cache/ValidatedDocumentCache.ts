import type { CachedValidatedDocument, ValidatedDocumentSnapshot } from "../document/ValidatedDocumentSnapshot.js";

type CacheRecord = {
  cacheKey: string;
  applicationId: string;
  schemaVersion: number;
  documentText: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string | null;
  revisionId: string | null;
  size: number | null;
  verifiedAt: string;
  version: string | null;
};

export class ValidatedDocumentCache<T> {
  private static readonly databaseName = "drive-json-app-cache";
  private static readonly databaseVersion = 1;
  private static readonly storeName = "validated-documents";

  constructor(
    private readonly applicationId: string,
    private readonly fileId: string,
    private readonly schemaVersion: number,
    private readonly parse: (text: string) => T,
  ) {}

  cacheKey(): string { return `${this.applicationId}:${this.fileId}`; }

  async load(): Promise<CachedValidatedDocument<T> | null> {
    const database = await this.open();
    try {
      const transaction = database.transaction(ValidatedDocumentCache.storeName, "readonly");
      const record = await this.result<CacheRecord | undefined>(transaction.objectStore(ValidatedDocumentCache.storeName).get(this.cacheKey()));
      if (!record || record.applicationId !== this.applicationId || record.fileId !== this.fileId || record.schemaVersion !== this.schemaVersion) return null;
      try {
        const data = this.parse(record.documentText);
        return { snapshot: { canEdit: false, data, documentText: record.documentText, fileId: record.fileId, fileName: record.fileName, mimeType: record.mimeType, modifiedTime: record.modifiedTime, revisionId: record.revisionId, size: record.size, version: record.version }, verifiedAt: record.verifiedAt };
      } catch {
        await this.delete(database);
        return null;
      }
    } finally { database.close(); }
  }

  async save(snapshot: ValidatedDocumentSnapshot<T>, verifiedAt: string): Promise<void> {
    if (snapshot.fileId !== this.fileId) throw new Error("Refusing to cache a different Drive file");
    this.parse(snapshot.documentText);
    const record: CacheRecord = { cacheKey: this.cacheKey(), applicationId: this.applicationId, schemaVersion: this.schemaVersion, documentText: snapshot.documentText, fileId: snapshot.fileId, fileName: snapshot.fileName, mimeType: snapshot.mimeType, modifiedTime: snapshot.modifiedTime, revisionId: snapshot.revisionId, size: snapshot.size, verifiedAt, version: snapshot.version };
    const database = await this.open();
    try {
      const transaction = database.transaction(ValidatedDocumentCache.storeName, "readwrite");
      transaction.objectStore(ValidatedDocumentCache.storeName).put(record);
      await this.complete(transaction);
    } finally { database.close(); }
  }

  async clear(): Promise<void> {
    const database = await this.open();
    try { await this.delete(database); } finally { database.close(); }
  }

  private delete(database: IDBDatabase): Promise<void> {
    const transaction = database.transaction(ValidatedDocumentCache.storeName, "readwrite");
    transaction.objectStore(ValidatedDocumentCache.storeName).delete(this.cacheKey());
    return this.complete(transaction);
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(ValidatedDocumentCache.databaseName, ValidatedDocumentCache.databaseVersion);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(ValidatedDocumentCache.storeName)) request.result.createObjectStore(ValidatedDocumentCache.storeName, { keyPath: "cacheKey" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to open the document cache"));
      request.onblocked = () => reject(new Error("Document cache upgrade was blocked"));
    });
  }

  private result<R>(request: IDBRequest<R>): Promise<R> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Document cache request failed"));
    });
  }

  private complete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Document cache transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Document cache transaction was aborted"));
    });
  }
}
