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
  RenameResult,
} from "../types/domain";
import { applyReplacements } from "./text-replace";

/** A query paired with the text replacements to apply to it. */
interface QueryReplacements {
  readonly query: EmbeddedQueryContent;
  readonly replacements: readonly TextReplacement[];
}

/**
 * Translates query-local replacement offsets to file-absolute offsets.
 *
 * For standalone `.graphql` files (`tagName === "file"`), offsets are already absolute
 * and returned unchanged. For embedded queries, `startOffset` is added to each replacement.
 *
 * @precondition Each replacement's offsets are valid within the query content.
 * @postcondition Returned replacements have file-absolute offsets.
 */
function toAbsoluteReplacements(
  query: EmbeddedQueryContent,
  replacements: readonly TextReplacement[],
): readonly TextReplacement[] {
  if (query.tagName === "file") return replacements;
  return replacements.map((replacement) => ({
    start: query.startOffset + replacement.start,
    end: query.startOffset + replacement.end,
    newText: replacement.newText,
  }));
}

/**
 * Builds a single FileUpdate by collecting and applying all replacements for a file.
 *
 * @precondition `queryReplacementsList` has at least one entry.
 * @postcondition Returns a FileUpdate with all replacements applied, or `null` if the list is empty.
 */
function buildFileUpdate(
  filePath: FilePath,
  queryReplacementsList: readonly QueryReplacements[],
): FileUpdate | null {
  const firstEntry = queryReplacementsList[0];
  if (!firstEntry) return null;

  const allReplacements = queryReplacementsList.flatMap(({ query, replacements }) =>
    toAbsoluteReplacements(query, replacements),
  );

  return {
    filePath,
    content: applyReplacements(firstEntry.query.fileContent, allReplacements),
  };
}

/**
 * Builds final file updates from grouped query replacements.
 *
 * @precondition Each file in the map has at least one entry.
 * @postcondition Each returned FileUpdate contains the full file content with all
 *                replacements applied.
 */
function buildFileUpdates(
  queryReplacementsByFile: Map<FilePath, readonly QueryReplacements[]>,
): readonly FileUpdate[] {
  return [...queryReplacementsByFile.entries()].flatMap(([filePath, queryReplacementsList]) => {
    const update = buildFileUpdate(filePath, queryReplacementsList);
    return update ? [update] : [];
  });
}

/** A query paired with its collected changes and replacements. */
interface QueryCollectedResult {
  readonly query: EmbeddedQueryContent;
  readonly changes: readonly DocumentChange[];
  readonly replacements: readonly TextReplacement[];
}

/**
 * Groups query results by file path into a Map of QueryReplacements.
 *
 * @precondition Each entry has non-empty `replacements`.
 * @postcondition Each key in the returned map has at least one QueryReplacements entry.
 */
function groupResultsByFile(
  results: readonly QueryCollectedResult[],
): Map<FilePath, QueryReplacements[]> {
  const groups = new Map<FilePath, QueryReplacements[]>();
  for (const { query, replacements } of results) {
    const existing = groups.get(query.filePath);
    const entry: QueryReplacements = { query, replacements };
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(query.filePath, [entry]);
    }
  }
  return groups;
}

/**
 * Higher-order function that collects replacements from each query, groups by file, and builds updates.
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
): RenameResult {
  const collected: readonly QueryCollectedResult[] = queries.map((query) => ({
    query,
    ...collectReplacements(query),
  }));

  const withReplacements = collected.filter((c) => c.replacements.length > 0);

  return {
    changes: withReplacements.flatMap((c) => c.changes),
    fileUpdates: buildFileUpdates(groupResultsByFile(withReplacements)),
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
): RenameResult {
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
): RenameResult {
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
): RenameResult {
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
