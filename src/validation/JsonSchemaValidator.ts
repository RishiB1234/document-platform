import type { ErrorObject, ValidateFunction } from "ajv";

export class JsonDocumentValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(issues.join("; "));
    this.name = "JsonDocumentValidationError";
  }
}

/*
 * Takes an already-compiled validator rather than a schema. Ajv compiles a
 * schema by generating JavaScript and calling `new Function` on it, which a
 * Content Security Policy without 'unsafe-eval' refuses -- so compilation has
 * to happen at build time, and the import above is type-only so that Ajv never
 * enters the browser bundle at all.
 *
 * See config/schemaValidator.ts for the generator and docs/deployment-and-headers.md
 * for how this was found.
 */
export class JsonSchemaValidator<T> {
  /*
   * `ValidateFunction<unknown>`, not `<T>`: a validator generated from a schema
   * file has no knowledge of the TypeScript type, and claiming otherwise would
   * be a type predicate nobody checked. `parse` asserts the crossing explicitly
   * instead, at the single point where the schema is what makes it true.
   */
  constructor(private readonly validate: ValidateFunction<unknown>) {}

  parse(text: string): T {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "unknown parse error";
      throw new JsonDocumentValidationError([`Invalid JSON: ${detail}`]);
    }

    if (!this.validate(value)) {
      throw new JsonDocumentValidationError(this.format(this.validate.errors ?? []));
    }
    // Sound only because the schema and T describe the same document. This is
    // the one place that assumption is made, so it is the one place to check it.
    return value as T;
  }

  private format(errors: readonly ErrorObject[]): string[] {
    return errors.map((error) => {
      const path = error.instancePath || "$";
      return `${path}: ${error.message ?? "invalid value"}`;
    });
  }
}
