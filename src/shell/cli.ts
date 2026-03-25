/**
 * CLI entry point and IO boundary.
 *
 * This module defines the Commander.js commands, orchestrates the rename use case,
 * and provides the single IO edge (`handleOutcome`) where all console output,
 * file writes, and process exits happen.
 *
 * Architecture:
 * - Action callbacks parse CLI args and call `executeRename`
 * - `executeRename` loads data (IO), computes a plan (pure), returns a `RenameOutcome`
 * - `handleOutcome` interprets the outcome and performs all side effects
 *
 * @module
 */
import { Command } from "commander";
import readline from "readline";
import path from "path";
import type {
  RenameCommand,
  RenameOutcome,
  InterfaceDecision,
  InterfaceImpact,
  InteractiveResult,
  RenamePlan,
  PromptAnswer,
} from "../types/domain";
import { toTypeName, toFragmentName } from "../types/domain";
import { parseFieldArgument, formatValidationError } from "../core/validate";
import { checkInterfaceImpact } from "../core/interface-check";
import { computeRenamePlan } from "../core/pipeline";
import { loadProjectConfig } from "./config";
import {
  loadSchemaFiles,
  buildSchemaFromFiles,
  loadEmbeddedQueries,
  writeFileUpdates,
} from "./file-system";
import {
  formatDryRunOutput,
  formatWriteOutput,
  formatInterfaceSkipWarning,
  formatInterfacePrompt,
  formatInteractiveChange,
  formatInteractiveResult,
  parsePromptAnswer,
  collectInteractiveDecisions,
} from "./output";

const program = new Command();

program.name("rgql").description("Type-safe GraphQL refactoring CLI tool").version("0.1.0");

program
  .option("--config <path>", "Path to graphql-config file")
  .option("--project <name>", "Project name for multi-project config", "default")
  .option("--write", "Apply changes to files (default: dry run)", false)
  .option("-i, --interactive", "Apply changes interactively", false)
  .option("--force", "Force breaking changes (e.g. interface cascade rename)", false);

const rename = program.command("rename").description("Rename GraphQL entities");

rename
  .command("type")
  .description("Rename a GraphQL type")
  .argument("<oldType>", "Current type name")
  .argument("<newType>", "New type name")
  .action(async (oldType: string, newType: string) => {
    const command: RenameCommand = {
      kind: "rename-type",
      oldName: toTypeName(oldType),
      newName: toTypeName(newType),
    };
    handleOutcome(await executeRename(command, program.opts()));
  });

rename
  .command("field")
  .description("Rename a GraphQL field")
  .argument("<oldField>", "Type.oldField (e.g. User.firstName)")
  .argument("<newField>", "Type.newField (e.g. User.fullName)")
  .action(async (oldField: string, newField: string) => {
    const oldResult = parseFieldArgument(oldField);
    const newResult = parseFieldArgument(newField);
    if (!oldResult.ok) return handleOutcome({ kind: "error", error: oldResult.error });
    if (!newResult.ok) return handleOutcome({ kind: "error", error: newResult.error });

    if (oldResult.value.typeName !== newResult.value.typeName) {
      return handleOutcome({
        kind: "error",
        error: {
          kind: "type-name-mismatch",
          oldType: oldResult.value.typeName,
          newType: newResult.value.typeName,
        },
      });
    }

    const command: RenameCommand = {
      kind: "rename-field",
      typeName: oldResult.value.typeName,
      oldFieldName: oldResult.value.fieldName,
      newFieldName: newResult.value.fieldName,
    };
    handleOutcome(await executeRename(command, program.opts()));
  });

rename
  .command("fragment")
  .description("Rename a GraphQL fragment")
  .argument("<oldFragment>", "Current fragment name")
  .argument("<newFragment>", "New fragment name")
  .action(async (oldFragment: string, newFragment: string) => {
    const command: RenameCommand = {
      kind: "rename-fragment",
      oldName: toFragmentName(oldFragment),
      newName: toFragmentName(newFragment),
    };
    handleOutcome(await executeRename(command, program.opts()));
  });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed global CLI options from Commander.js. */
interface GlobalOptions {
  config?: string;
  project: string;
  write: boolean;
  interactive: boolean;
  force: boolean;
}

// ---------------------------------------------------------------------------
// Use case: executeRename
// ---------------------------------------------------------------------------

