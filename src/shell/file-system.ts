/**
 * File system operations for loading and writing GraphQL files.
 *
 * This module handles all file IO: globbing, reading, parsing, and writing.
 * Parse warnings are collected as data (not logged) so the caller can decide
 * how to surface them.
 *
 * @module
 */
import { parse, buildSchema } from "graphql";
import type { GraphQLSchema } from "graphql";
import { Project, SyntaxKind } from "ts-morph";
import { Glob as BunGlob } from "bun";
import fs from "fs";
import path from "path";
import type {
  SchemaFileContent,
  EmbeddedQueryContent,
  LoadQueriesResult,
  FileUpdate,
  ValidationError,
} from "../types/domain";
import { toFilePath } from "../types/domain";
import { ok, err, type Result } from "../types/result";

/**
 * Expands glob patterns relative to rootDir and returns deduplicated, sorted absolute paths.
 *
 * @precondition `rootDir` is an absolute path to an existing directory.
 * @postcondition Returned paths are absolute and unique.
 */
export async function globFiles(patterns: readonly string[], rootDir: string): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of patterns) {
    const bunGlob = new BunGlob(pattern);
    for await (const file of bunGlob.scan({ cwd: rootDir, absolute: true })) {
      files.push(file);
    }
  }

  return [...new Set(files)].sort();
}

/**
 * Loads and parses all GraphQL schema files matching the given patterns.
 *
 * @precondition `rootDir` is an absolute path to the project root.
 * @postcondition On success, each file has been read and its content parsed into a DocumentNode.
 *                On parse failure, returns a `schema-parse-error` with the offending file path.
 *
 * @returns A Result with the parsed schema files, or a parse error.
 */
