/**
 * Pure text replacement utility.
 *
 * Applies positional replacements to a string without using AST printers,
 * preserving original formatting (comments, whitespace, descriptions).
 *
 * @module
 */
import type { TextReplacement } from "../types/domain";

/**
 * Applies a list of text replacements to a content string.
 *
 * Replacements are deduplicated by start offset (first wins) and applied
 * in reverse order so that earlier offsets remain valid after later splices.
 *
 * @precondition Each replacement's `start < end` and both are within `content` bounds.
 * @precondition Replacements must not overlap (but may be duplicated — deduplication handles that).
 * @postcondition Returned string has all replacements applied. Original formatting outside
 *                replacement ranges is preserved exactly.
 *
 * @param content      - The original file content.
 * @param replacements - Positional replacements to apply.
 * @returns The content with all replacements applied.
 */
export function applyReplacements(
  content: string,
  replacements: readonly TextReplacement[],
): string {
  const seen = new Set<number>();
  const unique = replacements.filter((replacement) => {
    if (seen.has(replacement.start)) return false;
    seen.add(replacement.start);
    return true;
  });

  const sorted = [...unique].sort((a, b) => b.start - a.start);

  let result = content;
  for (const replacement of sorted) {
    result =
      result.slice(0, replacement.start) + replacement.newText + result.slice(replacement.end);
  }
  return result;
}