/**
 * Orchestrates a rename operation and returns the outcome.
 *
 * Loads config and files (IO), optionally prompts for interface decisions (IO),
 * then computes the rename plan (pure) and returns a RenameOutcome.
 * Does NOT perform any output IO (no console.log, no process.exit, no file writes).
 *
 * @precondition `command` contains valid branded type values.
 * @postcondition The returned outcome carries all data needed for `handleOutcome` to act.
 *
 * @param command - The rename operation to perform.
 * @param opts    - Global CLI options (--write, --force, --interactive, etc.).
 * @returns A RenameOutcome describing the result.
 */
async function executeRename(command: RenameCommand, opts: GlobalOptions): Promise<RenameOutcome> {
  // 1. Load config
  const configResult = await loadProjectConfig(opts.config, opts.project);
  if (!configResult.ok) return { kind: "error", error: configResult.error };

  const { config, configFilePath } = configResult.value;
  const rootDir = path.dirname(configFilePath);

  // 2. Load files
  const schemaFilesResult = await loadSchemaFiles(config.schemaPatterns, rootDir);
  if (!schemaFilesResult.ok) return { kind: "error", error: schemaFilesResult.error };

  const schemaFiles = schemaFilesResult.value;
  const schema = buildSchemaFromFiles(schemaFiles);
  const { queries, warnings: loadWarnings } = await loadEmbeddedQueries(
    config.documentPatterns,
    rootDir,
  );

  // 3. Interface decision (interactive prompting is acceptable IO)
  let interfaceDecision: InterfaceDecision | undefined;
  if (command.kind === "rename-field") {
    const impact = checkInterfaceImpact(schema, command.typeName, command.oldFieldName);
    if (impact) {
      interfaceDecision = await resolveInterfaceDecision(impact, opts);
      if (interfaceDecision.kind === "abort") return { kind: "interface-aborted" };
      if (interfaceDecision.kind === "skip") return { kind: "interface-skipped", impact };
    }
  }

  // 4. Compute plan (pure)
  const planResult = computeRenamePlan(
    command,
    { schemaFiles, schema, queries },
    interfaceDecision,
  );
  if (!planResult.ok) return { kind: "error", error: planResult.error };

  const plan = {
    ...planResult.value,
    warnings: [...planResult.value.warnings, ...loadWarnings],
  };

  // 5. Determine outcome
  if (plan.changes.length === 0) return { kind: "no-changes" };

  if (opts.write) {
    if (opts.interactive) {
      const result = await gatherInteractiveAnswers(plan);
      return { kind: "interactive-complete", plan, result };
    }
    return { kind: "written", plan };
  }

  return { kind: "dry-run", plan, configFilePath, config };
}

// ---------------------------------------------------------------------------
// Interface decision helpers (pure except for promptInterfaceRename)
// ---------------------------------------------------------------------------

/**
 * Resolves the interface decision based on CLI options or user prompt.
 *
 * @postcondition Returns "cascade" (--force or user said yes), "skip" (default), or
 *                "abort" (user said quit).
 */
async function resolveInterfaceDecision(
  impact: InterfaceImpact,
  opts: GlobalOptions,
): Promise<InterfaceDecision> {
  if (opts.interactive) {
    const answer = await promptInterfaceRename(impact);
    return interfaceAnswerToDecision(answer, impact);
  }

  if (opts.force) {
    return buildCascadeDecision(impact);
  }

  return { kind: "skip" };
}

/**
 * Converts a user's prompt answer to an InterfaceDecision.
 *
 * @precondition `answer` is a valid PromptAnswer.
 * @postcondition Exhaustive — every PromptAnswer variant is handled.
 */
function interfaceAnswerToDecision(
  answer: PromptAnswer,
  impact: InterfaceImpact,
): InterfaceDecision {
  switch (answer) {
    case "yes":
      return buildCascadeDecision(impact);
    case "no":
      return { kind: "skip" };
    case "quit":
      return { kind: "abort" };
  }
}

/**
 * Builds a cascade decision that includes all implementing types and the interface itself.
 *
 * @postcondition `additionalTypes` includes all implementing type names and the interface name
 *                (if not already among the implementing types).
 */
