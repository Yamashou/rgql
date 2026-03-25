/**
 * Pure formatting functions for CLI output.
 *
 * Every function in this module takes structured data and returns a string.
 * No IO, no side effects — the shell layer calls these and passes the result to console.
 *
 * @module
 */
import type {
  Change,
  RenamePlan,
  InterfaceImpact,
  PromptAnswer,
  InteractiveResult,
} from "../types/domain";

/**
 * Formats the output for a dry-run (no --write) execution.
 *
 * @precondition `plan.changes.length > 0`.
 * @postcondition Returns a multi-line string showing config info, all changes grouped by file,
 *                total counts, and a hint to use `--write`.
 */
export function formatDryRunOutput(
  plan: RenamePlan,
  configFilePath: string,
  schemaPatterns: readonly string[],
  documentPatterns: readonly string[],
  projectName: string,
): string {
  const lines: string[] = [];

  lines.push(`🔍 Config: ${configFilePath} (project: ${projectName})`);
  lines.push(`📂 Schema:    ${schemaPatterns.join(", ")}`);
  lines.push(`📂 Documents: ${documentPatterns.join(", ")}`);
  lines.push("");
  lines.push("Changes:");

  const fileGroups = groupChangesByFile(plan.changes);

  for (const [filePath, fileChanges] of fileGroups) {
    for (const change of fileChanges) {
      const tag =
        change.category === "schema" ? "[schema]" : `(${change.tagName}\`...\`)  [document]`;
      lines.push(`  ${filePath}:${change.line}  ${change.oldText} → ${change.newText}  ${tag}`);
    }
  }

  const fileCount = fileGroups.size;
  const occurrences = plan.changes.length;
  lines.push("");
  lines.push(`${fileCount} files, ${occurrences} occurrences`);
  lines.push("Dry run. Use --write to apply.");

  return lines.join("\n");
}

/**
 * Formats the output after successfully writing changes to disk.
 *
 * @precondition `plan.changes.length > 0`.
 * @postcondition Returns a multi-line string with a checkmark per change and a summary count.
 */
export function formatWriteOutput(plan: RenamePlan): string {
  const lines: string[] = [];

  const fileGroups = groupChangesByFile(plan.changes);

  for (const [filePath, fileChanges] of fileGroups) {
    for (const change of fileChanges) {
      lines.push(`✓ ${filePath}:${change.line}`);
    }
  }

  const fileCount = fileGroups.size;
  const occurrences = plan.changes.length;
  lines.push("");
  lines.push(`${fileCount} files, ${occurrences} occurrences updated.`);

  return lines.join("\n");
}

/**
 * Formats a warning message when a field rename is skipped due to interface impact.
 *
 * @postcondition Returns a multi-line warning string listing affected types and remediation steps.
 */
export function formatInterfaceSkipWarning(impact: InterfaceImpact): string {
  const typeNames = impact.implementingTypes.map((t) => t.typeName).join(", ");
  return [
    `⚠️  WARNING: '${impact.fieldName}' is defined on interface '${impact.interfaceName}'`,
    `    Implementing types (${typeNames}) were NOT renamed.`,
    "    Use --force to rename all or rename each type manually.",
    `    Skipping ${impact.interfaceName}.${impact.fieldName}.`,
  ].join("\n");
}

/**
 * Formats the prompt text shown before asking the user about interface cascade.
 *
 * @postcondition Returns a multi-line string listing all affected types.
 */
export function formatInterfacePrompt(impact: InterfaceImpact): string {
  const typeLines = impact.implementingTypes
    .map((t) => `    - ${t.typeName}.${impact.fieldName}`)
    .join("\n");
  return [
    `\n⚠️  Breaking change detected:`,
    `    '${impact.fieldName}' is defined on interface '${impact.interfaceName}'`,
    `    The following types implement this interface:\n`,
    typeLines,
  ].join("\n");
}

/**
 * Formats a single change for display in interactive mode.
 *
 * @precondition `0 <= index < total`.
 * @postcondition Returns a string showing [N/total] file:line with old/new text diff.
 */
export function formatInteractiveChange(
  index: number,
  total: number,
  filePath: string,
  line: number,
  oldText: string,
  newText: string,
): string {
  return [`\n[${index + 1}/${total}] ${filePath}:${line}`, `  - ${oldText}`, `  + ${newText}`].join(
    "\n",
  );
}

/**
 * Parses raw user input from a y/n/q prompt into a typed PromptAnswer.
 *
 * @postcondition Returns "yes" for y/Y/yes, "quit" for q/quit, "no" for everything else
 *                (including empty input).
 */
export function parsePromptAnswer(input: string): PromptAnswer {
  const normalized = input.toLowerCase().trim();
  if (normalized === "y" || normalized === "yes") return "yes";
  if (normalized === "q" || normalized === "quit") return "quit";
  return "no";
}

/**
 * Aggregates a list of prompt answers into an InteractiveResult.
 *
 * @precondition `total >= answers.length`.
 * @postcondition If any answer is "quit", returns `aborted`.
 *                If all `total` answers are "yes", returns `all-accepted`.
 *                Otherwise returns `partial` with the count of accepted.
 */
export function collectInteractiveDecisions(
  answers: readonly PromptAnswer[],
  total: number,
): InteractiveResult {
  const quitIndex = answers.indexOf("quit");
  if (quitIndex !== -1) return { kind: "aborted" };

  const accepted = answers.filter((answer) => answer === "yes").length;
  if (accepted === total) return { kind: "all-accepted", count: accepted };
  return { kind: "partial", accepted, total };
}

/**
 * Formats the final result of an interactive apply session.
 *
 * @postcondition Returns a human-readable summary string.
 */
export function formatInteractiveResult(result: InteractiveResult): string {
  switch (result.kind) {
    case "all-accepted":
      return `\n${result.count} occurrences updated.`;
    case "partial":
      return "\nInteractive mode with partial apply is not yet supported. Use non-interactive --write.";
    case "aborted":
      return "Aborted.";
  }
}

/**
 * Groups a flat list of changes by file path, preserving order.
 *
 * @postcondition Each key in the returned map has at least one change.
 */
function groupChangesByFile(changes: readonly Change[]): Map<string, Change[]> {
  const groups = new Map<string, Change[]>();
  for (const change of changes) {
    const existing = groups.get(change.filePath);
    if (existing) {
      existing.push(change);
    } else {
      groups.set(change.filePath, [change]);
    }
  }
  return groups;
}
