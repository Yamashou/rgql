/**
 * Pure validation functions for rename commands.
 *
 * Each validator checks preconditions against the schema/documents and returns
 * a Result — never throws. Format functions convert errors to user-facing strings.
 *
 * @module
 */
import type { GraphQLSchema } from "graphql";
import { isObjectType, isInterfaceType, isInputObjectType } from "graphql";
import type {
  TypeName,
  FieldName,
  FragmentName,
  ValidationError,
  EmbeddedQueryContent,
} from "../types/domain";
import { toTypeName, toFieldName } from "../types/domain";
import { ok, err, type Result } from "../types/result";

/**
 * Parses a "Type.field" string into its constituent parts.
 *
 * @precondition `input` should be a non-empty string.
 * @postcondition On success, both `typeName` and `fieldName` are non-empty branded strings.
 *
 * @param input - A string in "Type.field" format (e.g. "User.firstName").
 * @returns A Result containing the parsed pair or an `invalid-field-format` error.
 */
export function parseFieldArgument(
  input: string,
): Result<{ typeName: TypeName; fieldName: FieldName }, ValidationError> {
  const parts = input.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return err({ kind: "invalid-field-format", input });
  }
  return ok({
    typeName: toTypeName(parts[0]),
    fieldName: toFieldName(parts[1]),
  });
}

/**
 * Validates that a type rename is possible.
 *
 * @precondition `schema` is a valid GraphQLSchema.
 * @postcondition On success, `oldName` exists and `newName` does not exist in the schema.
 *
 * @returns `ok(undefined)` if valid, or an error describing the conflict.
 */
export function validateRenameType(
  schema: GraphQLSchema,
  oldName: TypeName,
  newName: TypeName,
): Result<void, ValidationError> {
  if (!schema.getType(oldName)) {
    return err({ kind: "type-not-found", typeName: oldName });
  }
  if (schema.getType(newName)) {
    return err({ kind: "type-already-exists", typeName: newName });
  }
  return ok(undefined);
}

/**
 * Validates that a field rename is possible.
 *
 * @precondition `schema` is a valid GraphQLSchema.
 * @postcondition On success, `typeName` exists with `oldFieldName` but not `newFieldName`.
 *
 * @returns `ok(undefined)` if valid, or an error describing the conflict.
 */
export function validateRenameField(
  schema: GraphQLSchema,
  typeName: TypeName,
  oldFieldName: FieldName,
  newFieldName: FieldName,
): Result<void, ValidationError> {
  const type = schema.getType(typeName);
  if (!type) {
    return err({ kind: "type-not-found", typeName });
  }

  const hasFields = isObjectType(type) || isInterfaceType(type) || isInputObjectType(type);
  const fields = hasFields ? type.getFields() : null;
  if (!fields || !fields[oldFieldName]) {
    return err({ kind: "field-not-found", typeName, fieldName: oldFieldName });
  }
  if (fields[newFieldName]) {
    return err({
      kind: "field-already-exists",
      typeName,
      fieldName: newFieldName,
    });
  }
  return ok(undefined);
}

/**
 * Validates that a fragment rename is possible.
 *
 * @precondition `queries` contains all loaded document queries.
 * @postcondition On success, at least one FragmentDefinition with `oldName` exists.
 *
 * @returns `ok(undefined)` if valid, or a `fragment-not-found` error.
 */
export function validateRenameFragment(
  queries: readonly EmbeddedQueryContent[],
  oldName: FragmentName,
): Result<void, ValidationError> {
  const exists = queries.some((query) =>
    query.document.definitions.some(
      (definition) => definition.kind === "FragmentDefinition" && definition.name.value === oldName,
    ),
  );
  if (!exists) {
    return err({ kind: "fragment-not-found", fragmentName: oldName });
  }
  return ok(undefined);
}

/**
 * Converts a ValidationError into a user-friendly error message string.
 *
 * @precondition `error` is a valid discriminated union variant.
 * @postcondition Returns a non-empty string prefixed with "Error: ".
 */
export function formatValidationError(error: ValidationError): string {
  switch (error.kind) {
    case "type-not-found":
      return `Error: Type '${error.typeName}' not found in schema.`;
    case "type-already-exists":
      return `Error: Type '${error.typeName}' already exists in schema.`;
    case "field-not-found":
      return `Error: Field '${error.fieldName}' not found on type '${error.typeName}'.`;
    case "field-already-exists":
      return `Error: Field '${error.fieldName}' already exists on type '${error.typeName}'.`;
    case "fragment-not-found":
      return `Error: Fragment '${error.fragmentName}' not found in documents.`;
    case "invalid-field-format":
      return `Error: Invalid field format '${error.input}'. Expected 'Type.field'.`;
    case "type-name-mismatch":
      return `Error: Type name must match between old and new field.`;
    case "config-not-found":
      return `Error: graphql-config file not found. Specify with --config or create one.`;
    case "schema-parse-error":
      return `Error: Schema parse error in ${error.filePath}: ${error.message}`;
  }
}
