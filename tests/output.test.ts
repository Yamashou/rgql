import { describe, test, expect } from "bun:test";
import {
  parsePromptAnswer,
  collectInteractiveDecisions,
  formatInteractiveResult,
} from "../src/shell/output";

describe("parsePromptAnswer", () => {
  test("y → yes", () => expect(parsePromptAnswer("y")).toBe("yes"));
  test("Y → yes", () => expect(parsePromptAnswer("Y")).toBe("yes"));
  test("yes → yes", () => expect(parsePromptAnswer("yes")).toBe("yes"));
  test("n → no", () => expect(parsePromptAnswer("n")).toBe("no"));
  test("q → quit", () => expect(parsePromptAnswer("q")).toBe("quit"));
  test("quit → quit", () => expect(parsePromptAnswer("quit")).toBe("quit"));
  test("empty → no", () => expect(parsePromptAnswer("")).toBe("no"));
  test("garbage → no", () => expect(parsePromptAnswer("abc")).toBe("no"));
  test("trims whitespace", () => expect(parsePromptAnswer("  y  ")).toBe("yes"));
});

describe("collectInteractiveDecisions", () => {
  test("all yes → all-accepted", () => {
    const result = collectInteractiveDecisions(["yes", "yes", "yes"], 3);
    expect(result).toEqual({ kind: "all-accepted", count: 3 });
  });

  test("some no → partial", () => {
    const result = collectInteractiveDecisions(["yes", "no", "yes"], 3);
    expect(result).toEqual({ kind: "partial", accepted: 2, total: 3 });
  });

  test("quit mid-way → aborted", () => {
    const result = collectInteractiveDecisions(["yes", "quit"], 3);
    expect(result).toEqual({ kind: "aborted" });
  });

  test("all no → partial with 0 accepted", () => {
    const result = collectInteractiveDecisions(["no", "no"], 2);
    expect(result).toEqual({ kind: "partial", accepted: 0, total: 2 });
  });
});

describe("formatInteractiveResult", () => {
  test("all-accepted", () => {
    expect(formatInteractiveResult({ kind: "all-accepted", count: 5 })).toContain(
      "5 occurrences updated",
    );
  });

  test("partial", () => {
    expect(formatInteractiveResult({ kind: "partial", accepted: 2, total: 5 })).toContain(
      "not yet supported",
    );
  });

  test("aborted", () => {
    expect(formatInteractiveResult({ kind: "aborted" })).toBe("Aborted.");
  });
});
