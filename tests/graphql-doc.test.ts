import { describe, test, expect, beforeEach } from "bun:test";
import path from "path";
import fs from "fs";
import { copyDirSync } from "./helpers";
import { renameFieldInSchema } from "../src/core/rename-schema";
import { renameFieldInDocuments } from "../src/core/rename-document";
import {
  loadSchemaFiles,
  buildSchemaFromFiles,
  loadEmbeddedQueries,
  writeFileUpdates,
} from "../src/shell/file-system";
import type { TypeName, FieldName } from "../src/types/domain";
import os from "os";

const FIXTURE_DIR = path.join(__dirname, "fixtures/rename-field-graphql-doc");

describe("rename field in .graphql document files", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(FIXTURE_DIR, workDir);
  });

  test("User.firstName → User.fullName updates .graphql operation files", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);

    const schemaResult = renameFieldInSchema(
      schemaFilesResult.value,
      "User" as TypeName,
      "firstName" as FieldName,
      "fullName" as FieldName,
    );

    const { queries } = await loadEmbeddedQueries(["operations/**/*.graphql"], workDir);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]!.tagName).toBe("file");

    const documentResult = renameFieldInDocuments(
      queries,
      schema,
      "User" as TypeName,
      "firstName" as FieldName,
      "fullName" as FieldName,
    );

    writeFileUpdates(schemaResult.fileUpdates);
    writeFileUpdates(documentResult.fileUpdates);

    const updatedSchema = fs.readFileSync(path.join(workDir, "schema/user.graphql"), "utf-8");
    expect(updatedSchema).toContain("fullName: String!");
    expect(updatedSchema).toMatch(/type Product[\s\S]*firstName/);

    const updatedOperations = fs.readFileSync(
      path.join(workDir, "operations/user_queries.graphql"),
      "utf-8",
    );
    expect(updatedOperations).toContain("fullName");
    expect(updatedOperations).not.toMatch(/\bfirstName\b/);

    expect(documentResult.changes.length).toBeGreaterThan(0);
    expect(
      documentResult.changes.every((c) => c.oldText === "firstName" && c.newText === "fullName"),
    ).toBe(true);
  });

  test("extracts operations but ignores schema definitions in .graphql files", async () => {
    const { queries } = await loadEmbeddedQueries(["schema/**/*.graphql"], workDir);
    expect(queries.length).toBe(0);
  });
});
