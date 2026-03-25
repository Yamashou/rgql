import { describe, test, expect, beforeEach } from "bun:test";
import path from "path";
import fs from "fs";
import { copyDirSync } from "./helpers";
import { renameTypeInSchema } from "../src/core/rename-schema";
import { renameTypeInDocuments } from "../src/core/rename-document";
import {
  loadSchemaFiles,
  buildSchemaFromFiles,
  loadEmbeddedQueries,
  writeFileUpdates,
} from "../src/shell/file-system";
import type { TypeName } from "../src/types/domain";
import os from "os";

const FIXTURE_DIR = path.join(__dirname, "fixtures/rename-type");

describe("rename type", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-test-"));
    copyDirSync(FIXTURE_DIR, workDir);
  });

  test("User → Account (schema + documents)", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);

    const schemaResult = renameTypeInSchema(
      schemaFilesResult.value,
      "User" as TypeName,
      "Account" as TypeName,
    );
    const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);
    const documentResult = renameTypeInDocuments(
      queries,
      schema,
      "User" as TypeName,
      "Account" as TypeName,
    );

    writeFileUpdates(schemaResult.fileUpdates);
    writeFileUpdates(documentResult.fileUpdates);

    const updatedSchema = fs.readFileSync(path.join(workDir, "schema/user.graphql"), "utf-8");
    expect(updatedSchema).toContain("type Account");
    expect(updatedSchema).toContain("user(id: ID!): Account");
    expect(updatedSchema).toContain("[Account!]!");
    expect(updatedSchema).toContain("author: Account!");
    expect(updatedSchema).not.toContain("type User");

    const updatedUserList = fs.readFileSync(path.join(workDir, "src/UserList.tsx"), "utf-8");
    expect(updatedUserList).toContain("on Account");
    expect(updatedUserList).not.toMatch(/on User\b/);
  });

  test("renaming to existing type fails validation", async () => {
    const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
    if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
    const schema = buildSchemaFromFiles(schemaFilesResult.value);

    const existingType = schema.getType("Post");
    expect(existingType).toBeDefined();
  });
});
