import type { DocumentSource } from "./DocumentSource.js";

/**
 * A document shipped with the application rather than fetched from a store.
 *
 * Useful in development, and as the thing a reader sees before they have
 * connected anything: a real document, of the real shape, with no credentials
 * and no network beyond the origin the application was served from.
 *
 * Validated on the way in like any other source. A bundled document is easy to
 * assume is correct precisely because it was checked in by hand, which is the
 * reason to check it: nothing else will.
 */
export class BundledDocumentSource<T> implements DocumentSource<T> {
  constructor(
    private readonly url: string,
    private readonly parse: (text: string) => T,
  ) {}

  async load(): Promise<T> {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`Bundled document request failed (${response.status})`);
    }
    return this.parse(await response.text());
  }
}
