/**
 * Pure functions for renaming entities in GraphQL schema files.
 *
 * Uses AST `loc` offsets for text-level replacement to preserve original
 * formatting (comments, descriptions, whitespace, trailing newlines).
 * Never uses `graphql-js`'s `print()`.
 *
 * @module
 */
import { visit, Kind } from "graphql";
import type { ASTNode, NameNode } from "graphql";
import type {
  SchemaFileContent,
  SchemaChange,
  TextReplacement,
  FileUpdate,
  TypeName,
  FieldName,
} from "../types/domain";
import { applyReplacements } from "./text-replace";

/** Collected changes and text replacements for a single schema file. */
interface SchemaRenameResult {
  readonly changes: readonly SchemaChange[];
  readonly fileUpdates: readonly FileUpdate[];
}

/** Intermediate result from visiting a single file's AST. */
interface CollectedReplacements {
  readonly changes: SchemaChange[];
  readonly replacements: TextReplacement[];
}

/** A schema file paired with its collected changes and replacements. */
interface FileCollectedReplacements {
  readonly file: SchemaFileContent;
  readonly changes: readonly SchemaChange[];
  readonly replacements: readonly TextReplacement[];
}

/**
 * Builds a FileUpdate from a schema file and its collected replacements.
 *
 * @precondition `replacements` are valid offsets within `file.content`.
 * @postcondition Returns a FileUpdate with all replacements applied, or `null` if there are none.
 */
function buildSchemaFileUpdate(
  file: SchemaFileContent,
  replacements: readonly TextReplacement[],
): FileUpdate | null {
  if (replacements.length === 0) return null;
  return {
    filePath: file.filePath,
    content: applyReplacements(file.content, replacements),
  };
}

/**
 * Higher-order function that applies a replacement collector to each schema file.
 *
 * @precondition `schemaFiles` are parsed (each has a valid `document`).
 * @postcondition `fileUpdates` only contains entries for files that actually changed.
 *
 * @param schemaFiles          - All loaded schema files.
 * @param collectReplacements  - A function that extracts changes from a single file's AST.
 */
function renameInSchemaFiles(
  schemaFiles: readonly SchemaFileContent[],
  collectReplacements: (file: SchemaFileContent) => CollectedReplacements,
): SchemaRenameResult {
  const collected: readonly FileCollectedReplacements[] = schemaFiles.map((file) => ({
    file,
    ...collectReplacements(file),
  }));

  return {
    changes: collected.flatMap((c) => c.changes),
    fileUpdates: collected.flatMap((c) => {
      const update = buildSchemaFileUpdate(c.file, c.replacements);
      return update ? [update] : [];
    }),
  };
}

/** All GraphQL AST node kinds that define or extend a named type. */
const TYPE_DEFINITION_KINDS: ReadonlySet<string> = new Set([
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.SCALAR_TYPE_DEFINITION,
  Kind.OBJECT_TYPE_EXTENSION,
  Kind.INPUT_OBJECT_TYPE_EXTENSION,
  Kind.INTERFACE_TYPE_EXTENSION,
  Kind.UNION_TYPE_EXTENSION,
  Kind.ENUM_TYPE_EXTENSION,
  Kind.SCALAR_TYPE_EXTENSION,
]);

/**
 * Safely extracts the NameNode from an AST node, if present.
 * Used to avoid `as any` casts on heterogeneous definition nodes.
 */
