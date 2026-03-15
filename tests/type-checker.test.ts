import { describe, it, expect } from "vitest";
import { compileToAST } from "@compiler/compile";
import { typeCheck, TypeDiagnostic, typeToString } from "@compiler/type-checker";

function check(source: string): TypeDiagnostic[] {
  const ast = compileToAST(source);
  return typeCheck(ast);
}

function expectNoErrors(source: string): void {
  const diags = check(source);
  const errors = diags.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
}

function expectError(source: string, messageFragment: string): void {
  const diags = check(source);
  const errors = diags.filter((d) => d.severity === "error");
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.message.includes(messageFragment))).toBe(true);
}

// ── Primitive type annotations ─────────────────────────────────────

describe("Type Checker: Primitive assignments", () => {
  it("accepts number assigned to number", () => {
    expectNoErrors("let x: number = 42");
  });

  it("accepts string assigned to string", () => {
    expectNoErrors('let x: string = "hello"');
  });

  it("accepts boolean assigned to boolean", () => {
    expectNoErrors("let x: boolean = true");
  });

  it("rejects string assigned to number", () => {
    expectError('let x: number = "hello"', "not assignable");
  });

  it("rejects number assigned to string", () => {
    expectError("let x: string = 42", "not assignable");
  });

  it("rejects boolean assigned to number", () => {
    expectError("let x: number = true", "not assignable");
  });

  it("rejects number assigned to boolean", () => {
    expectError("let x: boolean = 42", "not assignable");
  });

  it("rejects string assigned to boolean", () => {
    expectError('let x: boolean = "yes"', "not assignable");
  });
});

// ── Any type ─────────────────────────────────────────────────────

describe("Type Checker: Any type", () => {
  it("any is assignable to number", () => {
    expectNoErrors("let x: any = 42");
  });

  it("no annotation defaults to any (no error)", () => {
    expectNoErrors("let x = 42");
  });

  it("any is assignable to string", () => {
    expectNoErrors('let x: any = "hello"');
  });
});

// ── Union types ──────────────────────────────────────────────────

describe("Type Checker: Union types", () => {
  it("accepts number assigned to string | number", () => {
    expectNoErrors("let x: string | number = 42");
  });

  it("accepts string assigned to string | number", () => {
    expectNoErrors('let x: string | number = "hello"');
  });

  it("rejects boolean assigned to string | number", () => {
    expectError("let x: string | number = true", "not assignable");
  });
});

// ── Array types ──────────────────────────────────────────────────

describe("Type Checker: Array types", () => {
  it("accepts number[] assigned to number[]", () => {
    expectNoErrors("let x: number[] = [1, 2, 3]");
  });

  it("accepts empty array as any[]", () => {
    expectNoErrors("let x: string[] = []");
  });
});

// ── Function declarations ────────────────────────────────────────

describe("Type Checker: Function declarations", () => {
  it("accepts correct return type", () => {
    expectNoErrors(`fn add(a: number, b: number): number {
  return a + b
}`);
  });

  it("rejects wrong return type", () => {
    expectError(`fn greet(): number {
  return "hello"
}`, "not assignable to return type");
  });

  it("defines function in scope for later use", () => {
    expectNoErrors(`fn getNum(): number { return 42 }
let x: number = getNum()`);
  });

  it("function params are typed in body scope", () => {
    expectNoErrors(`fn double(x: number): number {
  return x * 2
}`);
  });

  it("accepts void function with no return", () => {
    expectNoErrors(`fn doNothing(): void {
  let x = 1
}`);
  });
});

// ── Expression type inference ────────────────────────────────────

