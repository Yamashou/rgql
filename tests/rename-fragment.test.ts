import { describe, test, expect, beforeEach } from "bun:test";
import path from "path";
import fs from "fs";
import { copyDirSync } from "./helpers";
import { renameFragmentInDocuments } from "../src/core/rename-document";
import { loadEmbeddedQueries, writeFileUpdates } from "../src/shell/file-system";
import type { FragmentName } from "../src/types/domain";
import os from "os";

const FIXTURE_DIR = path.join(__dirname, "fixtures/rename-fragment");

describe("rename fragment", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(FIXTURE_DIR, workDir);
  });

  test("UserBasic → UserSummary (definition + spreads)", async () => {
    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);

    const documentResult = renameFragmentInDocuments(
      queries,
      "UserBasic" as FragmentName,
      "UserSummary" as FragmentName,
    );

    writeFileUpdates(documentResult.fileUpdates);

    expect(documentResult.changes.length).toBeGreaterThan(0);

    const updatedFragments = fs.readFileSync(path.join(workDir, "src/fragments.ts"), "utf-8");
    expect(updatedFragments).toContain("fragment UserSummary on User");
    expect(updatedFragments).not.toContain("fragment UserBasic on User");
    expect(updatedFragments).toContain("...UserSummary");
    expect(updatedFragments).not.toContain("...UserBasic");
  });
});
