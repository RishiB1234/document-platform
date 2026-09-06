/*
 * Every tab runs its own copy of the application with its own in-memory
 * document, but all of them share the one IndexedDB record. A tab that writes
 * that record leaves the others drawing from a copy that no longer matches the
 * disk, and nothing in IndexedDB tells them so. This channel carries the
 * missing signal: the tab that writes announces it, and the others re-read.
 *
 * A browser does not deliver a tab its own announcement, so a writer never
 * reloads in response to itself.
 *
 * Named per application, so two applications sharing a browser cannot hear each
 * other's announcements and re-read a cache that did not change.
 */
export class DocumentCacheChannel {
  private readonly channel: BroadcastChannel | null;
  private readonly changeMessage: string;

  constructor(applicationId: string) {
    this.changeMessage = `${applicationId}-cache-changed`;
    // Absent under a test runner with no DOM, and in browsers too old to carry
    // the API. Losing the channel costs a tab only its freshness, so it goes
    // quiet rather than taking the document down with it.
    this.channel = typeof BroadcastChannel === "function"
      ? new BroadcastChannel(`${applicationId}-cache`)
      : null;
  }

  announceChange(): void { this.channel?.postMessage(this.changeMessage); }

  onChange(listener: () => void): () => void {
    if (!this.channel) return () => {};
    const receive = (event: MessageEvent) => { if (event.data === this.changeMessage) listener(); };
    this.channel.addEventListener("message", receive);
    return () => this.channel?.removeEventListener("message", receive);
  }

  close(): void { this.channel?.close(); }
}
