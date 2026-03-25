/**
 * Pure functions for renaming entities in GraphQL document files (queries, mutations, fragments).
 *
 * Handles both standalone `.graphql` files and embedded `graphql`/`gql` tagged templates
 * in TS/TSX files. Uses AST `loc` offsets for text-level replacement; for embedded queries,
 * offsets are translated from query-local to file-absolute using `startOffset`.
 *
 * @module
 */
import { visit, TypeInfo, visitWithTypeInfo, Kind } from "graphql";
import type { GraphQLSchema } from "graphql";
import type {
  EmbeddedQueryContent,
  DocumentChange,
  TextReplacement,
  FileUpdate,
  TypeName,
  FieldName,
  FragmentName,
  FilePath,
} from "../types/domain";
import { applyReplacements } from "./text-replace";

/** Result of renaming in documents: changes for display and file updates for writing. */
interface DocumentRenameResult {
  readonly changes: readonly DocumentChange[];
  readonly fileUpdates: readonly FileUpdate[];
}

/** A query paired with the text replacements to apply to it. */
interface QueryReplacements {
  readonly query: EmbeddedQueryContent;
  readonly replacements: readonly TextReplacement[];
}

/**
 * Builds final file updates from grouped query replacements.
 *
 * For embedded queries (`tagName !== "file"`), translates query-local offsets to
 * file-absolute offsets by adding `startOffset`. For standalone `.graphql` files
 * (`tagName === "file"`), offsets are already absolute.
 *
 * @precondition Each file in the map has at least one entry.
 * @postcondition Each returned FileUpdate contains the full file content with all
 *                replacements applied.
 */
function buildFileUpdates(
  queryReplacementsByFile: Map<FilePath, readonly QueryReplacements[]>,
): readonly FileUpdate[] {
  const fileUpdates: FileUpdate[] = [];

  for (const [filePath, queryReplacementsList] of queryReplacementsByFile) {
    const allReplacements: TextReplacement[] = [];

    for (const { query, replacements } of queryReplacementsList) {
      for (const replacement of replacements) {
        if (query.tagName === "file") {
          allReplacements.push(replacement);
        } else {
          allReplacements.push({
            start: query.startOffset + replacement.start,
            end: query.startOffset + replacement.end,
            newText: replacement.newText,
          });
        }
      }
    }

    const firstEntry = queryReplacementsList[0];
    if (!firstEntry) continue;
    const fileContent = firstEntry.query.fileContent;
    fileUpdates.push({
      filePath,
      content: applyReplacements(fileContent, allReplacements),
    });
  }

  return fileUpdates;
}

/**
 * Higher-order function that groups queries by file path, collects replacements, and builds updates.
 *
 * @precondition `queries` contains parsed documents.
 * @postcondition Only files with actual replacements appear in `fileUpdates`.
 *
 * @param queries              - All loaded document queries.
 * @param collectReplacements  - Extracts changes and replacements from a single query.
 */
function groupByFile(
  queries: readonly EmbeddedQueryContent[],
  collectReplacements: (query: EmbeddedQueryContent) => {
    changes: DocumentChange[];
    replacements: TextReplacement[];
  },
): DocumentRenameResult {
  const allChanges: DocumentChange[] = [];
  const queryReplacementsByFile = new Map<FilePath, QueryReplacements[]>();

  for (const query of queries) {
    const { changes, replacements } = collectReplacements(query);
    if (replacements.length === 0) continue;

    allChanges.push(...changes);

    const existing = queryReplacementsByFile.get(query.filePath);
    if (existing) {
      existing.push({ query, replacements });
    } else {
      queryReplacementsByFile.set(query.filePath, [{ query, replacements }]);
    }
  }

  return {
    changes: allChanges,
    fileUpdates: buildFileUpdates(queryReplacementsByFile),
  };
}

/**
 * Renames all occurrences of a type in document files.
 *
 * Handles NamedType references, FragmentDefinition type conditions, and InlineFragment
 * type conditions. Uses TypeInfo for type-aware traversal.
 *
 * @precondition `oldName` exists in the schema.
 * @postcondition Every occurrence of `oldName` in queries/fragments is replaced with `newName`.
 */