export async function loadSchemaFiles(
  patterns: readonly string[],
  rootDir: string,
): Promise<Result<SchemaFileContent[], ValidationError>> {
  const files = await globFiles(patterns, rootDir);
  const schemaFiles: SchemaFileContent[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    try {
      const document = parse(content);
      schemaFiles.push({
        filePath: toFilePath(filePath),
        content,
        document,
      });
    } catch (error: unknown) {
      return err({
        kind: "schema-parse-error",
        filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return ok(schemaFiles);
}

/**
 * Builds a single GraphQLSchema from multiple schema file contents.
 *
 * @precondition `schemaFiles` contains valid, non-conflicting schema definitions.
 * @postcondition The returned schema contains all types from all files.
 */
export function buildSchemaFromFiles(schemaFiles: readonly SchemaFileContent[]): GraphQLSchema {
  const combined = schemaFiles.map((file) => file.content).join("\n");
  return buildSchema(combined);
}

/**
 * Checks whether a GraphQL definition is an executable definition (operation or fragment).
 *
 * @postcondition Returns `true` for OperationDefinition and FragmentDefinition nodes.
 */
function isExecutableDefinition(definition: { readonly kind: string }): boolean {
  return definition.kind === "OperationDefinition" || definition.kind === "FragmentDefinition";
}

/**
 * Checks whether a tag name is a recognized GraphQL tag (`graphql` or `gql`).
 *
 * @postcondition Returns `true` if the tag name is `"graphql"` or `"gql"`.
 */
function isGraphqlTagName(tagName: string): tagName is "graphql" | "gql" {
  return tagName === "graphql" || tagName === "gql";
}

/**
 * Checks whether a file path has a GraphQL extension (`.graphql` or `.gql`).
 *
 * @postcondition Returns `true` if the path ends with `.graphql` or `.gql`.
 */
function isGraphqlFile(filePath: string): boolean {
  return filePath.endsWith(".graphql") || filePath.endsWith(".gql");
}

/**
 * Checks whether a file path has a JavaScript or TypeScript extension (`.ts`, `.tsx`, `.js`, `.jsx`).
 *
 * @postcondition Returns `true` if the path ends with `.ts`, `.tsx`, `.js`, or `.jsx`.
 */
function isJavaScriptOrTypeScriptFile(filePath: string): boolean {
  return (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx")
  );
}

/**
 * Partitions file paths into GraphQL files and TypeScript files.
 *
 * Files that match neither extension are excluded.
 *
 * @postcondition Every returned path belongs to exactly one of the two arrays.
 */
function partitionFiles(files: readonly string[]): {
  readonly graphqlFiles: readonly string[];
  readonly tsFiles: readonly string[];
} {
  return {
    graphqlFiles: files.filter(isGraphqlFile),
    tsFiles: files.filter(isJavaScriptOrTypeScriptFile),
  };
}

/**
 * Parses a standalone `.graphql`/`.gql` file into an EmbeddedQueryContent.
 *
 * Returns `null` if the file contains only schema definitions (no operations or fragments),
 * or if parsing fails (in which case a warning string is returned).
 *
 * @precondition `filePath` is an absolute path to a readable `.graphql`/`.gql` file.
 * @postcondition On success, the returned query has `tagName === "file"` and `startOffset === 0`.
 */
function parseGraphqlFile(filePath: string): {
  readonly query: EmbeddedQueryContent | null;
  readonly warning: string | null;
} {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  try {
    const document = parse(fileContent);
    const hasExecutableDefinitions = document.definitions.some(isExecutableDefinition);
    if (!hasExecutableDefinitions) return { query: null, warning: null };
    return {
      query: {
        filePath: toFilePath(filePath),
        fileContent,
        queryContent: fileContent,
        document,
        startOffset: 0,
        endOffset: fileContent.length,
        line: 1,
        tagName: "file",
      },
      warning: null,
    };
  } catch {
    return { query: null, warning: `⚠️  Warning: Could not parse GraphQL document ${filePath}` };
  }
}

/** A tagged template with a confirmed `graphql` or `gql` tag name. */
interface GraphqlTaggedTemplate {
  readonly tagged: import("ts-morph").TaggedTemplateExpression;
  readonly tagName: "graphql" | "gql";
}

/**
 * Filters tagged template expressions to only those with `graphql` or `gql` tags.
 *
 * @postcondition Every returned entry has `tagName` of `"graphql"` or `"gql"`.
 */
function filterGraphqlTags(
  taggedTemplates: readonly import("ts-morph").TaggedTemplateExpression[],
): readonly GraphqlTaggedTemplate[] {
  return taggedTemplates.flatMap((tagged) => {
    const rawTagText = tagged.getTag().getText();
    if (!isGraphqlTagName(rawTagText)) return [];
    return [{ tagged, tagName: rawTagText }];
  });
}

/** The raw text and position info extracted from a tagged template literal. */
interface ExtractedTemplate {
  readonly queryText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly line: number;
  readonly tagName: "graphql" | "gql";
}

/**
 * Extracts the template literal text and position from a GraphQL tagged template.
 *
 * @precondition `entry.tagName` is `"graphql"` or `"gql"`.
 * @postcondition Returns the raw query text with position info, or `null` if the template
 *                has interpolations (TemplateExpression).
 */
function extractTemplateText(entry: GraphqlTaggedTemplate): ExtractedTemplate | null {
  const template = entry.tagged.getTemplate();
  if (!template.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) return null;
  return {
    queryText: template.getLiteralValue(),
    startOffset: template.getStart() + 1,
    endOffset: template.getEnd() - 1,
    line: template.getStartLineNumber(),
    tagName: entry.tagName,
  };
}

/** Result of attempting to parse a single tagged template expression. */
type TaggedTemplateResult =
  | { readonly kind: "query"; readonly query: EmbeddedQueryContent }
  | { readonly kind: "warning"; readonly warning: string };

/**
 * Builds a TaggedTemplateResult from an extracted template and a parsed document.
 *
 * @precondition `template` contains valid position info within `fileContent`.
 * @postcondition Returns `"query"` on successful parse, `"warning"` on parse failure.
 */
function buildTaggedTemplateResult(
  template: ExtractedTemplate,
  filePath: string,
  fileContent: string,
): TaggedTemplateResult {
  try {
    const document = parse(template.queryText);
    return {
      kind: "query",
      query: {
        filePath: toFilePath(filePath),
        fileContent,
        queryContent: template.queryText,
        document,
        startOffset: template.startOffset,
        endOffset: template.endOffset,
        line: template.line,
        tagName: template.tagName,
      },
    };
  } catch {
    return {
      kind: "warning",
      warning: `⚠️  Warning: Could not parse GraphQL in ${filePath}:${template.line}`,
    };
  }
}

/**
 * Extracts GraphQL queries from tagged template literals in a TypeScript file.
 *
 * Recognizes `graphql` and `gql` tags. Template expressions with interpolations
 * are skipped. Parse failures produce warnings instead of errors.
 *
 * @precondition `filePath` is an absolute path to a readable TS/TSX file.
 * @postcondition Each returned query has `tagName` of `"graphql"` or `"gql"`.
 */
function parseTaggedTemplatesInFile(
  filePath: string,
  project: Project,
): { readonly queries: readonly EmbeddedQueryContent[]; readonly warnings: readonly string[] } {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const sourceFile = project.createSourceFile(filePath, fileContent, { overwrite: true });
  const taggedTemplates = sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression);

  const results = filterGraphqlTags(taggedTemplates)
    .flatMap((entry) => {
      const template = extractTemplateText(entry);
      return template ? [template] : [];
    })
    .map((template) => buildTaggedTemplateResult(template, filePath, fileContent));

  return {
    queries: results.flatMap((r) => (r.kind === "query" ? [r.query] : [])),
    warnings: results.flatMap((r) => (r.kind === "warning" ? [r.warning] : [])),
  };
}

/**
 * Loads GraphQL queries/mutations/fragments from source files.
 *
 * Supports two source types:
 * - Standalone `.graphql`/`.gql` files containing operations or fragments
 * - TS/TSX files with `graphql` or `gql` tagged template literals
 *
 * Parse errors are non-fatal: they are collected in `warnings` rather than
 * failing the entire load.
 *
 * @precondition `rootDir` is an absolute path to the project root.
 * @postcondition `queries` contains all successfully parsed queries.
 *                `warnings` contains human-readable messages for files that failed to parse.
 *                Schema-only `.graphql` files (no operations or fragments) are excluded.
 */
export async function loadEmbeddedQueries(
  patterns: readonly string[],
  rootDir: string,
): Promise<LoadQueriesResult> {
  const files = await globFiles(patterns, rootDir);
  const { graphqlFiles, tsFiles } = partitionFiles(files);

  const graphqlResults = graphqlFiles.map(parseGraphqlFile);
  const graphqlQueries = graphqlResults.flatMap((r) => (r.query ? [r.query] : []));
  const graphqlWarnings = graphqlResults.flatMap((r) => (r.warning ? [r.warning] : []));

  if (tsFiles.length === 0) {
    return { queries: graphqlQueries, warnings: graphqlWarnings };
  }

  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });

  const tsResults = tsFiles.map((filePath) => parseTaggedTemplatesInFile(filePath, project));
  const tsQueries = tsResults.flatMap((r) => r.queries);
  const tsWarnings = tsResults.flatMap((r) => r.warnings);

  return {
    queries: [...graphqlQueries, ...tsQueries],
    warnings: [...graphqlWarnings, ...tsWarnings],
  };
}

/**
 * Writes file updates to disk, creating parent directories as needed.
 *
 * @precondition Each `fileUpdate.filePath` is an absolute path.
 * @postcondition Each file is overwritten with its new content. Parent directories are created
 *                if they don't exist.
 */
export function writeFileUpdates(fileUpdates: readonly FileUpdate[]): void {
  for (const fileUpdate of fileUpdates) {
    fs.mkdirSync(path.dirname(fileUpdate.filePath), { recursive: true });
    fs.writeFileSync(fileUpdate.filePath, fileUpdate.content, "utf-8");
  }
}
