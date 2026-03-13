import { describe, it, expect } from "vitest";
import { compile, compileWithSourceMap } from "@compiler/compile";

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

  // ── Type Annotations (stripped in output) ─────────────────
  describe("type annotations", () => {
    it("strips type from variable declaration", () => {
      const js = compileToJS("let x: number = 42");
      expect(js).toContain("let x = 42;");
      expect(js).not.toContain("number");
    });

    it("strips type from const declaration", () => {
      const js = compileToJS("const name: string = 'hello'");
      expect(js).toContain('const name = "hello";');
      expect(js).not.toContain(": string");
    });

    it("strips param types from function", () => {
      const js = compileToJS("fn add(a: number, b: number) { return a + b }");
      expect(js).toContain("function add(a, b)");
      expect(js).not.toContain("number");
    });

    it("strips return type from function", () => {
      const js = compileToJS("fn greet(name: string): string { return name }");
      expect(js).toContain("function greet(name)");
      expect(js).not.toContain(": string");
    });

    it("strips array type annotation", () => {
      const js = compileToJS("let items: number[] = [1, 2, 3]");
      expect(js).toContain("let items = [1, 2, 3];");
    });

    it("strips union type annotation", () => {
      const js = compileToJS("let value: string | number = 42");
      expect(js).toContain("let value = 42;");
    });

    it("strips generic type annotation", () => {
      const js = compileToJS("let p: Promise<string> = fetch('url')");
      expect(js).toContain("let p = fetch(\"url\");");
    });
  });

  // ── Pattern Matching ──────────────────────────────────────
  describe("pattern matching", () => {
    it("compiles match to if/else if chain", () => {
      const js = compileToJS('match x {\n  case 1 { print("one") }\n  case 2 { print("two") }\n}');
      expect(js).toContain("if (x === 1)");
      expect(js).toContain("else if (x === 2)");
    });

    it("compiles match with default to else", () => {
      const js = compileToJS('match x {\n  case 1 { print("one") }\n  default { print("other") }\n}');
      expect(js).toContain("if (x === 1)");
      expect(js).toContain("else {");
    });

    it("compiles match with string patterns", () => {
      const js = compileToJS('match color {\n  case "red" { print("stop") }\n  case "green" { print("go") }\n}');
      expect(js).toContain('if (color === "red")');
      expect(js).toContain('else if (color === "green")');
    });

    it("compiles match with guard clause", () => {
      const js = compileToJS('match x {\n  case 1 if y > 0 { print("yes") }\n}');
      expect(js).toContain("if (x === 1 && y > 0)");
    });
  });

  // ── Source Maps ───────────────────────────────────────────
  describe("source maps", () => {
    it("generates a valid v3 source map", () => {
      const result = compileWithSourceMap("let x = 42", "test.no", "test.js");
      expect(result.sourceMap.version).toBe(3);
      expect(result.sourceMap.sources).toContain("test.no");
      expect(result.sourceMap.file).toBe("test.js");
      expect(typeof result.sourceMap.mappings).toBe("string");
    });

    it("includes sourceMappingURL comment", () => {
      const result = compileWithSourceMap("let x = 42", "test.no", "test.js");
      expect(result.js).toContain("//# sourceMappingURL=test.js.map");
    });

    it("includes source content in source map", () => {
      const src = "let x = 42\nlet y = 10";
      const result = compileWithSourceMap(src, "test.no", "test.js");
      expect(result.sourceMap.sourcesContent[0]).toBe(src);
    });

    it("generates mappings for multi-line source", () => {
      const src = "let x = 42\nlet y = 10\nprint(x + y)";
      const result = compileWithSourceMap(src, "test.no", "test.js");
      expect(result.sourceMap.mappings.length).toBeGreaterThan(0);
    });
  });

  // ── Enums ───────────────────────────────────────────────────
  describe("enums", () => {
    it("compiles basic enum to Object.freeze", () => {
      const js = compileToJS("enum Color { Red, Green, Blue }");
      expect(js).toContain("const Color = Object.freeze(");
      expect(js).toContain("Red: 0");
      expect(js).toContain("Green: 1");
      expect(js).toContain("Blue: 2");
    });

    it("compiles enum with custom values", () => {
      const js = compileToJS("enum Status { OK = 200, NotFound = 404 }");
      expect(js).toContain("OK: 200");
      expect(js).toContain("NotFound: 404");
    });

    it("compiles enum with string values", () => {
      const js = compileToJS('enum Dir { Up = "UP", Down = "DOWN" }');
      expect(js).toContain('Up: "UP"');
      expect(js).toContain('Down: "DOWN"');
    });

    it("auto-increments after custom value", () => {
      const js = compileToJS("enum Level { Low, Medium = 5, High }");
      expect(js).toContain("Low: 0");
      expect(js).toContain("Medium: 5");
      expect(js).toContain("High: 6");
    });
  });

  // ── Pipe Operator ──────────────────────────────────────────
  describe("pipe operator", () => {
    it("compiles single pipe to function call", () => {
      const js = compileToJS("x |> double");
      expect(js).toContain("double(x)");
    });

    it("compiles chained pipes to nested calls", () => {
      const js = compileToJS("x |> double |> toString");
      expect(js).toContain("toString(double(x))");
    });

    it("compiles pipe with expression on left", () => {
      const js = compileToJS("x + 1 |> double");
      expect(js).toContain("double(x + 1)");
    });
  });

  // ── Interfaces ─────────────────────────────────────────────
  describe("interfaces", () => {
    it("strips interface declarations from JS output", () => {
      const js = compileToJS("interface User { name: string, age: number }");
      expect(js.trim()).toBe("");
    });

    it("strips interface but keeps other statements", () => {
      const js = compileToJS("interface Shape { area(): number }\nlet x = 42");
      expect(js).not.toContain("interface");
      expect(js).toContain("let x = 42");
    });

    it("strips interface with extends", () => {
      const js = compileToJS("interface Admin extends User { role: string }");
      expect(js.trim()).toBe("");
    });
  });

  // ── Regex Literals ──────────────────────────────────────────
  describe("regex literals", () => {
    it("compiles basic regex", () => {
      const js = compileToJS("let re = /hello/");
      expect(js).toContain("/hello/");
    });

    it("compiles regex with flags", () => {
      const js = compileToJS("let re = /pattern/gi");
      expect(js).toContain("/pattern/gi");
    });

    it("compiles regex with character class", () => {
      const js = compileToJS("let re = /[a-z]+/");
      expect(js).toContain("/[a-z]+/");
    });

    it("compiles regex with escape sequences", () => {
      const js = compileToJS("let re = /\\d+\\.\\d+/");
      expect(js).toContain("/\\d+\\.\\d+/");
    });

    it("compiles regex in conditional", () => {
      const js = compileToJS('if /test/.test(str) { print("match") }');
      expect(js).toContain("/test/");
      expect(js).toContain(".test(str)");
    });

    it("does not confuse division with regex", () => {
      const js = compileToJS("x = a / b");
      expect(js).not.toContain("RegExp");
      expect(js).toContain("a / b");
    });

    it("compiles regex assignment", () => {
      const js = compileToJS("const pattern = /^[A-Z][a-z]+$/i");
      expect(js).toContain("/^[A-Z][a-z]+$/i");
    });
  });

  // ── Class Static Members ────────────────────────────────────
  describe("class static members", () => {
    it("compiles static method", () => {
      const js = compileToJS("class Util {\n  static fn create() {\n    return new Util()\n  }\n}");
      expect(js).toContain("static create()");
    });

    it("compiles static field", () => {
      const js = compileToJS("class Config {\n  static defaultTimeout = 3000\n}");
      expect(js).toContain("static defaultTimeout");
      expect(js).toContain("3000");
    });

    it("compiles async static method", () => {
      const js = compileToJS("class Api {\n  static async fn fetch(url) {\n    return url\n  }\n}");
      expect(js).toContain("static async fetch(url)");
    });
  });

  // ── Class Fields ────────────────────────────────────────────
  describe("class fields", () => {
    it("compiles class field with value", () => {
      const js = compileToJS("class Counter {\n  count = 0\n}");
      expect(js).toContain("count = 0;");
    });

    it("compiles class field without value", () => {
      const js = compileToJS("class Point {\n  x\n  y\n}");
      expect(js).toContain("x;");
      expect(js).toContain("y;");
    });

    it("compiles class with fields and methods", () => {
      const js = compileToJS("class Dog {\n  name = 'Rex'\n  constructor(n) {\n    this.name = n\n  }\n  fn bark() { print(this.name) }\n}");
      expect(js).toContain("name = \"Rex\";");
      expect(js).toContain("constructor(n)");
      expect(js).toContain("bark()");
    });
  });

  // ── Getters and Setters ─────────────────────────────────────
  describe("getters and setters", () => {
    it("compiles getter", () => {
      const js = compileToJS("class Circle {\n  get area() {\n    return 3.14 * this.r * this.r\n  }\n}");
      expect(js).toContain("get area()");
    });

    it("compiles setter", () => {
      const js = compileToJS("class Box {\n  set width(w) {\n    this._w = w\n  }\n}");
      expect(js).toContain("set width(w)");
    });

    it("compiles getter and setter together", () => {
      const js = compileToJS("class Temp {\n  get value() { return this._v }\n  set value(v) { this._v = v }\n}");
      expect(js).toContain("get value()");
      expect(js).toContain("set value(v)");
    });
  });

  // ── Computed Property Names ─────────────────────────────────
  describe("computed property names", () => {
    it("compiles computed property in object", () => {
      const js = compileToJS('const key = "name"\nconst obj = { [key]: "Alice" }');
      expect(js).toContain("[key]:");
    });

    it("compiles computed method in class", () => {
      const js = compileToJS('class Foo {\n  [Symbol.iterator]() {\n    return this\n  }\n}');
      expect(js).toContain("[Symbol.iterator]()");
    });
  });

  // ── Optional Call and Index ─────────────────────────────────
  describe("optional call and index", () => {
    it("compiles optional call ?.()", () => {
      const js = compileToJS("const result = callback?.(1, 2)");
      expect(js).toContain("callback?.(1, 2)");
    });

    it("compiles optional index ?.[]", () => {
      const js = compileToJS('const val = obj?.["key"]');
      expect(js).toContain('obj?.["key"]');
    });

    it("compiles chained optional operations", () => {
      const js = compileToJS("const x = a?.b?.c");
      expect(js).toContain("a?.b?.c");
    });

    it("compiles optional property access (already existed)", () => {
      const js = compileToJS("const x = user?.name");
      expect(js).toContain("user?.name");
    });
  });

  // ── Export Default ──────────────────────────────────────────
  describe("export default", () => {
    it("compiles export default function", () => {
      const js = compileToJS("export default fn add(a, b) { return a + b }");
      expect(js).toContain("export default function add(a, b)");
    });

    it("compiles export default class", () => {
      const js = compileToJS("export default class App {}");
      expect(js).toContain("export default class App");
    });

    it("compiles regular export (not default)", () => {
      const js = compileToJS("export const PI = 3.14");
      expect(js).toContain("export const PI");
      expect(js).not.toContain("default");
    });
  });

  // ── For-In / For-Of Loops ───────────────────────────────────
  describe("for-in and for-of loops", () => {
    it("compiles for-in as JS for-of (values, backward compat)", () => {
      const js = compileToJS("for item in items { print(item) }");
      expect(js).toContain("for (const item of items)");
    });

    it("compiles for-of as JS for-in (keys)", () => {
      const js = compileToJS("for key of obj { print(key) }");
      expect(js).toContain("for (const key in obj)");
    });

    it("range loop still works", () => {
      const js = compileToJS("for i in 0..5 { print(i) }");
      expect(js).toContain("for (let i = 0; i <= 5; i++)");
    });
  });

  // ── Bitwise Compound Assignments ────────────────────────────
  describe("bitwise compound assignments", () => {
    it("compiles &= operator", () => {
      const js = compileToJS("x &= 0xFF");
      expect(js).toContain("&=");
    });

    it("compiles |= operator", () => {
      const js = compileToJS("x |= 0x01");
      expect(js).toContain("|=");
    });

    it("compiles <<= operator", () => {
      const js = compileToJS("x <<= 2");
      expect(js).toContain("<<=");
    });
  });

  // ── Generator Functions ─────────────────────────────────────
  describe("generator functions", () => {
    it("compiles fn* as function*", () => {
      const js = compileToJS("fn* range(n) {\n  for i in 0..n {\n    yield i\n  }\n}");
      expect(js).toContain("function* range(n)");
    });

    it("compiles yield expression", () => {
      const js = compileToJS("fn* gen() {\n  yield 1\n  yield 2\n}");
      expect(js).toContain("function* gen()");
      expect(js).toContain("yield 1");
      expect(js).toContain("yield 2");
    });

    it("compiles yield* delegate", () => {
      const js = compileToJS("fn* combined() {\n  yield* gen1()\n  yield* gen2()\n}");
      expect(js).toContain("function* combined()");
      expect(js).toContain("yield* gen1()");
    });

    it("compiles async fn* as async function*", () => {
      const js = compileToJS("async fn* stream() {\n  yield 1\n}");
      expect(js).toContain("async function* stream()");
    });
  });

  // ── Labeled Statements ──────────────────────────────────────
  describe("labeled statements", () => {
    it("compiles labeled for loop with break label", () => {
      const js = compileToJS("outer: for i in 0..10 {\n  break outer\n}");
      expect(js).toContain("outer:");
      expect(js).toContain("break outer;");
    });

    it("compiles labeled while with continue label", () => {
      const js = compileToJS("loop: while true {\n  continue loop\n}");
      expect(js).toContain("loop:");
      expect(js).toContain("continue loop;");
    });

    it("plain break still works", () => {
      const js = compileToJS("for i in 0..5 { break }");
      expect(js).toContain("break;");
    });
  });

  // ── Private Fields ──────────────────────────────────────────
  describe("private fields", () => {
    it("compiles private class field", () => {
      const js = compileToJS("class Counter {\n  #count = 0\n}");
      expect(js).toContain("#count = 0;");
    });

    it("compiles private field access", () => {
      const js = compileToJS("class Box {\n  #value = 0\n  fn get() {\n    return this.#value\n  }\n}");
      expect(js).toContain("#value = 0;");
      expect(js).toContain("this.#value");
    });

    it("compiles static private field", () => {
      const js = compileToJS("class Registry {\n  static #instances = 0\n}");
      expect(js).toContain("static #instances");
    });
  });
});