export function renameTypeInDocuments(
  queries: readonly EmbeddedQueryContent[],
  schema: GraphQLSchema,
  oldName: TypeName,
  newName: TypeName,
): DocumentRenameResult {
  return groupByFile(queries, (query) => {
    const typeInfo = new TypeInfo(schema);
    const changes: DocumentChange[] = [];
    const replacements: TextReplacement[] = [];

    visit(
      query.document,
      visitWithTypeInfo(typeInfo, {
        [Kind.NAMED_TYPE](node) {
          if (node.name.value === oldName && node.name.loc) {
            changes.push({
              category: "document",
              filePath: query.filePath,
              line: query.line,
              oldText: oldName,
              newText: newName,
              tagName: query.tagName,
            });
            replacements.push({
              start: node.name.loc.start,
              end: node.name.loc.end,
              newText: newName,
            });
          }
        },
        [Kind.FRAGMENT_DEFINITION](node) {
          if (node.typeCondition.name.value === oldName && node.typeCondition.name.loc) {
            changes.push({
              category: "document",
              filePath: query.filePath,
              line: query.line,
              oldText: oldName,
              newText: newName,
              tagName: query.tagName,
            });
            replacements.push({
              start: node.typeCondition.name.loc.start,
              end: node.typeCondition.name.loc.end,
              newText: newName,
            });
          }
        },
        [Kind.INLINE_FRAGMENT](node) {
          if (node.typeCondition?.name.value === oldName && node.typeCondition.name.loc) {
            changes.push({
              category: "document",
              filePath: query.filePath,
              line: query.line,
              oldText: oldName,
              newText: newName,
              tagName: query.tagName,
            });
            replacements.push({
              start: node.typeCondition.name.loc.start,
              end: node.typeCondition.name.loc.end,
              newText: newName,
            });
          }
        },
      }),
    );

    return { changes, replacements };
  });
}

/**
 * Renames all occurrences of a field in document files.
 *
 * Only renames fields whose parent type matches one of the target types.
 * Uses TypeInfo to resolve the parent type at each field node.
 *
 * @precondition `typeName` has `oldFieldName` in the schema.
 * @postcondition Every field selection of `oldFieldName` on target types is renamed.
 *                Fields on non-target types are untouched.
 *
 * @param queries         - All loaded document queries.
 * @param schema          - The built GraphQL schema.
 * @param typeName        - The primary type containing the field.
 * @param oldFieldName    - The current field name.
 * @param newFieldName    - The desired new field name.
 * @param additionalTypes - Extra types to rename (from interface cascade).
 */
export function renameFieldInDocuments(
  queries: readonly EmbeddedQueryContent[],
  schema: GraphQLSchema,
  typeName: TypeName,
  oldFieldName: FieldName,
  newFieldName: FieldName,
  additionalTypes: readonly TypeName[] = [],
): DocumentRenameResult {
  const targetTypes = new Set<string>([typeName, ...additionalTypes]);

  return groupByFile(queries, (query) => {
    const typeInfo = new TypeInfo(schema);
    const changes: DocumentChange[] = [];
    const replacements: TextReplacement[] = [];

    visit(
      query.document,
      visitWithTypeInfo(typeInfo, {
        [Kind.FIELD](node) {
          const parentType = typeInfo.getParentType();
          if (
            parentType &&
            targetTypes.has(parentType.name) &&
            node.name.value === oldFieldName &&
            node.name.loc
          ) {
            changes.push({
              category: "document",
              filePath: query.filePath,
              line: query.line,
              oldText: oldFieldName,
              newText: newFieldName,
              tagName: query.tagName,
            });
            replacements.push({
              start: node.name.loc.start,
              end: node.name.loc.end,
              newText: newFieldName,
            });
          }
        },
      }),
    );

    return { changes, replacements };
  });
}

/**
 * Renames all occurrences of a fragment in document files.
 *
 * Handles both FragmentDefinition (the declaration) and FragmentSpread (the usage).
 *
 * @precondition At least one FragmentDefinition with `oldName` exists.
 * @postcondition Every FragmentDefinition and FragmentSpread matching `oldName`
 *                is renamed to `newName`.
 */
export function renameFragmentInDocuments(
  queries: readonly EmbeddedQueryContent[],
  oldName: FragmentName,
  newName: FragmentName,
): DocumentRenameResult {
  return groupByFile(queries, (query) => {
    const changes: DocumentChange[] = [];
    const replacements: TextReplacement[] = [];

    visit(query.document, {
      [Kind.FRAGMENT_DEFINITION](node) {
        if (node.name.value === oldName && node.name.loc) {
          changes.push({
            category: "document",
            filePath: query.filePath,
            line: query.line,
            oldText: oldName,
            newText: newName,
            tagName: query.tagName,
          });
          replacements.push({
            start: node.name.loc.start,
            end: node.name.loc.end,
            newText: newName,
          });
        }
      },
      [Kind.FRAGMENT_SPREAD](node) {
        if (node.name.value === oldName && node.name.loc) {
          changes.push({
            category: "document",
            filePath: query.filePath,
            line: query.line,
            oldText: oldName,
            newText: newName,
            tagName: query.tagName,
          });
          replacements.push({
            start: node.name.loc.start,
            end: node.name.loc.end,
            newText: newName,
          });
        }
      },
    });

    return { changes, replacements };
  });
}
