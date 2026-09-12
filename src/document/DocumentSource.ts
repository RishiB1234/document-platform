/**
 * Somewhere a validated document can be read from.
 *
 * The document's type is a parameter, so nothing here knows what any
 * particular document is. That is the whole content of the abstraction: a
 * bundled file, a Drive file and whatever comes next have nothing in common
 * with each other except this method.
 *
 * Contributed by book-catalog, where the same interface named its own document
 * type and so depended on the thing it existed to abstract over.
 */
export interface DocumentSource<T> {
  load(): Promise<T>;
}
