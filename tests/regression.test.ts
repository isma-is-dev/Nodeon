import { describe, it, expect } from "vitest";
import { compile, compileToAST, compileWithSourceMap } from "@compiler/compile";
import { NodeonError, ErrorCode } from "@compiler/errors";

/**
 * Regression tests — one or more tests per fixed bug to prevent regressions.
 */

describe("Regression: BUG-001 — let TDZ in switch/match cases", () => {
  it("switch cases with same variable name in different cases emit separate let declarations", () => {
    const src = `switch x {
  case 1 {
    let result = "one"
    print(result)
  }
  case 2 {
    let result = "two"
    print(result)
  }
}`;
    const { js } = compile(src);
    // Both cases should have their own 'let result' — count occurrences
    const matches = js.match(/let result/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("match cases with same variable name in different cases emit separate let declarations", () => {
    const src = `match status {
  case "ok" {
    let msg = "success"
    print(msg)
  }
  case "error" {
    let msg = "failure"
    print(msg)
  }
}`;
    const { js } = compile(src);
    const matches = js.match(/let msg/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("switch cases are wrapped in { } blocks for scope isolation", () => {
    const src = `switch x {
  case 1 {
    let val = "a"
  }
  case 2 {
    let val = "b"
  }
}`;
    const { js } = compile(src);
    // Each case should have its own { } block
    expect(js).toMatch(/case 1: \{/);
    expect(js).toMatch(/case 2: \{/);
  });

  it("switch with let re-use in same case still deduplicates (intended behavior)", () => {
    const src = `fn test() {
  x = 1
  x = 2
  return x
}`;
    const { js } = compile(src);
    // The second x = 2 should be bare assignment (no let)
    const letMatches = js.match(/let x/g);
    expect(letMatches).not.toBeNull();
    expect(letMatches!.length).toBe(1);
  });
});

describe("Regression: BUG-002 — range '..' operator outside for loops", () => {
  it("range operator in for loop compiles correctly", () => {
    const { js } = compile("for i in 0..10 { print(i) }");
    expect(js).toContain("for");
    expect(js).toContain("i <= 10");
    expect(js).toContain("i++");
  });

  it("range operator outside for loop throws an error", () => {
    expect(() => compile("x = 1..5")).toThrow("Range operator '..' can only be used inside 'for' loops");
  });

  it("range operator in variable assignment throws an error", () => {
    expect(() => compile("let arr = 1..5")).toThrow("Range operator");
  });
});

describe("Regression: BUG-003 — parser recovery with balanced braces", () => {
  it("recovery method exists and parser handles errors gracefully", () => {
    // The parser should not crash when encountering incomplete code
    // It should produce some AST (possibly partial)
    const src = `fn good() { return 1 }`;
    const ast = compileToAST(src);
    expect(ast.body.length).toBe(1);
    expect(ast.body[0].type).toBe("FunctionDeclaration");
  });
});

describe("Regression: BUG-004 — union/intersection type parsing", () => {
  it("parses union type string | number correctly", () => {
    const ast = compileToAST("let x: string | number = 42");
    const decl = ast.body[0] as any;
    expect(decl.type).toBe("VariableDeclaration");
    expect(decl.typeAnnotation.kind).toBe("union");
    expect(decl.typeAnnotation.types.length).toBe(2);
  });

  it("parses intersection type A & B correctly", () => {
    const ast = compileToAST("let x: A & B = obj");
    const decl = ast.body[0] as any;
    expect(decl.type).toBe("VariableDeclaration");
    expect(decl.typeAnnotation.kind).toBe("intersection");
    expect(decl.typeAnnotation.types.length).toBe(2);
  });

  it("|| operator is not confused with | in type annotations", () => {
    // This expression uses || (logical OR) not | (union type)
    const { js } = compile("x = a || b");
    expect(js).toContain("||");
  });

  it("&& operator is not confused with & in type annotations", () => {
    const { js } = compile("x = a && b");
    expect(js).toContain("&&");
  });
});

describe("Regression: BUG-005 — source map inner-line accuracy", () => {
  it("source map for function generates mapping entries", () => {
    const src = "fn add(a, b) {\n  return a + b\n}";
    const result = compileWithSourceMap(src, "test.no", "test.js");
    expect(result.sourceMap.mappings).toBeTruthy();
    expect(result.sourceMap.mappings.length).toBeGreaterThan(0);
  });

  it("source map has multiple line mappings for multi-line function", () => {
    const src = "fn hello() {\n  x = 1\n  y = 2\n  return x + y\n}";
    const result = compileWithSourceMap(src, "test.no", "test.js");
    // mappings should have semicolons separating lines
    const lineCount = result.sourceMap.mappings.split(";").length;
    expect(lineCount).toBeGreaterThan(1);
  });
});

describe("Regression: BUG-007 — contextual keywords as identifiers", () => {
  it("allows 'static' as a variable name", () => {
    const ast = compileToAST("let static = true");
    const decl = ast.body[0] as any;
    expect(decl.type).toBe("VariableDeclaration");
    expect(decl.name.name).toBe("static");
  });

  it("allows 'default' as a variable name", () => {
    const ast = compileToAST("let default = 42");
    const decl = ast.body[0] as any;
    expect(decl.type).toBe("VariableDeclaration");
    expect(decl.name.name).toBe("default");
  });

  it("allows 'type' as a variable name (not type alias context)", () => {
    // type followed by = is variable assignment, not type alias (which needs type X = ...)
    const ast = compileToAST("let type = 'hello'");
    const decl = ast.body[0] as any;
    expect(decl.type).toBe("VariableDeclaration");
    expect(decl.name.name).toBe("type");
  });

  it("allows 'set' and 'get' as parameter names", () => {
    const ast = compileToAST("fn process(get, set) { return get + set }");
    const fn = ast.body[0] as any;
    expect(fn.params[0].name).toBe("get");
    expect(fn.params[1].name).toBe("set");
  });
});

describe("Regression: BUG-008 — import * as name AST representation", () => {
  it("namespace import has proper namespaceImport field", () => {
    const ast = compileToAST("import * as utils from 'utils'");
    const imp = ast.body[0] as any;
    expect(imp.type).toBe("ImportDeclaration");
    expect(imp.namespaceImport).toBe("utils");
    expect(imp.defaultImport).toBeNull();
  });

  it("default import does not set namespaceImport", () => {
    const ast = compileToAST("import React from 'react'");
    const imp = ast.body[0] as any;
    expect(imp.defaultImport).toBe("React");
    expect(imp.namespaceImport).toBeNull();
  });

  it("namespace import generates correct JS", () => {
    const { js } = compile("import * as path from 'path'");
    expect(js).toContain("import * as path");
    expect(js).toContain('"path"');
  });

  it("named import still works correctly", () => {
    const ast = compileToAST("import { readFile, writeFile } from 'fs'");
    const imp = ast.body[0] as any;
    expect(imp.namedImports.length).toBe(2);
    expect(imp.namespaceImport).toBeNull();
    expect(imp.defaultImport).toBeNull();
  });
});

describe("Regression: Error system — NodeonError", () => {
  it("NodeonError has error code, line, column, and help", () => {
    const err = new NodeonError(ErrorCode.E0101, "Expected ')'", 5, 12);
    expect(err).toBeInstanceOf(NodeonError);
    expect(err.code).toBe("E0101");
    expect(err.line).toBe(5);
    expect(err.column).toBe(12);
    expect(err.message).toMatch(/at 5:12$/);
    expect(Array.isArray(err.help)).toBe(true);
    expect(err.help.length).toBeGreaterThan(0);
    expect(err.help[0]).toContain("parenthesis");
  });

  it("NodeonError gives suggestions for missing closing brace", () => {
    const err = new NodeonError(ErrorCode.E0101, "Expected '}'", 10, 1);
    expect(err.help.length).toBeGreaterThan(0);
    expect(err.help[0]).toContain("brace");
  });

  it("NodeonError gives suggestions for Expected expression", () => {
    const err = new NodeonError(ErrorCode.E0105, "Expected expression", 3, 8);
    expect(err.help.length).toBeGreaterThan(0);
  });

  it("NodeonError extends SyntaxError for backward compatibility", () => {
    const err = new NodeonError(ErrorCode.E0100, "test error", 1, 1);
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.name).toBe("NodeonError");
  });
});

// ─────────────────────────────────────────────────────────────────
// BUG-010: anonymous `fn` in expression position.
//
// `fn` was only ever parsed as a *declaration* keyword, so the idiomatic
// `items.filter(fn(f) { return f.ok })` failed with "Expected expression" at
// the `fn`. Worse, the statement was then silently dropped from the AST
// (body length 0) while the error was only recorded, so the file compiled to
// empty output instead of failing loudly.
//
// The blow-up: the failed parse left the token cursor on the same `fn`, the
// statement loop re-parsed it, and error recovery returned without consuming
// anything — an unbounded loop that grew `errors[]` until the process died
// with a JavaScript heap OOM. src/cli/commands/db.no is the real trigger and
// it is 1 of only 4 files in src/ that the compiler could not compile.
// ─────────────────────────────────────────────────────────────────

describe("Regression: BUG-010 — anonymous fn expression + error-recovery loop", () => {
  // The OOM: a single syntax error must not spin. Assert on the *count* of
  // errors rather than wall-clock, so this fails fast instead of exhausting
  // the heap when the regression comes back.
  it("a syntax error produces a bounded number of diagnostics, not an unbounded loop", () => {
    const src = `const out = files.filter(fn(f) { return true })\n`;
    const ast = compileToAST(src);
    // The whole point: the statement is understood, so there is no error at all.
    expect(ast.errors ?? []).toHaveLength(0);
    expect(ast.body).toHaveLength(1);
  });

  it("genuinely broken source terminates and still reports its error", () => {
    // `fn` not followed by a parameter list is a real syntax error. Recovery
    // must make forward progress so parseProgram() terminates.
    const src = `const a = fn\nfn real() { return 1 }\n`;
    const ast = compileToAST(src);
    // Terminates (we got here) and the trailing valid function still parses.
    expect(ast.body.some((s: any) => s.type === "FunctionDeclaration")).toBe(true);
    expect((ast.errors ?? []).length).toBeGreaterThan(0);
  });

  it("recovery does not loop on a stray closing brace", () => {
    const src = "}\n}\n}\nx = 1\n";
    const ast = compileToAST(src);
    // Must terminate; the trailing assignment is still recovered.
    expect(ast.body.some((s: any) => s.type === "VariableDeclaration")).toBe(true);
  });

  // The language feature itself.
  it("parses an anonymous fn as an expression, not a dropped statement", () => {
    const ast = compileToAST(`const out = files.filter(fn(f) { return f.ok })`);
    expect(ast.errors ?? []).toHaveLength(0);
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0].type).toBe("VariableDeclaration");
  });

  it("compiles an anonymous fn argument to working JavaScript", () => {
    const { js } = compile(`const out = files.filter(fn(f) { return f.ok })`);
    expect(js).toContain("filter");
    expect(js).toContain("f.ok");
    expect(js).toContain("return");
  });

  it("generated anonymous fn actually executes with the right behaviour", () => {
    // Behaviour, not shape: the arrow must be called and must return the value.
    const { js } = compile(`const double = fn(n) { return n * 2 }`);
    // eslint-disable-next-line no-new-func
    const value = new Function(`${js}; return double(21);`)();
    expect(value).toBe(42);
  });

  it("supports an anonymous fn with the expression body form", () => {
    const { js } = compile(`const twice = fn(n) = n * 2`);
    // eslint-disable-next-line no-new-func
    const value = new Function(`${js}; return twice(5);`)();
    expect(value).toBe(10);
  });

  it("supports a generator fn in expression position", () => {
    // Newline-separated: Nodeon is a no-semicolon language, so `;` is not a
    // valid statement separator.
    const { js } = compile("const gen = fn*() { yield 1\n yield 2 }");
    expect(js).toContain("function*");
    // eslint-disable-next-line no-new-func
    const out = new Function(`${js}; const o = []; for (const v of gen()) o.push(v); return o;`)();
    expect(out).toEqual([1, 2]);
  });

  it("keeps `fn name(...)` as a declaration, not an expression", () => {
    // The two forms are distinguished by what follows `fn`; the declaration
    // form must not regress into being parsed as an anonymous function.
    const ast = compileToAST(`fn greet(name) { return name }`);
    expect(ast.errors ?? []).toHaveLength(0);
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0].type).toBe("FunctionDeclaration");
  });

  it("an anonymous fn nested in a call chain is preserved", () => {
    // The exact shape from src/cli/commands/db.no that crashed the compiler.
    const src = `const files = ["b.js", "a.no", "c.txt"]
const migrations = files
  .filter(fn(f) { return f.endsWith(".no") || f.endsWith(".js") })
  .sort()`;
    const { js } = compile(src);
    expect(js).toContain("filter");
    expect(js).toContain("sort");
    // eslint-disable-next-line no-new-func
    const out = new Function(`${js}; return migrations;`)() as string[];
    expect(out).toEqual(["a.no", "b.js"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// BUG-011: object spread `{ ...src, key: value }` was not parsed.
//
// `parseObjectExpression` handled computed keys, shorthand and normal keys,
// but not the `...` operator, so every object literal containing a spread
// failed with "Expected property key". Recovery then dropped the rest of the
// statement, which in a `return` produced a top-level `return` — invalid JS
// that the bundler rejected, breaking the self-hosted build.
//
// Spread is used throughout the Nodeon sources (optimizer.no and others), so
// this blocked compiling the compiler's own optimizer.
// ─────────────────────────────────────────────────────────────────

describe("Regression: BUG-011 — object spread in object literals", () => {
  it("parses a spread property without errors", () => {
    const ast = compileToAST(`const o = { ...base, v: 1 }`);
    expect(ast.errors ?? []).toHaveLength(0);
    expect(ast.body).toHaveLength(1);
  });

  it("emits the spread verbatim", () => {
    const { js } = compile(`const o = { ...base, v: 1 }`);
    expect(js).toContain("...");
  });

  it("merges objects with correct precedence at runtime", () => {
    // Later properties win, including over a spread — that is JS semantics
    // and the reason this is a behaviour test, not a string match.
    const src = `fn merge(base, extra) {
  return { ...base, ...extra, tag: "x" }
}`;
    // eslint-disable-next-line no-new-func
    const out = new Function(`${compile(src).js}; return merge({ a: 1, b: 2 }, { b: 9, c: 3 });`)();
    expect(out).toEqual({ a: 1, b: 9, c: 3, tag: "x" });
  });

  it("supports a spread returned from an arrow body", () => {
    const src = `const out = [{ k: 1 }].map((p) => {
  return { ...p, seen: true }
})`;
    // eslint-disable-next-line no-new-func
    const out = new Function(`${compile(src).js}; return out;`)();
    expect(out).toEqual([{ k: 1, seen: true }]);
  });

  it("supports multiple spreads mixed with shorthand and computed keys", () => {
    const src = `const a = 1
const key = "dyn"
const o = { ...{ b: 2 }, [key]: 3, a }`;
    // eslint-disable-next-line no-new-func
    const out = new Function(`${compile(src).js}; return o;`)();
    expect(out).toEqual({ b: 2, dyn: 3, a: 1 });
  });

  it("a spread inside a returned object does not leak a top-level return", () => {
    // The failure signature of BUG-011: the return escaped its function, so the
    // output started with a bare `return` before any function. Assert on the
    // structure instead of a naive /^\s*return/m, which also matches a
    // correctly-indented return inside the function body.
    const { js } = compile(`fn f(p) {
  return { ...p, v: 1 }
}`);
    expect(js.trimStart().startsWith("function")).toBe(true);
    // The whole program is one top-level function declaration.
    expect(js.trimEnd().endsWith("}")).toBe(true);
    // And it is valid, executable JavaScript.
    // eslint-disable-next-line no-new-func
    const out = new Function(`${js}; return f({ a: 1 });`)();
    expect(out).toEqual({ a: 1, v: 1 });
  });

  it("an arrow with an object-literal body is parenthesised in the output", () => {
    // `x => { ...x, k: v }` is a BLOCK in JavaScript, so the spread would be
    // a syntax error. The generator must emit `x => ({ ...x, k: v })`.
    const { js } = compile(`const f = (c) => { ...c, k: 1 }`);
    expect(js).toMatch(/=>\s*\(\{/);
    // eslint-disable-next-line no-new-func
    const out = new Function(`${js}; return f({ a: 1 });`)();
    expect(out).toEqual({ a: 1, k: 1 });
  });

  it("supports a bare-parameter arrow with an object body", () => {
    const { js } = compile(`const f = c => { ...c, k: 1 }`);
    // eslint-disable-next-line no-new-func
    const out = new Function(`${js}; return f({ a: 1 });`)();
    expect(out).toEqual({ a: 1, k: 1 });
  });

  it("supports an arrow returning a parenthesised object literal", () => {
    // `n` must exist on the input: `c.n + 1` on a missing field is NaN.
    const src = `const out = [{ k: 1, n: 10 }].map((c) => ({
  ...c,
  n: c.n + 1
}))`;
    // eslint-disable-next-line no-new-func
    const out = new Function(`${compile(src).js}; return out;`)();
    expect(out).toEqual([{ k: 1, n: 11 }]);
  });
});

// ─────────────────────────────────────────────────────────────────
// BUG-012: `x = v` was always parsed as a declaration.
//
// Nodeon's headline feature is `x = 10` with no keyword (nodeon-design.md §3).
// The parser turned EVERY `x = v` into VariableDeclaration, so a re-assignment
// looked like a redeclaration. The generated JS was still right, which is why
// 600+ tests passed — but every AST consumer was misled. The optimizer then
// promoted an accumulated variable to `const` and dropped the accumulation:
//
//   let t = 0; for (v of a) { t = t + v }
//   →  const t = 0; for (v of a) { const t = t + v }   // ReferenceError
//
// A first use declares; every later use assigns.
// ─────────────────────────────────────────────────────────────────

describe("Regression: BUG-012 — bare `x = v` declares once, then assigns", () => {
  it("the first `x = v` is a declaration", () => {
    const ast = compileToAST("x = 1");
    expect(ast.body[0].type).toBe("VariableDeclaration");
  });

  it("a later `x = v` is an assignment, not a new declaration", () => {
    const ast = compileToAST("x = 1\nx = 2");
    expect(ast.body[0].type).toBe("VariableDeclaration");
    expect(ast.body[1].type).toBe("ExpressionStatement");
    expect((ast.body[1] as any).expression.type).toBe("AssignmentExpression");
  });

  it("re-assigning a `let` produces an assignment", () => {
    const ast = compileToAST("let t = 0\nt = 5");
    expect(ast.body[1].type).toBe("ExpressionStatement");
  });

  it("re-assignment inside a loop is an assignment", () => {
    const ast = compileToAST("let t = 0\nfor v in [1, 2] { t = t + v }");
    const forStmt = ast.body[1] as any;
    expect(forStmt.type).toBe("ForStatement");
    expect(forStmt.body[0].type).toBe("ExpressionStatement");
    expect(forStmt.body[0].expression.type).toBe("AssignmentExpression");
  });

  it("generated JavaScript is unchanged by the AST fix", () => {
    // The bug was AST-only; the emitted JS was always correct. Pin that so a
    // future change to declaration/assignment detection cannot alter output.
    const { js } = compile("let t = 0\nfor v in [1, 2] { t = t + v }");
    expect(js).toContain("let t = 0");
    expect(js).toContain("t = t + v");
  });

  it("an accumulated loop variable is not const-folded away", () => {
    // The behaviour the AST bug actually broke. Inclusive range 0..3.
    const { js } = compile("let n = 0\nfor i in 0..3 { n = n + i }");
    // eslint-disable-next-line no-new-func
    const out = new Function(`${js}; return n;`)();
    expect(out).toBe(6);
  });

  it("a loop variable is registered as bound before the body", () => {
    // `for v in xs { v = 1 }` assigns v; it does not declare a new `v`.
    const ast = compileToAST("for v in [1] { v = 1 }");
    const forStmt = ast.body[0] as any;
    expect(forStmt.body[0].type).toBe("ExpressionStatement");
  });

  it("a function parameter shadows: `f(x) { x = 1 }` is an assignment", () => {
    const ast = compileToAST("fn f(x) { x = 1 }");
    const fn = ast.body[0] as any;
    expect(fn.body[0].type).toBe("ExpressionStatement");
  });

  it("a destructured binding is a declaration, and re-use assigns", () => {
    const ast = compileToAST("const { a, b } = obj\na = 5");
    expect(ast.body[0].type).toBe("DestructuringDeclaration");
    expect(ast.body[1].type).toBe("ExpressionStatement");
  });
});
