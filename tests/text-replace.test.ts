import { describe, test, expect } from "bun:test";
import { applyReplacements } from "../src/core/text-replace";

describe("applyReplacements", () => {
  test("applies a single replacement", () => {
    const result = applyReplacements("hello world", [{ start: 0, end: 5, newText: "goodbye" }]);
    expect(result).toBe("goodbye world");
  });

  test("applies multiple non-overlapping replacements", () => {
    const result = applyReplacements("aaa bbb ccc", [
      { start: 0, end: 3, newText: "xxx" },
      { start: 4, end: 7, newText: "yyy" },
      { start: 8, end: 11, newText: "zzz" },
    ]);
    expect(result).toBe("xxx yyy zzz");
  });

  test("handles replacements with different lengths", () => {
    const result = applyReplacements("type User {", [{ start: 5, end: 9, newText: "Account" }]);
    expect(result).toBe("type Account {");
  });

  test("handles replacement to shorter text", () => {
    const result = applyReplacements("type LongTypeName {", [
      { start: 5, end: 17, newText: "Short" },
    ]);
    expect(result).toBe("type Short {");
  });

  test("deduplicates replacements by start offset (first wins)", () => {
    const result = applyReplacements("hello", [
      { start: 0, end: 5, newText: "first" },
      { start: 0, end: 5, newText: "second" },
    ]);
    expect(result).toBe("first");
  });

  test("returns original content when no replacements", () => {
    const result = applyReplacements("unchanged", []);
    expect(result).toBe("unchanged");
  });

  test("applies replacements regardless of input order", () => {
    const result = applyReplacements("aaa bbb", [
      { start: 4, end: 7, newText: "yyy" },
      { start: 0, end: 3, newText: "xxx" },
    ]);
    expect(result).toBe("xxx yyy");
  });

  test("handles replacement at end of string", () => {
    const result = applyReplacements("hello world", [{ start: 6, end: 11, newText: "earth" }]);
    expect(result).toBe("hello earth");
  });

  test("handles replacement of entire string", () => {
    const result = applyReplacements("old", [{ start: 0, end: 3, newText: "new" }]);
    expect(result).toBe("new");
  });

  test("handles multiline content", () => {
    const content = "type User {\n  name: String\n  age: Int\n}";
    const result = applyReplacements(content, [
      { start: 5, end: 9, newText: "Account" },
      { start: 14, end: 18, newText: "fullName" },
    ]);
    expect(result).toBe("type Account {\n  fullName: String\n  age: Int\n}");
  });
});
