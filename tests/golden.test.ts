import { describe, test, expect } from "bun:test";
import path from "path";
import fs from "fs";
import { copyDirSync, compareWithGolden, updateGolden } from "./helpers";
import { renameTypeInSchema, renameFieldInSchema } from "../src/core/rename-schema";
import {
  renameTypeInDocuments,
  renameFieldInDocuments,
  renameFragmentInDocuments,
} from "../src/core/rename-document";
import {
  loadSchemaFiles,
  buildSchemaFromFiles,
  loadEmbeddedQueries,
  writeFileUpdates,
} from "../src/shell/file-system";
import type { TypeName, FieldName, FragmentName } from "../src/types/domain";
import os from "os";

interface GoldenTestCase {
  name: string;
  fixtureDir: string;
  goldenDir: string;
  action: (workDir: string) => Promise<void>;
  files: string[];
}

const testCases: GoldenTestCase[] = [
  {
    name: "rename field: User.firstName → User.fullName",
    fixtureDir: path.join(__dirname, "fixtures/rename-field"),
    goldenDir: path.join(__dirname, "golden/rename-field"),
    files: ["schema/user.graphql", "src/UserCard.tsx", "src/profile.ts"],
    action: async (workDir) => {
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
    },
  },
  {
    name: "rename type: User → Account",
    fixtureDir: path.join(__dirname, "fixtures/rename-type"),
    goldenDir: path.join(__dirname, "golden/rename-type"),
    files: ["schema/user.graphql", "src/UserList.tsx"],
    action: async (workDir) => {
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
    },
  },
  {
    name: "rename fragment: UserBasic → UserSummary",
    fixtureDir: path.join(__dirname, "fixtures/rename-fragment"),
    goldenDir: path.join(__dirname, "golden/rename-fragment"),
    files: ["src/fragments.ts"],
    action: async (workDir) => {
      const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);
      const documentResult = renameFragmentInDocuments(
        queries,
        "UserBasic" as FragmentName,
        "UserSummary" as FragmentName,
      );
      writeFileUpdates(documentResult.fileUpdates);
    },
  },
  {
    name: "rename field in .graphql document: User.firstName → User.fullName",
    fixtureDir: path.join(__dirname, "fixtures/rename-field-graphql-doc"),
    goldenDir: path.join(__dirname, "golden/rename-field-graphql-doc"),
    files: ["schema/user.graphql", "operations/user_queries.graphql"],
    action: async (workDir) => {
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
      const documentResult = renameFieldInDocuments(
        queries,
        schema,
        "User" as TypeName,
        "firstName" as FieldName,
        "fullName" as FieldName,
      );
      writeFileUpdates(schemaResult.fileUpdates);
      writeFileUpdates(documentResult.fileUpdates);
    },
  },
  {
    name: "rename field with interface --force: Node.firstName → Node.fullName",
    fixtureDir: path.join(__dirname, "fixtures/rename-field-interface"),
    goldenDir: path.join(__dirname, "golden/rename-field-interface"),
    files: ["schema/node.graphql", "src/nodes.ts"],
    action: async (workDir) => {
      const schemaFilesResult = await loadSchemaFiles(["schema/**/*.graphql"], workDir);
      if (!schemaFilesResult.ok) throw new Error("Failed to load schema");
      const schema = buildSchemaFromFiles(schemaFilesResult.value);
      const schemaResult = renameFieldInSchema(
        schemaFilesResult.value,
        "Node" as TypeName,
        "firstName" as FieldName,
        "fullName" as FieldName,
        ["User" as TypeName, "Admin" as TypeName],
      );
      const { queries } = await loadEmbeddedQueries(["src/**/*.{ts,tsx}"], workDir);
      const documentResult = renameFieldInDocuments(
        queries,
        schema,
        "Node" as TypeName,
        "firstName" as FieldName,
        "fullName" as FieldName,
        ["User" as TypeName, "Admin" as TypeName],
      );
      writeFileUpdates(schemaResult.fileUpdates);
      writeFileUpdates(documentResult.fileUpdates);
    },
  },
];

describe("golden file tests", () => {
  for (const tc of testCases) {
    test(tc.name, async () => {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rgql-golden-"));
      copyDirSync(tc.fixtureDir, workDir);

      await tc.action(workDir);

      if (process.env.UPDATE_GOLDEN === "1") {
        updateGolden(workDir, tc.goldenDir, tc.files);
        console.log(`Updated golden files for: ${tc.name}`);
      } else {
        const result = compareWithGolden(workDir, tc.goldenDir);
        for (const diff of result.diffs) {
          console.log(`\n=== ${diff.file} ===`);
          console.log("--- Expected ---");
          console.log(diff.expected);
          console.log("--- Actual ---");
          console.log(diff.actual);
        }
        expect(result.diffs).toHaveLength(0);
      }
    });
  }
});
