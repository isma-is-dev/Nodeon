import { describe, it, expect } from "vitest";
import { compile, compileWithSourceMap, compileToAST } from "@compiler/compile";
import { typeCheck } from "@compiler/type-checker";
import { Lexer } from "@lexer/lexer";

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

  // ── Dynamic Import ──────────────────────────────────────────
  describe("dynamic import", () => {
    it("compiles dynamic import expression", () => {
      const js = compileToJS('const mod = await import("./utils.js")');
      expect(js).toContain('import("./utils.js")');
    });

    it("compiles dynamic import with variable", () => {
      const js = compileToJS("const mod = await import(path)");
      expect(js).toContain("import(path)");
    });
  });

  // ── Type System ─────────────────────────────────────────────
  describe("type system", () => {
    it("strips variable type annotations", () => {
      const js = compileToJS('let name: string = "hello"');
      expect(js).toContain('let name = "hello"');
      expect(js).not.toContain("string");
    });

    it("strips function return type", () => {
      const js = compileToJS("fn add(a: number, b: number): number {\n  return a + b\n}");
      expect(js).toContain("function add(a, b)");
      expect(js).not.toContain("number");
    });

    it("strips as type assertion", () => {
      const js = compileToJS("const el = document.getElementById('app') as HTMLElement");
      expect(js).toContain("document.getElementById");
      expect(js).not.toContain("as");
      expect(js).not.toContain("HTMLElement");
    });

    it("strips generic type annotations", () => {
      const js = compileToJS("const items: Array<string> = []");
      expect(js).toContain("const items = []");
      expect(js).not.toContain("Array");
      expect(js).not.toContain("string");
    });

    it("strips union type annotations", () => {
      const js = compileToJS("let value: string | number = 42");
      expect(js).toContain("let value = 42");
      expect(js).not.toContain("|");
    });
  });

  // ── Export Variants ─────────────────────────────────────────
  describe("export variants", () => {
    it("compiles named export list", () => {
      const js = compileToJS("export { foo, bar }");
      expect(js).toContain("export { foo, bar }");
    });

    it("compiles re-export from module", () => {
      const js = compileToJS('export { utils } from "helpers"');
      expect(js).toContain('export { utils } from "helpers"');
    });

    it("compiles wildcard re-export", () => {
      const js = compileToJS('export * from "utils"');
      expect(js).toContain('export * from "utils"');
    });

    it("compiles wildcard re-export with alias", () => {
      const js = compileToJS('export * as helpers from "utils"');
      expect(js).toContain('export * as helpers from "utils"');
    });
  });

  // ── Import Source Rewriting ─────────────────────────────────
  describe("import source rewriting", () => {
    it("rewrites relative imports to .js", () => {
      const js = compileToJS('import { greet } from "./utils"');
      expect(js).toContain('"./utils.js"');
    });

    it("keeps bare imports unchanged", () => {
      const js = compileToJS('import express from "express"');
      expect(js).toContain('"express"');
    });

    it("rewrites re-export source to .js", () => {
      const js = compileToJS('export { helper } from "./helpers"');
      expect(js).toContain('"./helpers.js"');
    });
  });
});

// ── Type Checker ───────────────────────────────────────────────
describe("type checker", () => {
  function check(src: string) {
    const ast = compileToAST(src);
    return typeCheck(ast);
  }

  it("detects type mismatch on variable assignment", () => {
    const diags = check('let x: number = "hello"');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("not assignable");
    expect(diags[0].message).toContain("string");
    expect(diags[0].message).toContain("number");
  });

  it("accepts correct type assignment", () => {
    const diags = check("let x: number = 42");
    expect(diags.length).toBe(0);
  });

  it("detects return type mismatch", () => {
    const diags = check("fn greet(): number {\n  return \"hello\"\n}");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("return type");
  });

  it("infers literal types correctly", () => {
    // No errors because inference matches
    const diags = check("let x = 42\nlet y: number = x");
    expect(diags.length).toBe(0);
  });

  it("accepts union type assignment", () => {
    const diags = check('let x: string | number = "hello"');
    expect(diags.length).toBe(0);
  });

  it("reports no errors for unannotated code", () => {
    const diags = check('let x = 42\nlet y = "hello"\nprint(x)');
    expect(diags.length).toBe(0);
  });

  // ── Bare typed declarations ────────────────────────────────
  it("compiles bare typed declaration x: number = 3", () => {
    const js = compile("x: number = 3").js;
    expect(js).toContain("let x = 3;");
  });

  it("detects bare typed mismatch x: number = 'hello'", () => {
    const ast = compileToAST('x: number = "hello"');
    const diags = typeCheck(ast);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("not assignable");
  });

  it("accepts bare typed declaration with correct type", () => {
    const ast = compileToAST("x: string = \"hello\"");
    const diags = typeCheck(ast);
    expect(diags.length).toBe(0);
  });

  // ── Generics ─────────────────────────────────────────────────
  it("compiles generic function, stripping type params", () => {
    const js = compile("fn identity<T>(x: T): T { return x }").js;
    expect(js).toContain("function identity(x)");
    expect(js).not.toContain("<T>");
  });

  it("compiles generic class, stripping type params", () => {
    const js = compile("class Box<T> { fn get(): T { return this.value } }").js;
    expect(js).toContain("class Box {");
    expect(js).not.toContain("<T>");
  });

});