function buildCascadeDecision(impact: InterfaceImpact): InterfaceDecision {
  const implementingTypeNames = impact.implementingTypes.map((t) => toTypeName(t.typeName));
  const includesInterface = impact.implementingTypes.some(
    (t) => t.typeName === impact.interfaceName,
  );
  const additionalTypes = includesInterface
    ? implementingTypeNames
    : [...implementingTypeNames, toTypeName(impact.interfaceName)];
  return { kind: "cascade", additionalTypes };
}

// ---------------------------------------------------------------------------
// Interactive prompting (acceptable IO: user interaction via readline)
// ---------------------------------------------------------------------------

/**
 * Manages a readline session, providing a typed `ask` function to the callback.
 *
 * @postcondition The readline interface is always closed, even if `fn` throws.
 *
 * @param fn - A function that receives an `ask` helper and returns a result.
 * @returns The value returned by `fn`.
 */
async function withReadline<T>(
  fn: (ask: (question: string) => Promise<PromptAnswer>) => Promise<T>,
): Promise<T> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (question: string): Promise<PromptAnswer> =>
    new Promise<PromptAnswer>((resolve) => {
      rl.question(question, (raw) => resolve(parsePromptAnswer(raw)));
    });

  try {
    return await fn(ask);
  } finally {
    rl.close();
  }
}

/**
 * Prompts the user for each change in the plan and collects their answers.
 *
 * Displays each change before asking. Stops early if the user quits.
 * Does NOT write files or produce final output — only gathers decisions.
 *
 * @precondition `plan.changes.length > 0`.
 * @postcondition Returns an InteractiveResult summarizing the user's decisions.
 */
async function gatherInteractiveAnswers(plan: RenamePlan): Promise<InteractiveResult> {
  const total = plan.changes.length;
  return withReadline(async (ask) => {
    const answers: PromptAnswer[] = [];
    for (const [i, change] of plan.changes.entries()) {
      console.log(
        formatInteractiveChange(
          i,
          total,
          change.filePath,
          change.line,
          change.oldText,
          change.newText,
        ),
      );
      const answer = await ask("Apply? [y/n/q] ");
      answers.push(answer);
      if (answer === "quit") break;
    }
    return collectInteractiveDecisions(answers, total);
  });
}

/**
 * Shows the interface impact and prompts the user to confirm cascade rename.
 *
 * @postcondition Returns the user's answer as a PromptAnswer.
 */
async function promptInterfaceRename(impact: InterfaceImpact): Promise<PromptAnswer> {
  console.log(formatInterfacePrompt(impact));
  return withReadline((ask) => ask("\nRename all of the above together? [y/n/q] "));
}

// ---------------------------------------------------------------------------
// Edge: single IO boundary for all output, file writes, and process exits
// ---------------------------------------------------------------------------

/**
 * Interprets a RenameOutcome and performs all side effects.
 *
 * This is the ONLY function in the application that:
 * - Writes to console (console.log, console.warn, console.error)
 * - Writes files to disk (writeFileUpdates)
 * - Exits the process (process.exit)
 *
 * @precondition `outcome` is a valid RenameOutcome variant.
 * @postcondition All appropriate side effects have been performed.
 *                For error/abort/skip outcomes, the process exits with the appropriate code.
 */
function handleOutcome(outcome: RenameOutcome): void {
  switch (outcome.kind) {
    case "error":
      console.error(formatValidationError(outcome.error));
      process.exit(1);
      break;

    case "no-changes":
      console.log("No changes found.");
      break;

    case "dry-run":
      for (const warning of outcome.plan.warnings) console.warn(warning);
      console.log(
        formatDryRunOutput(
          outcome.plan,
          outcome.configFilePath,
          outcome.config.schemaPatterns,
          outcome.config.documentPatterns,
          outcome.config.projectName,
        ),
      );
      break;

    case "written":
      for (const warning of outcome.plan.warnings) console.warn(warning);
      writeFileUpdates(outcome.plan.fileUpdates);
      console.log(formatWriteOutput(outcome.plan));
      break;

    case "interactive-complete":
      if (outcome.result.kind === "all-accepted") {
        writeFileUpdates(outcome.plan.fileUpdates);
      }
      console.log(formatInteractiveResult(outcome.result));
      if (outcome.result.kind === "aborted") process.exit(0);
      break;

    case "interface-skipped":
      console.warn(formatInterfaceSkipWarning(outcome.impact));
      process.exit(2);
      break;

    case "interface-aborted":
      process.exit(0);
      break;
  }
}

export { program };
