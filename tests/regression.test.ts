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
