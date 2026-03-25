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

const FIXTURE_DIR = path.join(__dirname, "fixtures/rename-field");

describe("rename field", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(FIXTURE_DIR, workDir);
  });

  test("User.firstName → User.fullName (schema + documents)", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);

    const schemaResult = renameFieldInSchema(
      schemaFilesResult.value,
      "User" as TypeName,
      "firstName" as FieldName,
      "fullName" as FieldName,
    );

    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);
    const documentResult = renameFieldInDocuments(
      queries,
      schema,
      "User" as TypeName,
      "firstName" as FieldName,
      "fullName" as FieldName,
    );

    writeFileUpdates(schemaResult.fileUpdates);
    writeFileUpdates(documentResult.fileUpdates);

    expect(schemaResult.changes.length).toBeGreaterThan(0);
    expect(
      schemaResult.changes.every((c) => c.oldText === "firstName" && c.newText === "fullName"),
    ).toBe(true);
    expect(documentResult.changes.length).toBeGreaterThan(0);

    const updatedSchema = fs.readFileSync(path.join(workDir, "schema/user.graphql"), "utf-8");
    expect(updatedSchema).toContain("fullName: String!");
    expect(updatedSchema).toMatch(/type Product \{[\s\S]*firstName/);

    const updatedUserCard = fs.readFileSync(path.join(workDir, "src/UserCard.tsx"), "utf-8");
    expect(updatedUserCard).toContain("fullName");
    expect(updatedUserCard).toMatch(/GetProduct[\s\S]*firstName/);
  });

  test("does not rename non-matching type's field", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");

    const schemaResult = renameFieldInSchema(
      schemaFilesResult.value,
      "User" as TypeName,
      "firstName" as FieldName,
      "fullName" as FieldName,
    );

    for (const change of schemaResult.changes) {
      expect(change.oldText).toBe("firstName");
      expect(change.newText).toBe("fullName");
    }

    for (const fileUpdate of schemaResult.fileUpdates) {
      expect(fileUpdate.content).toMatch(/type Product[\s\S]*firstName/);
    }
  });
});
