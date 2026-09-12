import type { ValidatedDocumentSnapshot } from "./ValidatedDocumentSnapshot.js";

/**
 * Hands the reader the exact bytes the store holds.
 *
 * Deliberately the snapshot's own `documentText` rather than a re-serialization
 * of its `data`. The point of the button is to obtain the document as it exists,
 * and anything that re-renders it could hand back something subtly different
 * from what is stored -- which is the one thing a download must not do.
 */
export class DocumentDownloader<T> {
  constructor(private readonly fallbackFileName: string) {}

  download(snapshot: ValidatedDocumentSnapshot<T>): void {
    const blob = new Blob([snapshot.documentText], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = snapshot.fileName || this.fallbackFileName;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked immediately: the click has already started the download, and a
    // blob URL left alive holds the whole document in memory.
    URL.revokeObjectURL(url);
  }
}
