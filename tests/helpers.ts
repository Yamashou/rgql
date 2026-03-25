import fs from "fs";
import path from "path";

/**
 * Recursively copy a directory.
 */
export function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Read all files in a directory recursively, returning a map of relative path to content.
 */
export function readDirRecursive(dir: string, base?: string): Map<string, string> {
  const result = new Map<string, string>();
  const baseDir = base ?? dir;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const sub = readDirRecursive(fullPath, baseDir);
      for (const [k, v] of sub) {
        result.set(k, v);
      }
    } else {
      const rel = path.relative(baseDir, fullPath);
      result.set(rel, fs.readFileSync(fullPath, "utf-8"));
    }
  }

  return result;
}

/**
 * Compare actual output files against golden files.
 * Only checks files that exist in the golden directory.
 */
export function compareWithGolden(
  actualDir: string,
  goldenDir: string,
): { passed: boolean; diffs: { file: string; expected: string; actual: string }[] } {
  const goldenFiles = readDirRecursive(goldenDir);
  const diffs: { file: string; expected: string; actual: string }[] = [];

  for (const [relPath, expectedContent] of goldenFiles) {
    const actualPath = path.join(actualDir, relPath);
    if (!fs.existsSync(actualPath)) {
      diffs.push({
        file: relPath,
        expected: expectedContent,
        actual: "<FILE NOT FOUND>",
      });
      continue;
    }

    const actualContent = fs.readFileSync(actualPath, "utf-8");
    if (actualContent !== expectedContent) {
      diffs.push({
        file: relPath,
        expected: expectedContent,
        actual: actualContent,
      });
    }
  }

  return { passed: diffs.length === 0, diffs };
}

/**
 * Update golden files from actual output.
 * Used when UPDATE_GOLDEN=1 env is set.
 */
export function updateGolden(actualDir: string, goldenDir: string, filePaths: string[]): void {
  for (const relPath of filePaths) {
    const actualPath = path.join(actualDir, relPath);
    const goldenPath = path.join(goldenDir, relPath);

    if (fs.existsSync(actualPath)) {
      fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
      fs.copyFileSync(actualPath, goldenPath);
    }
  }
}
