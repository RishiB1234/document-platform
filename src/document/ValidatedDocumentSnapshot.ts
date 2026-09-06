export type ValidatedDocumentSnapshot<T> = {
  canEdit: boolean;
  data: T;
  documentText: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string | null;
  revisionId: string | null;
  size: number | null;
  version: string | null;
};

export type CachedValidatedDocument<T> = {
  snapshot: ValidatedDocumentSnapshot<T>;
  verifiedAt: string;
};
