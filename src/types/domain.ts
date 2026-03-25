/**
 * Domain types for the rgql GraphQL refactoring tool.
 *
 * All types in this module are pure data — no behavior, no IO.
 * Discriminated unions use a `kind` field as the discriminant.
 * Branded types prevent accidental mixing of semantically distinct strings.
 *
 * @module
 */
import type { DocumentNode, GraphQLSchema } from "graphql";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

/**
 * A GraphQL type name (e.g. "User", "Post").
 * Branded to prevent mixing with arbitrary strings.
 */
export type TypeName = string & { readonly __brand: "TypeName" };

/**
 * A GraphQL field name (e.g. "firstName", "email").
 * Branded to prevent mixing with arbitrary strings.
 */
export type FieldName = string & { readonly __brand: "FieldName" };

/**
 * A GraphQL fragment name (e.g. "UserBasic", "PostDetail").
 * Branded to prevent mixing with arbitrary strings.
 */
export type FragmentName = string & { readonly __brand: "FragmentName" };

/**
 * An absolute file path.
 * Branded to distinguish from relative paths or arbitrary strings.
 */
export type FilePath = string & { readonly __brand: "FilePath" };

// ---------------------------------------------------------------------------
// Branded type constructors
// ---------------------------------------------------------------------------

/** Wraps a raw string into a {@link TypeName}. */
export const toTypeName = (value: string): TypeName => value as TypeName;

/** Wraps a raw string into a {@link FieldName}. */
export const toFieldName = (value: string): FieldName => value as FieldName;

/** Wraps a raw string into a {@link FragmentName}. */
export const toFragmentName = (value: string): FragmentName => value as FragmentName;

/** Wraps a raw string into a {@link FilePath}. */
export const toFilePath = (value: string): FilePath => value as FilePath;

// ---------------------------------------------------------------------------
// RenameCommand
// ---------------------------------------------------------------------------

/**
 * A user-issued rename command.
 *
 * Discriminated on `kind`:
 * - `"rename-type"`     — rename a GraphQL named type
 * - `"rename-field"`    — rename a field on a specific type
 * - `"rename-fragment"` — rename a fragment definition and all its spreads
 */
export type RenameCommand =
  | {
      readonly kind: "rename-type";
      readonly oldName: TypeName;
      readonly newName: TypeName;
    }
  | {
      readonly kind: "rename-field";
      readonly typeName: TypeName;
      readonly oldFieldName: FieldName;
      readonly newFieldName: FieldName;
    }
  | {
      readonly kind: "rename-fragment";
      readonly oldName: FragmentName;
      readonly newName: FragmentName;
    };

// ---------------------------------------------------------------------------
// Loaded file types (pure data)
// ---------------------------------------------------------------------------

/**
 * A GraphQL schema file that has been read and parsed.
 *
 * @invariant `document` is the parse result of `content`.
 * @invariant `filePath` is an absolute path.
 */
export interface SchemaFileContent {
  readonly filePath: FilePath;
  readonly content: string;
  readonly document: DocumentNode;
}

/**
 * A GraphQL query/mutation/fragment extracted from a source file.
 *
 * May originate from:
 * - A standalone `.graphql` file (`tagName === "file"`, offsets are absolute)
 * - A `graphql`/`gql` tagged template in `.ts/.tsx` (offsets are relative to the template)
 *
 * @invariant `document` is the parse result of `queryContent`.
 * @invariant For `tagName === "file"`, `startOffset === 0`.
 * @invariant `fileContent` is the full text of the host file (needed for text-level replacement).
 */
export interface EmbeddedQueryContent {
  readonly filePath: FilePath;
  readonly fileContent: string;
  readonly queryContent: string;
  readonly document: DocumentNode;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly line: number;
  readonly tagName: "graphql" | "gql" | "file";
}

// ---------------------------------------------------------------------------
// Change types
// ---------------------------------------------------------------------------

/** A single rename occurrence in a schema file. */
export interface SchemaChange {
  readonly category: "schema";
  readonly filePath: FilePath;
  readonly line: number;
  readonly oldText: string;
  readonly newText: string;
}

/**
 * A single rename occurrence in a document (query/mutation/fragment).
 * `tagName` identifies the source tag (`graphql`, `gql`, or `file`).
 */
export interface DocumentChange {
  readonly category: "document";
  readonly filePath: FilePath;
  readonly line: number;
  readonly oldText: string;
  readonly newText: string;
  readonly tagName: string;
}

/** A rename occurrence — either in a schema or a document. */
export type Change = SchemaChange | DocumentChange;

// ---------------------------------------------------------------------------
// Text replacement
// ---------------------------------------------------------------------------

/**
 * A text replacement to apply to a file's content.
 *
 * @invariant `start < end`.
 * @invariant `start` and `end` are byte offsets within the file content.
 */
