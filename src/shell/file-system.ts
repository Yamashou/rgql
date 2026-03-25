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
  const queries: EmbeddedQueryContent[] = [];
  const warnings: string[] = [];

  const graphqlFiles: string[] = [];
  const tsFiles: string[] = [];

  for (const filePath of files) {
    if (filePath.endsWith(".graphql") || filePath.endsWith(".gql")) {
      graphqlFiles.push(filePath);
    } else {
      tsFiles.push(filePath);
    }
  }

  for (const filePath of graphqlFiles) {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    try {
      const document = parse(fileContent);
      const hasOperationsOrFragments = document.definitions.some(
        (definition) =>
          definition.kind === "OperationDefinition" || definition.kind === "FragmentDefinition",
      );
      if (hasOperationsOrFragments) {
        queries.push({
          filePath: toFilePath(filePath),
          fileContent,
          queryContent: fileContent,
          document,
          startOffset: 0,
          endOffset: fileContent.length,
          line: 1,
          tagName: "file",
        });
      }
    } catch {
      warnings.push(`⚠️  Warning: Could not parse GraphQL document ${filePath}`);
    }
  }

  if (tsFiles.length > 0) {
    const project = new Project({
      compilerOptions: { allowJs: true },
      skipAddingFilesFromTsConfig: true,
    });

    for (const filePath of tsFiles) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const sourceFile = project.createSourceFile(filePath, fileContent, {
        overwrite: true,
      });

      const taggedTemplates = sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression);

      for (const tagged of taggedTemplates) {
        const tag = tagged.getTag();
        const rawTagText = tag.getText();

        if (rawTagText !== "graphql" && rawTagText !== "gql") continue;
        const tagText: "graphql" | "gql" = rawTagText;

        const template = tagged.getTemplate();
        let queryText: string;

        if (template.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
          queryText = template.getLiteralValue();
        } else if (template.isKind(SyntaxKind.TemplateExpression)) {
          continue;
        } else {
          continue;
        }

        try {
          const document = parse(queryText);
          queries.push({
            filePath: toFilePath(filePath),
            fileContent,
            queryContent: queryText,
            document,
            startOffset: template.getStart() + 1,
            endOffset: template.getEnd() - 1,
            line: template.getStartLineNumber(),
            tagName: tagText,
          });
        } catch {
          warnings.push(
            `⚠️  Warning: Could not parse GraphQL in ${filePath}:${template.getStartLineNumber()}`,
          );
        }
      }
    }
  }

  return { queries, warnings };
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
