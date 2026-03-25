import { describe, test, expect } from "bun:test";
import { buildSchema } from "graphql";
import {
  parseFieldArgument,
  validateRenameType,
  validateRenameField,
  validateRenameFragment,
  formatValidationError,
} from "../src/core/validate";
import type {
  TypeName,
  FieldName,
  FragmentName,
  EmbeddedQueryContent,
  ValidationError,
} from "../src/types/domain";
import { toTypeName, toFieldName, toFragmentName, toFilePath } from "../src/types/domain";
import { parse } from "graphql";

// ---------------------------------------------------------------------------
// parseFieldArgument
// ---------------------------------------------------------------------------

describe("parseFieldArgument", () => {
  test("parses valid Type.field format", () => {
    const result = parseFieldArgument("User.firstName");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.typeName).toBe(toTypeName("User"));
      expect(result.value.fieldName).toBe(toFieldName("firstName"));
    }
  });

  test("returns error for missing dot separator", () => {
    const result = parseFieldArgument("UserFirstName");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-field-format");
    }
  });

  test("returns error for too many dots", () => {
    const result = parseFieldArgument("User.first.Name");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-field-format");
    }
  });

  test("returns error for empty type name", () => {
    const result = parseFieldArgument(".firstName");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-field-format");
    }
  });

  test("returns error for empty field name", () => {
    const result = parseFieldArgument("User.");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-field-format");
    }
  });

  test("returns error for empty string", () => {
    const result = parseFieldArgument("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-field-format");
    }
  });
});

// ---------------------------------------------------------------------------
// validateRenameType
// ---------------------------------------------------------------------------

const schema = buildSchema(`
  type Query {
    user: User
    post: Post
  }
  type User {
    id: ID!
    name: String!
  }
  type Post {
    id: ID!
    title: String!
  }
  input CreateUserInput {
    name: String!
  }
  interface Node {
    id: ID!
  }
`);

describe("validateRenameType", () => {
  test("ok when old type exists and new type does not", () => {
    const result = validateRenameType(schema, toTypeName("User"), toTypeName("Account"));
    expect(result.ok).toBe(true);
  });

  test("error when old type does not exist", () => {
    const result = validateRenameType(schema, toTypeName("NonExistent"), toTypeName("Account"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: "type-not-found", typeName: "NonExistent" });
    }
  });

  test("error when new type already exists", () => {
    const result = validateRenameType(schema, toTypeName("User"), toTypeName("Post"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: "type-already-exists", typeName: "Post" });
    }
  });
});

// ---------------------------------------------------------------------------
// validateRenameField
// ---------------------------------------------------------------------------

describe("validateRenameField", () => {
  test("ok when field exists and new name does not", () => {
    const result = validateRenameField(
      schema,
      toTypeName("User"),
      toFieldName("name"),
      toFieldName("fullName"),
    );
    expect(result.ok).toBe(true);
  });

  test("error when type does not exist", () => {
    const result = validateRenameField(
      schema,
      toTypeName("NonExistent"),
      toFieldName("name"),
      toFieldName("fullName"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("type-not-found");
    }
  });

  test("error when field does not exist", () => {
    const result = validateRenameField(
      schema,
      toTypeName("User"),
      toFieldName("nonExistent"),
      toFieldName("fullName"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("field-not-found");
    }
  });

  test("error when new field already exists", () => {
    const result = validateRenameField(
      schema,
      toTypeName("User"),
      toFieldName("name"),
      toFieldName("id"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "field-already-exists",
        typeName: "User",
        fieldName: "id",
      });
    }
  });

  test("works with input types", () => {
    const result = validateRenameField(
      schema,
      toTypeName("CreateUserInput"),
      toFieldName("name"),
      toFieldName("fullName"),
    );
    expect(result.ok).toBe(true);
  });

  test("works with interface types", () => {
    const result = validateRenameField(
      schema,
      toTypeName("Node"),
      toFieldName("id"),
      toFieldName("nodeId"),
    );
    expect(result.ok).toBe(true);
  });

  test("error when type has no fields (scalar-like)", () => {
    const result = validateRenameField(
      schema,
      toTypeName("String"),
      toFieldName("length"),
      toFieldName("size"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("field-not-found");
    }
  });
});

// ---------------------------------------------------------------------------
// validateRenameFragment
// ---------------------------------------------------------------------------

function makeQueryContent(graphqlSource: string): EmbeddedQueryContent {
  return {
    filePath: toFilePath("/test.ts"),
    fileContent: graphqlSource,
    queryContent: graphqlSource,
    document: parse(graphqlSource),
    startOffset: 0,
    endOffset: graphqlSource.length,
    line: 1,
    tagName: "file",
  };
}

describe("validateRenameFragment", () => {
  const queries = [
    makeQueryContent(`
      fragment UserFields on User {
        id
        name
      }
    `),
  ];

  test("ok when fragment exists", () => {
    const result = validateRenameFragment(queries, toFragmentName("UserFields"));
    expect(result.ok).toBe(true);
  });

  test("error when fragment does not exist", () => {
    const result = validateRenameFragment(queries, toFragmentName("NonExistent"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: "fragment-not-found", fragmentName: "NonExistent" });
    }
  });

  test("error when queries are empty", () => {
    const result = validateRenameFragment([], toFragmentName("UserFields"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("fragment-not-found");
    }
  });
});

// ---------------------------------------------------------------------------
// formatValidationError
// ---------------------------------------------------------------------------

describe("formatValidationError", () => {
  const cases: [ValidationError, string][] = [
    [{ kind: "type-not-found", typeName: "Foo" }, "Error: Type 'Foo' not found in schema."],
    [
      { kind: "type-already-exists", typeName: "Foo" },
      "Error: Type 'Foo' already exists in schema.",
    ],
    [
      { kind: "field-not-found", typeName: "User", fieldName: "age" },
      "Error: Field 'age' not found on type 'User'.",
    ],
    [
      { kind: "field-already-exists", typeName: "User", fieldName: "id" },
      "Error: Field 'id' already exists on type 'User'.",
    ],
    [
      { kind: "fragment-not-found", fragmentName: "Frag" },
      "Error: Fragment 'Frag' not found in documents.",
    ],
    [
      { kind: "invalid-field-format", input: "bad" },
      "Error: Invalid field format 'bad'. Expected 'Type.field'.",
    ],
    [
      { kind: "type-name-mismatch", oldType: "A", newType: "B" },
      "Error: Type name must match between old and new field.",
    ],
    [
      { kind: "config-not-found" },
      "Error: graphql-config file not found. Specify with --config or create one.",
    ],
    [
      { kind: "schema-parse-error", filePath: "/a.graphql", message: "Syntax Error" },
      "Error: Schema parse error in /a.graphql: Syntax Error",
    ],
  ];

  for (const [error, expected] of cases) {
    test(`formats ${error.kind}`, () => {
      expect(formatValidationError(error)).toBe(expected);
    });
  }
});