function getNameNode(node: ASTNode): NameNode | undefined {
  if ("name" in node) {
    const candidate = (node as ASTNode & { name?: NameNode }).name;
    if (candidate && typeof candidate === "object" && "value" in candidate) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Renames all occurrences of a type in schema files.
 *
 * Handles both:
 * - Type definitions/extensions (e.g. `type User`, `extend type User`)
 * - Named type references (e.g. field types, union members)
 *
 * @precondition `oldName` exists in at least one schema file.
 * @postcondition Every occurrence of `oldName` (definitions and references) is replaced with `newName`.
 *                Original formatting is preserved.
 */
export function renameTypeInSchema(
  schemaFiles: readonly SchemaFileContent[],
  oldName: TypeName,
  newName: TypeName,
): SchemaRenameResult {
  return renameInSchemaFiles(schemaFiles, (file) => {
    const changes: SchemaChange[] = [];
    const replacements: TextReplacement[] = [];

    visit(file.document, {
      [Kind.NAMED_TYPE](node) {
        if (node.name.value === oldName && node.name.loc) {
          changes.push({
            category: "schema",
            filePath: file.filePath,
            line: node.loc?.startToken.line ?? 0,
            oldText: oldName,
            newText: newName,
          });
          replacements.push({
            start: node.name.loc.start,
            end: node.name.loc.end,
            newText: newName,
          });
        }
      },
      enter(node) {
        if (!TYPE_DEFINITION_KINDS.has(node.kind)) return;

        const nameNode = getNameNode(node);
        if (!nameNode || nameNode.value !== oldName || !nameNode.loc) return;

        changes.push({
          category: "schema",
          filePath: file.filePath,
          line: node.loc?.startToken.line ?? 0,
          oldText: oldName,
          newText: newName,
        });
        replacements.push({
          start: nameNode.loc.start,
          end: nameNode.loc.end,
          newText: newName,
        });
      },
    });

    return { changes, replacements };
  });
}

/**
 * Renames all occurrences of a field in schema files.
 *
 * Only renames within the specified target types (primary type + additional cascade types).
 * Handles FieldDefinition and InputValueDefinition nodes.
 *
 * @precondition `typeName` exists in the schema and has `oldFieldName`.
 * @postcondition Every `oldFieldName` within target types is replaced with `newFieldName`.
 *                Fields on non-target types are untouched.
 *
 * @param schemaFiles     - All loaded schema files.
 * @param typeName        - The primary type containing the field.
 * @param oldFieldName    - The current field name.
 * @param newFieldName    - The desired new field name.
 * @param additionalTypes - Extra types to rename (from interface cascade).
 */
export function renameFieldInSchema(
  schemaFiles: readonly SchemaFileContent[],
  typeName: TypeName,
  oldFieldName: FieldName,
  newFieldName: FieldName,
  additionalTypes: readonly TypeName[] = [],
): SchemaRenameResult {
  const targetTypes = new Set<string>([typeName, ...additionalTypes]);

  return renameInSchemaFiles(schemaFiles, (file) => {
    const changes: SchemaChange[] = [];
    const replacements: TextReplacement[] = [];

    visit(file.document, {
      [Kind.OBJECT_TYPE_DEFINITION]: {
        enter(node) {
          if (!targetTypes.has(node.name.value)) return false;
          return undefined;
        },
      },
      [Kind.OBJECT_TYPE_EXTENSION]: {
        enter(node) {
          if (!targetTypes.has(node.name.value)) return false;
          return undefined;
        },
      },
      [Kind.INTERFACE_TYPE_DEFINITION]: {
        enter(node) {
          if (!targetTypes.has(node.name.value)) return false;
          return undefined;
        },
      },
      [Kind.INTERFACE_TYPE_EXTENSION]: {
        enter(node) {
          if (!targetTypes.has(node.name.value)) return false;
          return undefined;
        },
      },
      [Kind.INPUT_OBJECT_TYPE_DEFINITION]: {
        enter(node) {
          if (!targetTypes.has(node.name.value)) return false;
          return undefined;
        },
      },
      [Kind.INPUT_OBJECT_TYPE_EXTENSION]: {
        enter(node) {
          if (!targetTypes.has(node.name.value)) return false;
          return undefined;
        },
      },
      [Kind.FIELD_DEFINITION](node) {
        if (node.name.value === oldFieldName && node.name.loc) {
          changes.push({
            category: "schema",
            filePath: file.filePath,
            line: node.loc?.startToken.line ?? 0,
            oldText: oldFieldName,
            newText: newFieldName,
          });
          replacements.push({
            start: node.name.loc.start,
            end: node.name.loc.end,
            newText: newFieldName,
          });
        }
      },
      [Kind.INPUT_VALUE_DEFINITION](node) {
        if (node.name.value === oldFieldName && node.name.loc) {
          changes.push({
            category: "schema",
            filePath: file.filePath,
            line: node.loc?.startToken.line ?? 0,
            oldText: oldFieldName,
            newText: newFieldName,
          });
          replacements.push({
            start: node.name.loc.start,
            end: node.name.loc.end,
            newText: newFieldName,
          });
        }
      },
    });

    return { changes, replacements };
  });
}