// ── Switch auto-break ───────────────────────────────────────────
describe("switch auto-break", () => {
  it("adds break to each case block automatically", () => {
    const js = compile('switch x {\n  case 1 { print("one") }\n  case 2 { print("two") }\n  default { print("other") }\n}').js;
    expect(js).toContain("break;");
    const breaks = js.match(/break;/g);
    expect(breaks?.length).toBe(3);
  });

  it("does not add break when case already has return", () => {
    const js = compile('fn test(x) {\n  switch x {\n    case 1 { return "one" }\n    default { return "other" }\n  }\n}').js;
    expect(js).not.toMatch(/return[^}]*break/);
  });

  it("does not add break when case already has throw", () => {
    const js = compile('switch x {\n  case 1 { throw new Error("bad") }\n  default { print("ok") }\n}').js;
    const breaks = js.match(/break;/g);
    expect(breaks?.length).toBe(1);
  });

  it("does not add break when case already has explicit break", () => {
    const js = compile('switch x {\n  case 1 { break }\n  default { print("ok") }\n}').js;
    const breaks = js.match(/break;/g);
    expect(breaks?.length).toBe(2);
  });
});

// ── Type-checker integration via compile() ──────────────────────
describe("type-checker integration", () => {
  it("returns empty diagnostics without --check", () => {
    const result = compile("let x: number = 42");
    expect(result.diagnostics).toEqual([]);
  });

  it("returns empty diagnostics when types are correct", () => {
    const result = compile("let x: number = 42", { check: true });
    expect(result.diagnostics).toEqual([]);
  });

  it("returns diagnostics for type mismatch with --check", () => {
    const result = compile('let x: number = "hello"', { check: true });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("not assignable");
  });

  it("checks function return types", () => {
    const result = compile('fn add(a: number, b: number): number {\n  return "oops"\n}', { check: true });
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

// ── Type alias declarations ─────────────────────────────────────
describe("type alias declarations", () => {
  it("parses and erases simple type alias", () => {
    const js = compile("type ID = string").js;
    expect(js.trim()).toBe("");
  });

  it("parses and erases union type alias", () => {
    const js = compile("type Result = string | number\nlet x = 42").js;
    expect(js).not.toContain("type ");
    expect(js).toContain("let x = 42;");
  });

  it("parses generic type alias", () => {
    const js = compile("type Pair<A, B> = { first: A, second: B }").js;
    expect(js.trim()).toBe("");
  });

  it("type alias does not affect subsequent code", () => {
    const js = compile('type Name = string\nlet name: Name = "hello"\nprint(name)').js;
    expect(js).toContain('let name = "hello";');
    expect(js).toContain("console.log(name)");
  });
});

// ── in operator for objects ─────────────────────────────────────
describe("in operator", () => {
  it("compiles 'key in obj' expression", () => {
    const js = compile('"name" in obj').js;
    expect(js).toContain('"name" in obj');
  });

  it("compiles in operator in if condition", () => {
    const js = compile('if "key" in obj {\n  print("found")\n}').js;
    expect(js).toContain('"key" in obj');
  });
});

// ── Import aliases ──────────────────────────────────────────────
describe("import aliases", () => {
  it("compiles import with alias", () => {
    const js = compile('import { readFile as rf } from "fs"').js;
    expect(js).toContain("readFile as rf");
  });

  it("compiles import with mixed aliases and plain", () => {
    const js = compile('import { readFile as rf, writeFile } from "fs"').js;
    expect(js).toContain("readFile as rf");
    expect(js).toContain("writeFile");
  });

  it("compiles import without alias unchanged", () => {
    const js = compile('import { readFile } from "fs"').js;
    expect(js).toContain("{ readFile }");
    expect(js).not.toContain(" as ");
  });
});

// ── Trailing commas ─────────────────────────────────────────────
describe("trailing commas", () => {
  it("allows trailing comma in function params", () => {
    const js = compile("fn test(a, b,) { return a + b }").js;
    expect(js).toContain("function test(a, b)");
  });

  it("allows trailing comma in call arguments", () => {
    const js = compile("test(1, 2,)").js;
    expect(js).toContain("test(1, 2)");
  });

  it("allows trailing comma in arrays", () => {
    const js = compile("let arr = [1, 2, 3,]").js;
    expect(js).toContain("[1, 2, 3]");
  });

  it("allows trailing comma in objects", () => {
    const js = compile("let obj = { a: 1, b: 2, }").js;
    expect(js).toContain("a: 1");
    expect(js).toContain("b: 2");
  });
});

// ── Export aliases ──────────────────────────────────────────────
describe("export aliases", () => {
  it("compiles export with alias", () => {
    const js = compile('export { foo as bar }').js;
    expect(js).toContain("foo as bar");
  });

  it("compiles export with mixed aliases and plain", () => {
    const js = compile('export { foo as bar, baz }').js;
    expect(js).toContain("foo as bar");
    expect(js).toContain("baz");
  });

  it("compiles re-export with alias", () => {
    const js = compile('export { foo as bar } from "mod"').js;
    expect(js).toContain("foo as bar");
    expect(js).toContain('"mod"');
  });
});

describe("Decorators", () => {
  it("lexes @decorator tokens", () => {
    const tokens = new Lexer("@log fn foo() {}").tokenize();
    expect(tokens[0].type).toBe("Decorator");
    expect(tokens[0].value).toBe("@log");
  });

  it("parses simple decorator on function", () => {
    const ast = compileToAST("@log\nfn greet() {\n  print(1)\n}");
    const fn = ast.body[0] as any;
    expect(fn.type).toBe("FunctionDeclaration");
    expect(fn.decorators).toHaveLength(1);
    expect(fn.decorators[0].name).toBe("log");
  });

  it("parses decorator with arguments", () => {
    const ast = compileToAST('@route("/api")\nfn handler() {\n  print(1)\n}');
    const fn = ast.body[0] as any;
    expect(fn.decorators[0].name).toBe("route");
    expect(fn.decorators[0].arguments).toHaveLength(1);
  });

  it("compiles decorated function to wrapper call", () => {
    const js = compile("@log\nfn foo() {\n  print(1)\n}").js;
    expect(js).toContain("function foo()");
    expect(js).toContain("foo = log(foo)");
  });

  it("compiles decorator with args to curried call", () => {
    const js = compile('@route("/api")\nfn handler() {\n  print(1)\n}').js;
    expect(js).toContain('handler = route("/api")(handler)');
  });

  it("parses decorator on class", () => {
    const ast = compileToAST("@injectable\nclass Service {\n  fn run() {\n    print(1)\n  }\n}");
    const cls = ast.body[0] as any;
    expect(cls.type).toBe("ClassDeclaration");
    expect(cls.decorators).toHaveLength(1);
    expect(cls.decorators[0].name).toBe("injectable");
  });

  it("compiles decorated class to wrapper call", () => {
    const js = compile("@injectable\nclass Service {\n  fn run() {\n    print(1)\n  }\n}").js;
    expect(js).toContain("class Service");
    expect(js).toContain("Service = injectable(Service)");
  });

  it("supports multiple decorators", () => {
    const ast = compileToAST("@log\n@memoize\nfn compute() {\n  print(1)\n}");
    const fn = ast.body[0] as any;
    expect(fn.decorators).toHaveLength(2);
    expect(fn.decorators[0].name).toBe("log");
    expect(fn.decorators[1].name).toBe("memoize");
  });

  it("function without decorator has no decorators field set", () => {
    const ast = compileToAST("fn foo() {\n  print(1)\n}");
    const fn = ast.body[0] as any;
    expect(fn.decorators).toBeUndefined();
  });
});

describe("String multiply sugar", () => {
  it('"ha" * 3 compiles to "ha".repeat(3)', () => {
    const js = compile('"ha" * 3').js;
    expect(js).toContain('.repeat(3)');
  });

  it("3 * 'ha' compiles to 'ha'.repeat(3) (reversed)", () => {
    const js = compile("3 * 'ha'").js;
    expect(js).toContain('.repeat(3)');
  });

  it("template literal repeat", () => {
    const js = compile('`abc` * 2').js;
    expect(js).toContain('.repeat(2)');
  });

  it("regular number * number is unchanged", () => {
    const js = compile("let x = 2 * 3").js;
    expect(js).toContain("2 * 3");
    expect(js).not.toContain("repeat");
  });
});

describe("Array slicing sugar", () => {
  it("arr[1..3] compiles to arr.slice(1, 3)", () => {
    const js = compile("let x = arr[1..3]").js;
    expect(js).toContain(".slice(1, 3)");
  });

  it("arr[0..5] compiles to arr.slice(0, 5)", () => {
    const js = compile("let x = arr[0..5]").js;
    expect(js).toContain(".slice(0, 5)");
  });

  it("works with expressions in range bounds", () => {
    const js = compile("let x = arr[a..b]").js;
    expect(js).toContain(".slice(a, b)");
  });

  it("works with optional chaining", () => {
    const js = compile("let x = arr?.[1..3]").js;
    expect(js).toContain("?.slice(1, 3)");
  });

  it("regular computed access still works", () => {
    const js = compile("let x = arr[0]").js;
    expect(js).toContain("arr[0]");
    expect(js).not.toContain("slice");
  });
});

describe("If-expressions", () => {
  function compileToJS(src: string): string {
    return compile(src).js;
  }

  it("compiles basic if-expression to IIFE", () => {
    const js = compileToJS('let x = if true { "yes" } else { "no" }');
    expect(js).toContain("(() =>");
    expect(js).toContain("if");
    expect(js).toContain("else");
  });

  it("if-expression in variable assignment", () => {
    const js = compileToJS('let val = if 1 > 0 { "positive" } else { "negative" }');
    expect(js).toContain("let val");
    expect(js).toContain("(() =>");
  });

  it("if-expression produces correct AST node", () => {
    const ast = compileToAST('let x = if true { 1 } else { 2 }');
    expect(ast.body.length).toBe(1);
    const decl = ast.body[0] as any;
    expect(decl.type).toBe("VariableDeclaration");
    expect(decl.value.type).toBe("IfExpression");
    expect(decl.value.consequent.length).toBe(1);
    expect(decl.value.alternate.length).toBe(1);
  });

  it("if-expression with multi-statement blocks", () => {
    const js = compileToJS(`let x = if true {
  let a = 1
  a + 1
} else {
  let b = 2
  b + 2
}`);
    expect(js).toContain("(() =>");
    expect(js).toContain("return");
  });

  it("regular if-statement still works", () => {
    const js = compileToJS('if true {\n  let x = 1\n}');
    expect(js).toContain("if");
    expect(js).not.toContain("(() =>");
  });
});

describe("Named arguments", () => {
  function compileToJS(src: string): string {
    return compile(src).js;
  }

  it("compiles named args to trailing object literal", () => {
    const js = compileToJS('greet(name: "World", loud: true)');
    expect(js).toContain("{name: \"World\", loud: true}");
  });

  it("compiles mixed positional and named args", () => {
    const js = compileToJS('render("hello", color: "red", size: 12)');
    expect(js).toContain('"hello"');
    expect(js).toContain("{color: \"red\", size: 12}");
  });

  it("produces correct AST with namedArgs", () => {
    const ast = compileToAST('greet(name: "World")');
    const stmt = ast.body[0] as any;
    expect(stmt.type).toBe("ExpressionStatement");
    const call = stmt.expression;
    expect(call.type).toBe("CallExpression");
    expect(call.arguments.length).toBe(0);
    expect(call.namedArgs.length).toBe(1);
    expect(call.namedArgs[0].type).toBe("NamedArgument");
    expect(call.namedArgs[0].name.name).toBe("name");
  });

  it("compiles all-positional call unchanged", () => {
    const js = compileToJS('foo(1, 2, 3)');
    expect(js).toContain("foo(1, 2, 3)");
    expect(js).not.toContain("{");
  });

  it("named args with expression values", () => {
    const js = compileToJS('config(debug: x > 0, port: 3000 + offset)');
    expect(js).toContain("debug: x > 0");
    expect(js).toContain("port: 3000 + offset");
  });

  it("named args on method call", () => {
    const js = compileToJS('obj.method(key: "value")');
    expect(js).toContain('obj.method({key: "value"})');
  });
});

describe("Algebraic data types", () => {
  it("compiles ADT with named fields to classes", () => {
    const js = compile('type Shape = Circle(radius: number) | Rectangle(width: number, height: number) | Point').js;
    expect(js).toContain('class Circle');
    expect(js).toContain('this.tag = "Circle"');
    expect(js).toContain('this.radius = radius');
    expect(js).toContain('class Rectangle');
    expect(js).toContain('this.width = width');
    expect(js).toContain('this.height = height');
    expect(js).toContain('class Point');
    expect(js).toContain('this.tag = "Point"');
    expect(js).toContain('const Shape = {Circle, Rectangle, Point}');
  });

  it("produces correct AST for ADT", () => {
    const ast = compileToAST('type Option = Some(number) | None');
    const decl = ast.body[0] as any;
    expect(decl.type).toBe("ADTDeclaration");
    expect(decl.name.name).toBe("Option");
    expect(decl.variants.length).toBe(2);
    expect(decl.variants[0].name.name).toBe("Some");
    expect(decl.variants[0].fields.length).toBe(1);
    expect(decl.variants[1].name.name).toBe("None");
    expect(decl.variants[1].fields.length).toBe(0);
  });

  it("compiles unit-only ADT", () => {
    const js = compile('type Color = Red | Green | Blue').js;
    expect(js).toContain('class Red');
    expect(js).toContain('class Green');
    expect(js).toContain('class Blue');
    expect(js).toContain('const Color = {Red, Green, Blue}');
  });

  it("compiles single variant with fields", () => {
    const js = compile('type Wrapper = Box(value: number)').js;
    expect(js).toContain('class Box');
    expect(js).toContain('this.value = value');
    expect(js).toContain('const Wrapper = {Box}');
  });

  it("regular type alias still works", () => {
    const js = compile('type ID = string').js;
    expect(js.trim()).toBe(""); // type alias is erased
  });
});

describe("Pattern matching v2 (ADT destructuring)", () => {
  it("matches variant with field destructuring", () => {
    const js = compile('match shape {\n  case Circle(r) { print(r) }\n  default { print("other") }\n}').js;
    expect(js).toContain('shape.tag === "Circle"');
    expect(js).toContain('const r');
    expect(js).toContain('console.log(r)');
  });

  it("matches multiple variant patterns", () => {
    const js = compile('match x {\n  case Some(value) { print(value) }\n  case None { print("nothing") }\n}').js;
    expect(js).toContain('x.tag === "Some"');
    expect(js).toContain('const value');
    expect(js).toContain('x.tag === "None"');
  });

  it("matches unit variant by uppercase identifier", () => {
    const js = compile('match color {\n  case Red { print("red") }\n  case Blue { print("blue") }\n}').js;
    expect(js).toContain('color.tag === "Red"');
    expect(js).toContain('color.tag === "Blue"');
  });

  it("matches variant with multiple bindings", () => {
    const js = compile('match shape {\n  case Rectangle(w, h) { print(w + h) }\n}').js;
    expect(js).toContain('shape.tag === "Rectangle"');
    expect(js).toContain('const w');
    expect(js).toContain('const h');
  });

  it("plain value match still works", () => {
    const js = compile('match x {\n  case 1 { print("one") }\n  case 2 { print("two") }\n}').js;
    expect(js).toContain('x === 1');
    expect(js).toContain('x === 2');
    expect(js).not.toContain('.tag');
  });

  it("variant match with guard", () => {
    const js = compile('match val {\n  case Some(x) if x > 0 { print(x) }\n  default { print("nope") }\n}').js;
    expect(js).toContain('val.tag === "Some"');
    expect(js).toContain('x > 0');
  });
});

describe("Concurrency: go statement", () => {
  it("go expression compiles to queueMicrotask", () => {
    const js = compile('go doSomething()').js;
    expect(js).toContain('queueMicrotask(');
    expect(js).toContain('doSomething()');
  });

  it("go block compiles to queueMicrotask with arrow", () => {
    const js = compile('go {\n  let x = 1\n  print(x)\n}').js;
    expect(js).toContain('queueMicrotask(');
    expect(js).toContain('let x = 1');
    expect(js).toContain('console.log(x)');
  });

  it("go produces correct AST node", () => {
    const ast = compileToAST('go doWork()');
    const stmt = ast.body[0] as any;
    expect(stmt.type).toBe("GoStatement");
    expect(stmt.expression.type).toBe("CallExpression");
    expect(stmt.body).toBeNull();
  });

  it("go block produces correct AST node", () => {
    const ast = compileToAST('go {\n  print(1)\n}');
    const stmt = ast.body[0] as any;
    expect(stmt.type).toBe("GoStatement");
    expect(stmt.expression).toBeNull();
    expect(stmt.body.length).toBe(1);
  });

  it("go with method call", () => {
    const js = compile('go obj.process(data)').js;
    expect(js).toContain('queueMicrotask(');
    expect(js).toContain('obj.process(data)');
  });
});