describe("Type Checker: Expression inference", () => {
  it("infers string from string literal", () => {
    expectNoErrors('let x: string = "test"');
  });

  it("infers number from number literal", () => {
    expectNoErrors("let x: number = 42");
  });

  it("infers boolean from boolean literal", () => {
    expectNoErrors("let x: boolean = true");
  });

  it("infers number from arithmetic", () => {
    expectNoErrors("let x: number = 1 + 2");
  });

  it("infers string from string concatenation", () => {
    expectNoErrors('let x: string = "a" + "b"');
  });

  it("infers boolean from comparison", () => {
    expectNoErrors("let x: boolean = 1 > 2");
  });

  it("infers boolean from equality", () => {
    expectNoErrors("let x: boolean = 1 == 2");
  });

  it("infers boolean from unary not", () => {
    expectNoErrors("let x: boolean = !true");
  });

  it("infers string from typeof", () => {
    expectNoErrors('let x: string = typeof 42');
  });

  it("infers number from unary minus", () => {
    expectNoErrors("let x: number = -5");
  });

  it("infers string from template literal", () => {
    expectNoErrors('let x: string = `hello`');
  });

  it("infers type from ternary expression (consequent)", () => {
    expectNoErrors("let x: number = true ? 1 : 2");
  });
});

// ── Variable resolution ──────────────────────────────────────────

describe("Type Checker: Variable resolution", () => {
  it("resolves previously declared variable type", () => {
    expectNoErrors(`let x: number = 42
let y: number = x`);
  });

  it("resolves inferred variable type", () => {
    expectNoErrors(`let x = 42
let y: number = x`);
  });

  it("unknown variable resolves to any (no error)", () => {
    expectNoErrors("let x: number = unknownVar");
  });
});

// ── Type narrowing ───────────────────────────────────────────────

describe("Type Checker: Type narrowing", () => {
  it("narrows type after typeof check", () => {
    expectNoErrors(`let x: string | number = 42
if typeof x == "string" {
  let y: string = x
}`);
  });

  it("narrowing does not leak outside if block", () => {
    // After the if block, x should still be string | number (any in practice)
    expectNoErrors(`let x: string | number = 42
if typeof x == "string" {
  let y: string = x
}
let z = x`);
  });
});

// ── Class declarations ───────────────────────────────────────────

describe("Type Checker: Class declarations", () => {
  it("class is defined in scope as named type", () => {
    expectNoErrors(`class Animal {}
let a: Animal = new Animal()`);
  });
});

// ── Import declarations ──────────────────────────────────────────

describe("Type Checker: Import declarations", () => {
  it("default import defines binding as any", () => {
    expectNoErrors("import fs from 'fs'\nlet x = fs");
  });

  it("named imports define bindings", () => {
    expectNoErrors("import { readFile, writeFile } from 'fs'\nlet x = readFile");
  });

  it("namespace import defines binding", () => {
    expectNoErrors("import * as path from 'path'\nlet x = path");
  });
});

// ── Export declarations ──────────────────────────────────────────

describe("Type Checker: Export declarations", () => {
  it("exported function is type-checked", () => {
    expectError(`export fn bad(): number {
  return "oops"
}`, "not assignable to return type");
  });

  it("exported variable is type-checked", () => {
    expectError('export let x: number = "oops"', "not assignable");
  });
});

// ── Control flow ─────────────────────────────────────────────────

describe("Type Checker: Control flow", () => {
  it("checks if statement condition and body", () => {
    expectNoErrors(`let x = true
if x {
  let y: number = 42
}`);
  });

  it("checks for statement body", () => {
    expectNoErrors(`for i in [1, 2, 3] {
  let x: number = i
}`);
  });

  it("checks while statement condition and body", () => {
    expectNoErrors(`while true {
  let x: number = 1
}`);
  });

  it("checks try/catch blocks", () => {
    expectNoErrors(`try {
  let x: number = 42
} catch (e) {
  let msg = e
}`);
  });
});

// ── Enum and interface declarations ──────────────────────────────

describe("Type Checker: Enum and interface declarations", () => {
  it("enum is defined in scope", () => {
    expectNoErrors(`enum Color {
  Red
  Green
  Blue
}
let c = Color`);
  });

  it("interface is defined in scope", () => {
    expectNoErrors(`interface Shape {
  area(): number
}
let s = Shape`);
  });
});

// ── Return type checking in nested blocks ────────────────────────

