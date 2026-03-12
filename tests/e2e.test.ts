import { describe, it, expect } from "vitest";
import { compile } from "@compiler/compile";

describe("End-to-end compilation", () => {
  function compileToJS(src: string, minify = false): string {
    return compile(src, { minify }).js;
  }

  // ── Hello World ──────────────────────────────────────────
  describe("basic programs", () => {
    it("compiles hello world", () => {
      const js = compileToJS('fn greet(name) {\n  print("Hello {name}")\n}\ngreet("World")');
      expect(js).toContain("function greet(name)");
      expect(js).toContain("console.log");
      expect(js).toContain("greet(\"World\")");
    });

    it("compiles variable assignment", () => {
      const js = compileToJS("x = 42");
      expect(js).toContain("let x = 42;");
    });

    it("compiles const declaration", () => {
      const js = compileToJS("const PI = 3.14");
      expect(js).toContain("const PI = 3.14;");
    });
  });

  // ── Implicit Returns ─────────────────────────────────────
  describe("implicit returns", () => {
    it("adds return to single-expression functions", () => {
      const js = compileToJS("fn double(x) { x * 2 }");
      expect(js).toContain("return x * 2;");
    });

    it("does not add return to multi-statement functions", () => {
      const js = compileToJS("fn test() { x = 1\n return x }");
      // Should have explicit return, not double return
      expect(js.match(/return/g)?.length).toBe(1);
    });
  });

  // ── Equality Compilation ─────────────────────────────────
  describe("strict equality", () => {
    it("compiles == to ===", () => {
      const js = compileToJS("if x == 5 { print(x) }");
      expect(js).toContain("===");
      expect(js).not.toMatch(/[^=]==\s/); // no standalone ==
    });

    it("compiles != to !==", () => {
      const js = compileToJS("if x != 5 { print(x) }");
      expect(js).toContain("!==");
    });

    it("passes through === as-is", () => {
      const js = compileToJS("if x === 5 { print(x) }");
      expect(js).toContain("===");
    });
  });

  // ── For Loop Compilation ─────────────────────────────────
  describe("for loops", () => {
    it("compiles range loop to C-style for", () => {
      const js = compileToJS("for i in 0..10 { print(i) }");
      expect(js).toContain("for (let i = 0; i <= 10; i++)");
    });

    it("compiles iterable loop to for-of", () => {
      const js = compileToJS("for item in items { print(item) }");
      expect(js).toContain("for (const item of items)");
    });
  });

  // ── String Interpolation ─────────────────────────────────
  describe("string interpolation", () => {
    it("converts {expr} to ${expr} template literal", () => {
      const js = compileToJS('print("Hello {name}")');
      expect(js).toContain("`Hello ${name}`");
    });

    it("keeps single-quoted strings literal", () => {
      const js = compileToJS("x = '{not interpolated}'");
      // Should be a JSON-escaped string, not a template literal
      expect(js).not.toContain("`");
      expect(js).toContain('"');
    });

    it("handles backtick template literals", () => {
      const js = compileToJS("x = `Hello ${name}`");
      expect(js).toContain("`Hello ${name}`");
    });
  });

  // ── New Features ─────────────────────────────────────────
  describe("new language features", () => {
    it("compiles switch statement", () => {
      const js = compileToJS('switch x {\n  case 1 { print("one") }\n  default { print("other") }\n}');
      expect(js).toContain("switch (x)");
      expect(js).toContain("case 1:");
      expect(js).toContain("default:");
    });

    it("compiles do-while", () => {
      const js = compileToJS("do { x = x - 1 } while x > 0");
      expect(js).toContain("do {");
      expect(js).toContain("} while (x > 0);");
    });

    it("compiles compound assignment", () => {
      const js = compileToJS("x += 10");
      expect(js).toContain("x += 10;");
    });

    it("compiles optional chaining", () => {
      const js = compileToJS("x = obj?.prop");
      expect(js).toContain("obj?.prop");
    });

    it("compiles nullish coalescing", () => {
      const js = compileToJS("x = a ?? b");
      expect(js).toContain("a ?? b");
    });

    it("compiles typeof", () => {
      const js = compileToJS("x = typeof y");
      expect(js).toContain("typeof y");
    });

    it("compiles try-catch-finally", () => {
      const js = compileToJS("try { x = 1 } catch (e) { print(e) } finally { cleanup() }");
      expect(js).toContain("try {");
      expect(js).toContain("catch (e)");
      expect(js).toContain("finally {");
    });

    it("compiles break and continue", () => {
      const js = compileToJS("for i in 0..10 {\n  if i == 5 { break }\n  if i == 3 { continue }\n}");
      expect(js).toContain("break;");
      expect(js).toContain("continue;");
    });
  });

  // ── Class Compilation ────────────────────────────────────
  describe("classes", () => {
    it("compiles class with constructor", () => {
      const js = compileToJS("class Dog {\n  constructor(name) {\n    this.name = name\n  }\n}");
      expect(js).toContain("class Dog {");
      expect(js).toContain("constructor(name)");
      expect(js).toContain("this.name = name;");
    });

    it("compiles class with extends", () => {
      const js = compileToJS("class Dog extends Animal {\n  constructor(name) {\n    this.name = name\n  }\n}");
      expect(js).toContain("class Dog extends Animal");
    });

    it("compiles async method", () => {
      const js = compileToJS("class Api {\n  async fn fetch(url) {\n    return url\n  }\n}");
      expect(js).toContain("async fetch(url)");
    });
  });

  // ── Minification ─────────────────────────────────────────
  describe("minification", () => {
    it("removes newlines and spaces when minified", () => {
      const js = compileToJS("fn add(a, b) { a + b }", true);
      expect(js).not.toContain("\n");
    });
  });

  // ── Import/Export ────────────────────────────────────────
  describe("imports and exports", () => {
    it("compiles default import", () => {
      const js = compileToJS('import fs from "fs"');
      expect(js).toContain('import fs from "fs";');
    });

    it("compiles named imports", () => {
      const js = compileToJS('import { readFile } from "fs"');
      expect(js).toContain("import { readFile }");
    });

    it("compiles export", () => {
      const js = compileToJS("export fn add(a, b) { a + b }");
      expect(js).toContain("export function add(a, b)");
    });
  });

  // ── Destructuring ─────────────────────────────────────────
  describe("destructuring", () => {
    it("compiles object destructuring", () => {
      const js = compileToJS("const { name, age } = person");
      expect(js).toContain("const { name, age } = person;");
    });

    it("compiles array destructuring", () => {
      const js = compileToJS("const [first, second] = arr");
      expect(js).toContain("const [first, second] = arr;");
    });

    it("compiles destructuring with rename", () => {
      const js = compileToJS("const { name: n } = obj");
      expect(js).toContain("name: n");
    });

    it("compiles destructuring with defaults", () => {
      const js = compileToJS("const { x = 0 } = point");
      expect(js).toContain("x = 0");
    });

    it("compiles destructuring with rest", () => {
      const js = compileToJS("const { a, ...rest } = obj");
      expect(js).toContain("...rest");
    });

    it("compiles array destructuring with rest", () => {
      const js = compileToJS("const [head, ...tail] = arr");
      expect(js).toContain("[head, ...tail]");
    });

    it("compiles nested destructuring", () => {
      const js = compileToJS("const { user: { name } } = data");
      expect(js).toContain("user: { name }");
    });

    it("compiles destructuring in for-in", () => {
      const js = compileToJS("for { name } in users { print(name) }");
      expect(js).toContain("for (const { name } of users)");
    });

    it("compiles destructuring in function params", () => {
      const js = compileToJS("fn greet({ name }) { print(name) }");
      expect(js).toContain("function greet({ name })");
    });
  });
});
