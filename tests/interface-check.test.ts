import { describe, test, expect, beforeEach } from "bun:test";
import path from "path";
import fs from "fs";
import { copyDirSync } from "./helpers";
import { renameFieldInSchema } from "../src/core/rename-schema";
import { checkInterfaceImpact } from "../src/core/interface-check";
import { renameFieldInDocuments } from "../src/core/rename-document";
import {
  loadSchemaFiles,
  buildSchemaFromFiles,
  loadEmbeddedQueries,
  writeFileUpdates,
} from "../src/shell/file-system";
import type { TypeName, FieldName } from "../src/types/domain";
import os from "os";

const FIXTURE_DIR = path.join(__dirname, "fixtures/rename-field-interface");

describe("interface check", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(FIXTURE_DIR, workDir);
  });

  test("detects interface impact for Node.firstName", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);

    const impact = checkInterfaceImpact(schema, "Node", "firstName");
    expect(impact).not.toBeNull();
    expect(impact!.interfaceName).toBe("Node");
    expect(impact!.implementingTypes.length).toBe(2);
    expect(impact!.implementingTypes.map((t) => t.typeName).sort()).toEqual(["Admin", "User"]);
  });

  test("detects interface impact when renaming implementing type field", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);

    const impact = checkInterfaceImpact(schema, "User", "firstName");
    expect(impact).not.toBeNull();
    expect(impact!.interfaceName).toBe("Node");
  });

  test("--force renames all interface implementing types", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);

    const impact = checkInterfaceImpact(schema, "Node", "firstName");
    const additionalTypes = impact!.implementingTypes.map((t) => t.typeName as TypeName);

    const schemaResult = renameFieldInSchema(
      schemaFilesResult.value,
      "Node" as TypeName,
      "firstName" as FieldName,
      "fullName" as FieldName,
      additionalTypes,
    );

    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);
    const documentResult = renameFieldInDocuments(
      queries,
      schema,
      "Node" as TypeName,
      "firstName" as FieldName,
      "fullName" as FieldName,
      additionalTypes,
    );

    writeFileUpdates(schemaResult.fileUpdates);
    writeFileUpdates(documentResult.fileUpdates);

    const updatedSchema = fs.readFileSync(path.join(workDir, "schema/node.graphql"), "utf-8");
    expect(updatedSchema).not.toContain("firstName");
    expect(updatedSchema).toContain("fullName: String!");

    const updatedDocument = fs.readFileSync(path.join(workDir, "src/nodes.ts"), "utf-8");
    expect(updatedDocument).toContain("fullName");
    expect(updatedDocument).not.toMatch(/\bfirstName\b/);
  });
});
