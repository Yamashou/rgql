import { describe, test, expect } from "bun:test";
import path from "path";
import fs from "fs";
import { copyDirSync } from "./helpers";
import { computeRenamePlan } from "../src/core/pipeline";
import {
  loadSchemaFiles,
  buildSchemaFromFiles,
  loadEmbeddedQueries,
} from "../src/shell/file-system";
import type { RenameCommand, TypeName, FieldName, FragmentName } from "../src/types/domain";
import os from "os";

describe("computeRenamePlan (pure pipeline)", () => {
  test("rename-type returns ok with changes", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(path.join(__dirname, "fixtures/rename-type"), workDir);

    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);
    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);

    const command: RenameCommand = {
      kind: "rename-type",
      oldName: "User" as TypeName,
      newName: "Account" as TypeName,
    };

    const result = computeRenamePlan(command, {
      schemaFiles: schemaFilesResult.value,
      schema,
      queries,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changes.length).toBeGreaterThan(0);
      expect(result.value.fileUpdates.length).toBeGreaterThan(0);
    }
  });

  test("rename-type returns error for non-existent type", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(path.join(__dirname, "fixtures/rename-type"), workDir);

    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);
    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);

    const command: RenameCommand = {
      kind: "rename-type",
      oldName: "NonExistent" as TypeName,
      newName: "Something" as TypeName,
    };

    const result = computeRenamePlan(command, {
      schemaFiles: schemaFilesResult.value,
      schema,
      queries,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("type-not-found");
    }
  });

  test("rename-type returns error for name collision", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(path.join(__dirname, "fixtures/rename-type"), workDir);

    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);
    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);

    const command: RenameCommand = {
      kind: "rename-type",
      oldName: "User" as TypeName,
      newName: "Post" as TypeName,
    };

    const result = computeRenamePlan(command, {
      schemaFiles: schemaFilesResult.value,
      schema,
      queries,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("type-already-exists");
    }
  });

  test("rename-field with cascade includes additional types", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(path.join(__dirname, "fixtures/rename-field-interface"), workDir);

    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);
    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);

    const command: RenameCommand = {
      kind: "rename-field",
      typeName: "Node" as TypeName,
      oldFieldName: "firstName" as FieldName,
      newFieldName: "fullName" as FieldName,
    };

    const result = computeRenamePlan(
      command,
      { schemaFiles: schemaFilesResult.value, schema, queries },
      { kind: "cascade", additionalTypes: ["User" as TypeName, "Admin" as TypeName] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changes.length).toBeGreaterThan(0);
      // Should include changes for Node, User, and Admin
      const schemaChanges = result.value.changes.filter((c) => c.category === "schema");
      expect(schemaChanges.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("rename-fragment returns error for non-existent fragment", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(path.join(__dirname, "fixtures/rename-fragment"), workDir);

    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);
    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);

    const command: RenameCommand = {
      kind: "rename-fragment",
      oldName: "NonExistent" as FragmentName,
      newName: "Something" as FragmentName,
    };

    const result = computeRenamePlan(command, {
      schemaFiles: schemaFilesResult.value,
      schema,
      queries,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("fragment-not-found");
    }
  });
});
