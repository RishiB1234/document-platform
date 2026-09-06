import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import { JsonDocumentValidationError, JsonSchemaValidator } from "../src/validation/JsonSchemaValidator.js";

/*
 * These tests did not exist before the extraction. In fitness-board this class
 * was only ever exercised through the fitness parser, so its own behaviour --
 * how it separates a JSON syntax failure from a schema failure, and how it
 * renders errors -- was covered incidentally by a test about something else.
 * The package owns it now, so it is tested at the layer that owns it.
 *
 * Note what makes that easy: the validator takes an already-compiled
 * `ValidateFunction` rather than a schema, so a stub is enough and no
 * validation library is needed here at all. That the tests need no ajv is the
 * clearest demonstration that the dependency really is optional.
 */

function stubValidator(outcome: boolean, errors: ValidateFunction["errors"] = null): ValidateFunction<unknown> {
  const validate = (() => outcome) as unknown as ValidateFunction<unknown>;
  validate.errors = errors;
  return validate;
}

type Doc = { name: string };

describe("JsonSchemaValidator", () => {
  it("returns the parsed document when the validator accepts it", () => {
    const validator = new JsonSchemaValidator<Doc>(stubValidator(true));
    expect(validator.parse('{"name":"ok"}')).toEqual({ name: "ok" });
  });

  /*
   * A syntax failure and a schema failure are different problems with different
   * fixes, and the message has to say which one happened.
   */
  it("reports malformed JSON as a JSON problem, not a schema problem", () => {
    const validator = new JsonSchemaValidator<Doc>(stubValidator(false));
    expect(() => validator.parse("{not json")).toThrow(JsonDocumentValidationError);
    try {
      validator.parse("{not json");
    } catch (error) {
      expect((error as JsonDocumentValidationError).issues).toHaveLength(1);
      expect((error as JsonDocumentValidationError).issues[0]).toMatch(/^Invalid JSON: /);
    }
  });

  it("never consults the validator when the text is not JSON at all", () => {
    let called = false;
    const validate = (() => { called = true; return true; }) as unknown as ValidateFunction<unknown>;
    validate.errors = null;
    expect(() => new JsonSchemaValidator<Doc>(validate).parse("{not json")).toThrow();
    expect(called).toBe(false);
  });

  it("renders each schema error with its instance path", () => {
    const validator = new JsonSchemaValidator<Doc>(stubValidator(false, [
      { instancePath: "/name", message: "must be string" },
      { instancePath: "/weeks/0/steps", message: "must be number" },
    ] as ValidateFunction["errors"]));
    try {
      validator.parse("{}");
      expect.unreachable("expected a validation failure");
    } catch (error) {
      expect((error as JsonDocumentValidationError).issues).toEqual([
        "/name: must be string",
        "/weeks/0/steps: must be number",
      ]);
    }
  });

  /*
   * An error at the document root carries an empty instancePath, which would
   * render as a bare ": must be object" and read like a formatting bug.
   */
  it("names the document root rather than showing an empty path", () => {
    const validator = new JsonSchemaValidator<Doc>(stubValidator(false, [
      { instancePath: "", message: "must be object" },
    ] as ValidateFunction["errors"]));
    try {
      validator.parse("[]");
      expect.unreachable("expected a validation failure");
    } catch (error) {
      expect((error as JsonDocumentValidationError).issues).toEqual(["$: must be object"]);
    }
  });

  it("survives a validator that rejects without saying why", () => {
    const validator = new JsonSchemaValidator<Doc>(stubValidator(false, null));
    try {
      validator.parse("{}");
      expect.unreachable("expected a validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonDocumentValidationError);
      expect((error as JsonDocumentValidationError).issues).toEqual([]);
    }
  });

  it("falls back to a placeholder for an error carrying no message", () => {
    const validator = new JsonSchemaValidator<Doc>(stubValidator(false, [
      { instancePath: "/name" },
    ] as ValidateFunction["errors"]));
    try {
      validator.parse("{}");
      expect.unreachable("expected a validation failure");
    } catch (error) {
      expect((error as JsonDocumentValidationError).issues).toEqual(["/name: invalid value"]);
    }
  });

  it("joins every issue into the error message, so a caller logging it loses nothing", () => {
    const error = new JsonDocumentValidationError(["/a: bad", "/b: worse"]);
    expect(error.message).toBe("/a: bad; /b: worse");
    expect(error.name).toBe("JsonDocumentValidationError");
  });
});