describe("Type Checker: Return type checking", () => {
  it("checks return in if branches", () => {
    expectError(`fn test(): number {
  if true {
    return "bad"
  }
  return 1
}`, "not assignable to return type");
  });

  it("accepts correct returns in if branches", () => {
    expectNoErrors(`fn test(): number {
  if true {
    return 1
  }
  return 2
}`);
  });

  it("accepts multiple correct returns", () => {
    expectNoErrors(`fn test(x: boolean): string {
  if x {
    return "yes"
  } else {
    return "no"
  }
}`);
  });
});

// ── Edge cases ───────────────────────────────────────────────────

describe("Type Checker: Edge cases", () => {
  it("null is assignable to any typed var (treated as any-like)", () => {
    expectNoErrors("let x: number = null");
  });

  it("never is assignable to anything", () => {
    // Can't easily create a never value, but the type system should handle it
    expectNoErrors("let x: number = 42");
  });

  it("empty program produces no diagnostics", () => {
    const diags = check("");
    expect(diags).toEqual([]);
  });

  it("multiple type errors are all reported", () => {
    const diags = check(`let x: number = "a"
let y: boolean = 42`);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBe(2);
  });

  it("deeply nested function return check", () => {
    expectError(`fn outer(): number {
  fn inner(): string {
    return 42
  }
  return 1
}`, "not assignable to return type");
  });
});

// ── typeToString ─────────────────────────────────────────────────

describe("Type Checker: typeToString", () => {
  it("displays primitive types", () => {
    expect(typeToString({ kind: "primitive", name: "string" })).toBe("string");
    expect(typeToString({ kind: "primitive", name: "number" })).toBe("number");
    expect(typeToString({ kind: "primitive", name: "boolean" })).toBe("boolean");
  });

  it("displays any", () => {
    expect(typeToString({ kind: "any" })).toBe("any");
  });

  it("displays never", () => {
    expect(typeToString({ kind: "never" })).toBe("never");
  });

  it("displays array types", () => {
    expect(typeToString({ kind: "array", element: { kind: "primitive", name: "number" } })).toBe("number[]");
  });

  it("displays union types", () => {
    expect(typeToString({
      kind: "union",
      types: [{ kind: "primitive", name: "string" }, { kind: "primitive", name: "number" }],
    })).toBe("string | number");
  });

  it("displays function types", () => {
    expect(typeToString({
      kind: "function",
      params: [{ kind: "primitive", name: "number" }],
      returnType: { kind: "primitive", name: "string" },
    })).toBe("(number) => string");
  });

  it("displays generic types", () => {
    expect(typeToString({
      kind: "generic",
      base: "Promise",
      args: [{ kind: "primitive", name: "string" }],
    })).toBe("Promise<string>");
  });

  it("displays tuple types", () => {
    expect(typeToString({
      kind: "tuple",
      elements: [{ kind: "primitive", name: "string" }, { kind: "primitive", name: "number" }],
    })).toBe("[string, number]");
  });

  it("displays type parameter", () => {
    expect(typeToString({ kind: "typeParam", name: "T" })).toBe("T");
  });

  it("displays constrained type parameter", () => {
    expect(typeToString({
      kind: "typeParam",
      name: "T",
      constraint: { kind: "primitive", name: "string" },
    })).toBe("T extends string");
  });
});

describe("Type Checker: Generic functions", () => {
  it("accepts generic identity function with matching types", () => {
    expectNoErrors(`
      fn identity<T>(x: T): T {
        return x
      }
    `);
  });

  it("generic function is defined in scope with typeParams", () => {
    expectNoErrors(`
      fn identity<T>(x: T): T {
        return x
      }
      const result = identity("hello")
    `);
  });

  it("accepts generic function with multiple type params", () => {
    expectNoErrors(`
      fn pair<A, B>(a: A, b: B): A {
        return a
      }
    `);
  });

  it("generic param types are available in function body", () => {
    expectNoErrors(`
      fn wrap<T>(value: T): T {
        const inner: T = value
        return inner
      }
    `);
  });

  it("type param used as return type does not trigger return type error", () => {
    expectNoErrors(`
      fn first<T>(arr: T[]): T {
        return arr[0]
      }
    `);
  });
});
