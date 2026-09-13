/**
 * Stable identity for a record inside a document.
 *
 * A document-backed application eventually needs to say "this record" in a way
 * that survives the document being edited elsewhere. Position cannot do it: an
 * index recorded against one state names something else in another, which is
 * exactly the failure that appears the moment a change is handed to a component
 * that sees the change without the document it came from -- which is what
 * change squashing and replay do.
 *
 * Ten characters from a thirty-symbol alphabet: 5.9e14 combinations. Short
 * because the whole document is typically read on every load, and safe because
 * uniqueness is checked against the document rather than assumed -- see
 * {@link mintRecordId}. `i l o u 0 1` are excluded as ambiguous when a human
 * compares two ids in a diff.
 *
 * **There is deliberately one scheme, and no option to choose another.** A
 * sequential generator keyed off the highest id in use is the obvious
 * alternative and is unsafe here: two sessions editing concurrently both read
 * the same maximum and both mint the next value, which collides on precisely
 * the field that exists to be unique. This package's replay and rebase support
 * assumes concurrent editors, so shipping that alternative would hand every
 * consumer a footgun that only fires under the conditions the package is for.
 * If ids need to be human-friendly, that is a display concern; the ambiguous
 * characters are already excluded for it.
 *
 * Walking a document to find its records is the application's business, not
 * this module's: only the application knows what counts as a record. What is
 * here is the identity itself and the guarantee attached to it.
 */
export const RECORD_ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
export const RECORD_ID_LENGTH = 10;

const PATTERN = new RegExp(`^[${RECORD_ID_ALPHABET}]{${RECORD_ID_LENGTH}}$`);

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && PATTERN.test(value);
}

/**
 * The id of a record already admitted to a document.
 *
 * Callers want a `string`, not `string | undefined`: a validator that requires
 * every record to carry an id has already refused any document where one does
 * not, so optionality in the types exists only so a partially built record can
 * be typed. Throwing turns "the id was quietly undefined" into a named failure
 * at the point it happened rather than a puzzle at save time.
 */
export function recordIdOf(record: { id?: string }): string {
  if (!isRecordId(record.id)) {
    throw new Error("This record has no id; it was never admitted to the document");
  }
  return record.id;
}

/** Anything that can answer whether an id is already in use. */
export type TakenIds = { has(id: string): boolean };

/**
 * A record id not present in `taken`.
 *
 * Retries rather than trusting the generator. A collision at this size is
 * vanishingly unlikely, but the check costs nothing and is what allows the id
 * to be short in the first place. It never falls back to a counter or a
 * timestamp: a predictable id would be worse than failing, because it would
 * collide silently instead of loudly.
 *
 * `taken` is usually the key set of an index the caller just built from the
 * document, so there is no separate set to keep in step with it.
 */
export function mintRecordId(taken: TakenIds): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let id = "";
    while (id.length < RECORD_ID_LENGTH) {
      // Rejection sampling, not modulo. 256 is not a multiple of 30, so `% 30`
      // would favour the first sixteen symbols -- harmless at this scale, but
      // this is a library, and a biased alphabet is the kind of thing that is
      // measured later and cannot then be changed without invalidating ids.
      for (const byte of crypto.getRandomValues(new Uint8Array(RECORD_ID_LENGTH))) {
        if (byte >= 240) continue;
        id += RECORD_ID_ALPHABET[byte % RECORD_ID_ALPHABET.length];
        if (id.length === RECORD_ID_LENGTH) break;
      }
    }
    if (!taken.has(id)) return id;
  }
  throw new Error("Could not mint a unique record id");
}
