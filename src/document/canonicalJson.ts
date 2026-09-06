/**
 * The single definition of "the bytes for this document".
 *
 * Three separate guarantees depend on this being one implementation rather than
 * three (see "Canonical serialization" in the spec):
 *
 *   1. the bytes uploaded to the store;
 *   2. the replay-equality check -- replaying the recorded operations against
 *      the base must produce text identical to the candidate, which is only
 *      meaningful if identical values always produce identical text;
 *   3. record equality in the replay adapter -- "does this record still equal
 *      `before`" is a comparison of canonical text.
 *
 * If (3) used a different notion of sameness than (1), the conflict decision
 * and the uploaded document could disagree.
 *
 * Domain-neutral by construction: it takes `unknown` and names nothing from any
 * application.
 */

/** Thrown for a value that has no faithful JSON form. */
export class CanonicalJsonError extends Error {
  constructor(path: string, detail: string) {
    // `path` is keys and indices only. Values are never interpolated: this
    // message can reach a log, and the document is private.
    super(`Cannot canonicalize ${path || "the document root"}: ${detail}`);
    this.name = "CanonicalJsonError";
  }
}

function describe(value: object): string {
  const name = value.constructor?.name;
  return name && name !== "Object" ? `unsupported ${name} value` : "unsupported object value";
}

function canonicalize(value: unknown, path: string): unknown {
  // Must precede the object branch: `typeof null` is "object", so an unguarded
  // object branch would recurse into null and emit `{}` -- a data-losing bug
  // that survives a casual read. null is a primitive here, no different from a
  // string or a number.
  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;

    case "number":
      // JSON.stringify turns NaN and Infinity into `null`, silently writing a
      // value nobody intended. Refuse instead. (-0 serializes as "0", which is
      // already canonical.)
      if (!Number.isFinite(value)) throw new CanonicalJsonError(path, `${value} is not a finite number`);
      return value;

    case "object":
      break;

    default:
      // undefined at the root, function, symbol, bigint.
      throw new CanonicalJsonError(path, `unsupported ${typeof value} value`);
  }

  if (Array.isArray(value)) {
    // Array order is semantic and belongs to the document -- never sorted.
    return value.map((element, index) => canonicalize(element, `${path}[${index}]`));
  }

  // Reject Date, Map, Set, and class instances rather than coercing them. A
  // Date would pass through JSON.stringify's toJSON hook and land as a string
  // that round-trips as data the author never wrote. Forms are the likely
  // source, so this must be loud.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(path, describe(value as object));
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  // Bare .sort() -- UTF-16 code unit order, identical everywhere. Never
  // localeCompare: it is locale- and ICU-dependent, so canonical text could
  // differ between a laptop and a phone, and this text feeds a data-integrity
  // comparison. The view components use localeCompare for display ordering,
  // which is correct there and is exactly what will be copied here by mistake.
  for (const key of Object.keys(source).sort()) {
    const property = source[key];
    // JSON has no `undefined`. Dropping the key is what makes `{}` and
    // `{ note: undefined }` the same record, which every optional field
    // depends on.
    if (property === undefined) continue;
    result[key] = canonicalize(property, path ? `${path}.${key}` : key);
  }
  return result;
}

/**
 * Canonical text for `value`: identical values always produce identical bytes.
 *
 * Keys are enumerated rather than read from a declared field list. Any scheme
 * that consults a declaration -- a field-order array, a class `toJSON`, a
 * schema walk -- silently drops a field somebody forgot to declare, and for an
 * optional field the result still validates and the data is simply gone.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value, ""), null, 2)}\n`;
}
