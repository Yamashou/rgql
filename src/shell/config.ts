/**
 * Config loading from graphql-config files.
 *
 * Searches for config files up the directory tree and loads project
 * settings using the graphql-config library. Returns Result instead of throwing.
 *
 * @module
 */
import { loadConfig } from "graphql-config";
import path from "path";
import fs from "fs";
import type { ProjectConfig, ValidationError } from "../types/domain";
import { ok, err, type Result } from "../types/result";

/** All supported graphql-config file names, searched in order. */
const CONFIG_FILE_NAMES = [
  "graphql.config.yml",
  "graphql.config.yaml",
  "graphql.config.json",
  "graphql.config.js",
  "graphql.config.ts",
  ".graphqlrc",
  ".graphqlrc.yml",
  ".graphqlrc.yaml",
  ".graphqlrc.json",
] as const;

/**
 * Searches for a graphql-config file starting from `startDir` and walking up to the root.
 *
 * @precondition `startDir` is an absolute or resolvable path.
 * @postcondition Returns the directory containing a config file, or null if none found
 *                before reaching the filesystem root.
 *
 * @param startDir - The directory to start searching from.
 * @returns The directory containing a config file, or null.
 */
function findConfigDir(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    for (const name of CONFIG_FILE_NAMES) {
      if (fs.existsSync(path.join(current, name))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Loads a project configuration from a graphql-config file.
 *
 * If `configPath` is provided, uses that file directly.
 * Otherwise searches up from cwd for a config file.
 *
 * @precondition If `configPath` is provided, the file must exist and be valid.
 * @postcondition On success, returns the resolved config with schema/document patterns
 *                and the absolute path to the config file.
 *
 * @param configPath  - Explicit path to a config file, or undefined to auto-detect.
 * @param projectName - The project name within multi-project configs ("default" for single).
 * @returns A Result with the config and its file path, or a `config-not-found` error.
 */
export async function loadProjectConfig(
  configPath: string | undefined,
  projectName: string,
): Promise<Result<{ config: ProjectConfig; configFilePath: string }, ValidationError>> {
  const rootDir = configPath
    ? path.dirname(path.resolve(configPath))
    : findConfigDir(process.cwd());

  if (!rootDir) {
    return err({ kind: "config-not-found" });
  }

  try {
    const graphqlConfig = await loadConfig({
      rootDir,
      filepath: configPath,
      throwOnEmpty: true,
      throwOnMissing: true,
    });

    if (!graphqlConfig) {
      return err({ kind: "config-not-found" });
    }

    const project = graphqlConfig.getProject(projectName === "default" ? undefined : projectName);

    const schemaPatterns = normalizePatterns(project.schema);
    const documentPatterns = normalizePatterns(project.documents);

    return ok({
      config: {
        schemaPatterns,
        documentPatterns,
        projectName: project.name,
      },
      configFilePath: graphqlConfig.filepath,
    });
  } catch (_error) {
    return err({ kind: "config-not-found" });
  }
}

/**
 * Normalizes schema/document pattern values from graphql-config into a string array.
 *
 * graphql-config may return a single string, an array of mixed items, or undefined.
 * This function coerces all forms into `string[]`.
 *
 * @postcondition Returns an array of strings. Non-string items are filtered out.
 */
function normalizePatterns(input: unknown): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) {
    return input.flatMap((item) => {
      if (typeof item === "string") return [item];
      return [];
    });
  }
  return [];
}
