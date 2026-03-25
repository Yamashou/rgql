import { describe, test, expect } from "bun:test";
import {
  formatDryRunOutput,
  formatWriteOutput,
  formatInterfaceSkipWarning,
  formatInterfacePrompt,
  formatInteractiveChange,
} from "../src/shell/output";
import type { RenamePlan, InterfaceImpact } from "../src/types/domain";
import { toFilePath } from "../src/types/domain";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<RenamePlan>): RenamePlan {
  return {
    changes: [
      {
        category: "schema",
        filePath: toFilePath("/project/schema.graphql"),
        line: 5,
        oldText: "User",
        newText: "Account",
      },
      {
        category: "document",
        filePath: toFilePath("/project/src/query.ts"),
        line: 10,
        oldText: "User",
        newText: "Account",
        tagName: "graphql",
      },
    ],
    fileUpdates: [],
    warnings: [],
    ...overrides,
  };
}

const impact: InterfaceImpact = {
  interfaceName: "Node",
  fieldName: "name",
  implementingTypes: [{ typeName: "User" }, { typeName: "Admin" }],
};

// ---------------------------------------------------------------------------
// formatDryRunOutput
// ---------------------------------------------------------------------------

describe("formatDryRunOutput", () => {
  test("includes config file path and project name", () => {
    const output = formatDryRunOutput(
      makePlan(),
      "/project/graphql.config.yml",
      ["schema/**/*.graphql"],
      ["src/**/*.ts"],
      "default",
    );
    expect(output).toContain("/project/graphql.config.yml");
    expect(output).toContain("default");
  });

  test("includes schema and document patterns", () => {
    const output = formatDryRunOutput(
      makePlan(),
      "/config",
      ["schema/**/*.graphql"],
      ["src/**/*.ts"],
      "default",
    );
    expect(output).toContain("schema/**/*.graphql");
    expect(output).toContain("src/**/*.ts");
  });

  test("shows file count and occurrence count", () => {
    const output = formatDryRunOutput(makePlan(), "/config", [], [], "default");
    expect(output).toContain("2 files");
    expect(output).toContain("2 occurrences");
  });

  test("shows old → new text for each change", () => {
    const output = formatDryRunOutput(makePlan(), "/config", [], [], "default");
    expect(output).toContain("User → Account");
  });

  test("shows [schema] tag for schema changes", () => {
    const output = formatDryRunOutput(makePlan(), "/config", [], [], "default");
    expect(output).toContain("[schema]");
  });

  test("shows [document] tag for document changes", () => {
    const output = formatDryRunOutput(makePlan(), "/config", [], [], "default");
    expect(output).toContain("[document]");
  });

  test("includes dry run hint", () => {
    const output = formatDryRunOutput(makePlan(), "/config", [], [], "default");
    expect(output).toContain("Dry run. Use --write to apply.");
  });
});

// ---------------------------------------------------------------------------
// formatWriteOutput
// ---------------------------------------------------------------------------

describe("formatWriteOutput", () => {
  test("shows checkmark per change", () => {
    const output = formatWriteOutput(makePlan());
    const lines = output.split("\n").filter((line) => line.startsWith("✓"));
    expect(lines).toHaveLength(2);
  });

  test("includes file path and line number", () => {
    const output = formatWriteOutput(makePlan());
    expect(output).toContain("/project/schema.graphql:5");
    expect(output).toContain("/project/src/query.ts:10");
  });

  test("shows summary count", () => {
    const output = formatWriteOutput(makePlan());
    expect(output).toContain("2 files");
    expect(output).toContain("2 occurrences updated.");
  });
});

// ---------------------------------------------------------------------------
// formatInterfaceSkipWarning
// ---------------------------------------------------------------------------

describe("formatInterfaceSkipWarning", () => {
  test("includes interface name", () => {
    const output = formatInterfaceSkipWarning(impact);
    expect(output).toContain("Node");
  });

  test("includes field name", () => {
    const output = formatInterfaceSkipWarning(impact);
    expect(output).toContain("name");
  });

  test("lists implementing types", () => {
    const output = formatInterfaceSkipWarning(impact);
    expect(output).toContain("User");
    expect(output).toContain("Admin");
  });

  test("includes remediation hint", () => {
    const output = formatInterfaceSkipWarning(impact);
    expect(output).toContain("--force");
  });
});

// ---------------------------------------------------------------------------
// formatInterfacePrompt
// ---------------------------------------------------------------------------

describe("formatInterfacePrompt", () => {
  test("includes interface name and field name", () => {
    const output = formatInterfacePrompt(impact);
    expect(output).toContain("Node");
    expect(output).toContain("name");
  });

  test("lists each implementing type with field", () => {
    const output = formatInterfacePrompt(impact);
    expect(output).toContain("User.name");
    expect(output).toContain("Admin.name");
  });
});

// ---------------------------------------------------------------------------
// formatInteractiveChange
// ---------------------------------------------------------------------------

describe("formatInteractiveChange", () => {
  test("shows index as 1-based", () => {
    const output = formatInteractiveChange(0, 5, "/file.ts", 10, "old", "new");
    expect(output).toContain("[1/5]");
  });

  test("includes file path and line", () => {
    const output = formatInteractiveChange(2, 5, "/project/file.ts", 42, "old", "new");
    expect(output).toContain("/project/file.ts:42");
  });

  test("shows old and new text with diff markers", () => {
    const output = formatInteractiveChange(0, 1, "/f.ts", 1, "oldName", "newName");
    expect(output).toContain("- oldName");
    expect(output).toContain("+ newName");
  });
});