export interface TextReplacement {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

// ---------------------------------------------------------------------------
// File update
// ---------------------------------------------------------------------------

/**
 * The new content for a file after applying all replacements.
 * Immutable replacement for `Map<string, string>`.
 */
export interface FileUpdate {
  readonly filePath: FilePath;
  readonly content: string;
}

// ---------------------------------------------------------------------------
// RenamePlan
// ---------------------------------------------------------------------------

/**
 * The complete plan produced by the pure rename pipeline.
 *
 * @invariant `fileUpdates` contains the final file content for every file that has changes.
 * @invariant `changes` is a flat list of all individual rename occurrences (for display).
 * @invariant `warnings` are non-fatal messages (e.g. unparseable files).
 */
export interface RenamePlan {
  readonly changes: readonly Change[];
  readonly fileUpdates: readonly FileUpdate[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

/**
 * All possible validation errors that can occur before or during rename computation.
 * Discriminated on `kind`. Exhaustive switch is enforced by the compiler.
 */
export type ValidationError =
  | { readonly kind: "type-not-found"; readonly typeName: string }
  | { readonly kind: "type-already-exists"; readonly typeName: string }
  | { readonly kind: "field-not-found"; readonly typeName: string; readonly fieldName: string }
  | { readonly kind: "field-already-exists"; readonly typeName: string; readonly fieldName: string }
  | { readonly kind: "fragment-not-found"; readonly fragmentName: string }
  | { readonly kind: "invalid-field-format"; readonly input: string }
  | { readonly kind: "type-name-mismatch"; readonly oldType: string; readonly newType: string }
  | { readonly kind: "config-not-found" }
  | { readonly kind: "schema-parse-error"; readonly filePath: string; readonly message: string };

// ---------------------------------------------------------------------------
// Interface impact
// ---------------------------------------------------------------------------

/**
 * Describes the impact of renaming a field that belongs to an interface.
 *
 * @invariant `implementingTypes` contains at least one entry.
 */
export interface InterfaceImpact {
  readonly interfaceName: string;
  readonly fieldName: string;
  readonly implementingTypes: readonly { readonly typeName: string }[];
}

/**
 * The user's decision on how to handle an interface-breaking field rename.
 *
 * - `"cascade"` — rename the field on all implementing types
 * - `"skip"`    — skip the rename entirely
 * - `"abort"`   — abort the entire operation
 */
export type InterfaceDecision =
  | { readonly kind: "cascade"; readonly additionalTypes: readonly TypeName[] }
  | { readonly kind: "skip" }
  | { readonly kind: "abort" };

// ---------------------------------------------------------------------------
// Prompt types
// ---------------------------------------------------------------------------

/** Parsed answer from a y/n/q interactive prompt. */
export type PromptAnswer = "yes" | "no" | "quit";

/**
 * The aggregate result of an interactive apply session.
 *
 * - `"all-accepted"` — user said yes to every change
 * - `"partial"`      — user accepted some, rejected others
 * - `"aborted"`      — user quit mid-way
 */
export type InteractiveResult =
  | { readonly kind: "all-accepted"; readonly count: number }
  | { readonly kind: "partial"; readonly accepted: number; readonly total: number }
  | { readonly kind: "aborted" };

// ---------------------------------------------------------------------------
// Rename outcome
// ---------------------------------------------------------------------------

/**
 * The outcome of executing a rename use case.
 * Describes what happened — carries all data needed for the IO edge to act.
 * Contains NO side effects.
 *
 * - `"error"`                — validation failed
 * - `"no-changes"`           — command matched nothing
 * - `"dry-run"`              — plan computed, not applied (default mode)
 * - `"written"`              — plan should be applied to disk
 * - `"interactive-complete"` — interactive session finished
 * - `"interface-skipped"`    — field rename skipped due to interface impact
 * - `"interface-aborted"`    — user aborted at interface prompt
 */
export type RenameOutcome =
  | { readonly kind: "error"; readonly error: ValidationError }
  | { readonly kind: "no-changes" }
  | {
      readonly kind: "dry-run";
      readonly plan: RenamePlan;
      readonly configFilePath: string;
      readonly config: ProjectConfig;
    }
  | { readonly kind: "written"; readonly plan: RenamePlan }
  | {
      readonly kind: "interactive-complete";
      readonly plan: RenamePlan;
      readonly result: InteractiveResult;
    }
  | { readonly kind: "interface-skipped"; readonly impact: InterfaceImpact }
  | { readonly kind: "interface-aborted" };

// ---------------------------------------------------------------------------
// Load result with warnings
// ---------------------------------------------------------------------------

/**
 * Result of loading embedded queries from source files.
 * Warnings are non-fatal parse errors that should be surfaced to the user.
 */
export interface LoadQueriesResult {
  readonly queries: readonly EmbeddedQueryContent[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Project config
// ---------------------------------------------------------------------------

/** Resolved project configuration from graphql-config. */
export interface ProjectConfig {
  readonly schemaPatterns: readonly string[];
  readonly documentPatterns: readonly string[];
  readonly projectName: string;
}

// ---------------------------------------------------------------------------
// Rename context
// ---------------------------------------------------------------------------

/**
 * All data needed by the pure rename pipeline.
 * Assembled by the shell layer before calling into the core.
 */
export interface RenameContext {
  readonly schemaFiles: readonly SchemaFileContent[];
  readonly schema: GraphQLSchema;
  readonly queries: readonly EmbeddedQueryContent[];
}
