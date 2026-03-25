/**
 * Pure rename pipeline — the main entry point for computing a RenamePlan.
 *
 * Dispatches on the RenameCommand discriminated union, validates inputs,
 * computes schema and document renames, and merges results into a single plan.
 * Contains no IO — all data is passed in via RenameContext.
 *
 * @module
 */
import type { Result } from "../types/result";
import { ok } from "../types/result";
import type {
  RenameCommand,
  RenameContext,
  RenamePlan,
  ValidationError,
  InterfaceDecision,
  TypeName,
} from "../types/domain";
import { validateRenameType, validateRenameField, validateRenameFragment } from "./validate";
import { renameTypeInSchema, renameFieldInSchema } from "./rename-schema";
import {
  renameTypeInDocuments,
  renameFieldInDocuments,
  renameFragmentInDocuments,
} from "./rename-document";

/**
 * Computes a complete rename plan from a command, context, and optional interface decision.
 *
 * This is the single entry point for all rename computations.
 *
 * @precondition `context.schema` is consistent with `context.schemaFiles`.
 * @precondition If `command.kind === "rename-field"` and an interface impact exists,
 *               `interfaceDecision` should be provided with kind `"cascade"`.
 * @postcondition On success, the returned plan contains all changes across schema and documents,
 *                and `fileUpdates` has the final content for every affected file.
 *
 * @param command            - The rename operation to perform.
 * @param context            - All loaded schema and document data.
 * @param interfaceDecision  - How to handle interface cascade (only for rename-field).
 * @returns A Result containing the computed plan or a validation error.
 */
export function computeRenamePlan(
  command: RenameCommand,
  context: RenameContext,
  interfaceDecision?: InterfaceDecision,
): Result<RenamePlan, ValidationError> {
  switch (command.kind) {
    case "rename-type":
      return computeRenameTypePlan(command, context);
    case "rename-field":
      return computeRenameFieldPlan(command, context, interfaceDecision);
    case "rename-fragment":
      return computeRenameFragmentPlan(command, context);
  }
}

/**
 * Computes a rename plan for a type rename.
 *
 * @postcondition On success, all occurrences of `oldName` in schema definitions,
 *                named type references, fragment type conditions, and inline fragments
 *                are replaced with `newName`.
 */
function computeRenameTypePlan(
  command: Extract<RenameCommand, { kind: "rename-type" }>,
  context: RenameContext,
): Result<RenamePlan, ValidationError> {
  const validationResult = validateRenameType(context.schema, command.oldName, command.newName);
  if (!validationResult.ok) return validationResult;

  const schemaResult = renameTypeInSchema(context.schemaFiles, command.oldName, command.newName);
  const documentResult = renameTypeInDocuments(
    context.queries,
    context.schema,
    command.oldName,
    command.newName,
  );

  return ok(
    mergeRenamePlans(
      { changes: schemaResult.changes, fileUpdates: schemaResult.fileUpdates, warnings: [] },
      { changes: documentResult.changes, fileUpdates: documentResult.fileUpdates, warnings: [] },
    ),
  );
}

/**
 * Computes a rename plan for a field rename, optionally including cascade types.
 *
 * @postcondition On success, the field is renamed on the primary type and all additional
 *                types (from interface cascade), in both schema and document files.
 */
function computeRenameFieldPlan(
  command: Extract<RenameCommand, { kind: "rename-field" }>,
  context: RenameContext,
  interfaceDecision?: InterfaceDecision,
): Result<RenamePlan, ValidationError> {
  const validationResult = validateRenameField(
    context.schema,
    command.typeName,
    command.oldFieldName,
    command.newFieldName,
  );
  if (!validationResult.ok) return validationResult;

  const additionalTypes: TypeName[] =
    interfaceDecision?.kind === "cascade" ? [...interfaceDecision.additionalTypes] : [];

  const schemaResult = renameFieldInSchema(
    context.schemaFiles,
    command.typeName,
    command.oldFieldName,
    command.newFieldName,
    additionalTypes,
  );
  const documentResult = renameFieldInDocuments(
    context.queries,
    context.schema,
    command.typeName,
    command.oldFieldName,
    command.newFieldName,
    additionalTypes,
  );

  return ok(
    mergeRenamePlans(
      { changes: schemaResult.changes, fileUpdates: schemaResult.fileUpdates, warnings: [] },
      { changes: documentResult.changes, fileUpdates: documentResult.fileUpdates, warnings: [] },
    ),
  );
}

/**
 * Computes a rename plan for a fragment rename.
 *
 * @postcondition On success, all FragmentDefinition and FragmentSpread nodes
 *                matching `oldName` are renamed to `newName`.
 */
function computeRenameFragmentPlan(
  command: Extract<RenameCommand, { kind: "rename-fragment" }>,
  context: RenameContext,
): Result<RenamePlan, ValidationError> {
  const validationResult = validateRenameFragment(context.queries, command.oldName);
  if (!validationResult.ok) return validationResult;

  const documentResult = renameFragmentInDocuments(
    context.queries,
    command.oldName,
    command.newName,
  );

  return ok({
    changes: documentResult.changes,
    fileUpdates: documentResult.fileUpdates,
    warnings: [],
  });
}

/**
 * Merges multiple RenamePlans into a single plan by concatenating all fields.
 *
 * @postcondition The returned plan contains all changes, fileUpdates, and warnings
 *                from all input plans, in order.
 */
function mergeRenamePlans(...plans: readonly RenamePlan[]): RenamePlan {
  return {
    changes: plans.flatMap((plan) => plan.changes),
    fileUpdates: plans.flatMap((plan) => plan.fileUpdates),
    warnings: plans.flatMap((plan) => plan.warnings),
  };
}
