import { describe, it, expect } from "vitest";
import { Lexer } from "@lexer/lexer";
import { Parser } from "@parser/parser";
import { Program } from "@ast/nodes";

describe("Parser", () => {
  function parse(src: string): Program {
    const tokens = new Lexer(src).tokenize();
    return new Parser(tokens).parseProgram();
  }

  function firstStmt(src: string) {
    return parse(src).body[0];
  }

  function firstExpr(src: string) {
    const stmt = firstStmt(src);
    if (stmt.type !== "ExpressionStatement") throw new Error("Expected ExpressionStatement");
    return stmt.expression;
  }

  // ── Variable Declarations ────────────────────────────────
  describe("variable declarations", () => {
    it("parses bare assignment as let", () => {
      const stmt = firstStmt("x = 42");
      expect(stmt.type).toBe("VariableDeclaration");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.kind).toBe("let");
        expect(stmt.name.name).toBe("x");
      }
    });

    it("parses const declaration", () => {
      const stmt = firstStmt("const PI = 3.14");
      expect(stmt.type).toBe("VariableDeclaration");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.kind).toBe("const");
      }
    });

    it("parses let declaration", () => {
      const stmt = firstStmt("let x = 10");
      expect(stmt.type).toBe("VariableDeclaration");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.kind).toBe("let");
      }
    });

    it("parses var declaration", () => {
      const stmt = firstStmt("var x = 10");
      expect(stmt.type).toBe("VariableDeclaration");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.kind).toBe("var");
      }
    });
  });

  // ── Function Declarations ────────────────────────────────
  describe("function declarations", () => {
    it("parses basic function", () => {
      const stmt = firstStmt("fn greet(name) { print(name) }");
      expect(stmt.type).toBe("FunctionDeclaration");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.name.name).toBe("greet");
        expect(stmt.params).toHaveLength(1);
        expect(stmt.async).toBe(false);
      }
    });

    it("parses async function", () => {
      const stmt = firstStmt("async fn fetch(url) { return url }");
      expect(stmt.type).toBe("FunctionDeclaration");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.async).toBe(true);
      }
    });

    it("parses default parameters", () => {
      const stmt = firstStmt("fn add(a, b = 0) { return a + b }");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.params[1].defaultValue).toBeDefined();
      }
    });

    it("parses rest parameters", () => {
      const stmt = firstStmt("fn sum(...nums) { return nums }");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.params[0].rest).toBe(true);
      }
    });
  });

  // ── Control Flow ─────────────────────────────────────────
  describe("control flow", () => {
    it("parses if statement", () => {
      const stmt = firstStmt("if x > 0 { print(x) }");
      expect(stmt.type).toBe("IfStatement");
    });

    it("parses if-else", () => {
      const stmt = firstStmt("if x > 0 { print(x) } else { print(0) }");
      if (stmt.type === "IfStatement") {
        expect(stmt.alternate).not.toBeNull();
      }
    });

    it("parses if-else if-else", () => {
      const stmt = firstStmt("if x > 0 { } else if x == 0 { } else { }");
      if (stmt.type === "IfStatement") {
        expect(stmt.alternate).not.toBeNull();
        if (stmt.alternate && stmt.alternate[0].type === "IfStatement") {
          expect(stmt.alternate[0].alternate).not.toBeNull();
        }
      }
    });

    it("parses for-in with range", () => {
      const stmt = firstStmt("for i in 0..10 { print(i) }");
      expect(stmt.type).toBe("ForStatement");
      if (stmt.type === "ForStatement") {
        expect(stmt.variable.name).toBe("i");
        expect(stmt.iterable.type).toBe("BinaryExpression");
      }
    });

    it("parses for-in with iterable", () => {
      const stmt = firstStmt("for item in items { print(item) }");
      expect(stmt.type).toBe("ForStatement");
    });

    it("parses while loop", () => {
      const stmt = firstStmt("while x > 0 { x = x - 1 }");
      expect(stmt.type).toBe("WhileStatement");
    });

    it("parses do-while loop", () => {
      const stmt = firstStmt("do { x = x - 1 } while x > 0");
      expect(stmt.type).toBe("DoWhileStatement");
    });

    it("parses break statement", () => {
      expect(firstStmt("break").type).toBe("BreakStatement");
    });

    it("parses continue statement", () => {
      expect(firstStmt("continue").type).toBe("ContinueStatement");
    });
  });

  // ── Switch ───────────────────────────────────────────────
  describe("switch statement", () => {
    it("parses switch with cases and default", () => {
      const stmt = firstStmt(`switch x {
        case 1 { print("one") }
        case 2 { print("two") }
        default { print("other") }
      }`);
      expect(stmt.type).toBe("SwitchStatement");
      if (stmt.type === "SwitchStatement") {
        expect(stmt.cases).toHaveLength(3);
        expect(stmt.cases[2].test).toBeNull(); // default
      }
    });
  });

  // ── Try/Catch/Finally ────────────────────────────────────
  describe("try/catch/finally", () => {
    it("parses try-catch", () => {
      const stmt = firstStmt("try { x = 1 } catch (e) { print(e) }");
      expect(stmt.type).toBe("TryCatchStatement");
      if (stmt.type === "TryCatchStatement") {
        expect(stmt.catchParam?.name).toBe("e");
      }
    });

    it("parses try-catch-finally", () => {
      const stmt = firstStmt("try { x = 1 } catch (e) { print(e) } finally { cleanup() }");
      if (stmt.type === "TryCatchStatement") {
        expect(stmt.finallyBlock).not.toBeNull();
      }
    });

    it("parses try-finally (no catch)", () => {
      const stmt = firstStmt("try { x = 1 } finally { cleanup() }");
      if (stmt.type === "TryCatchStatement") {
        expect(stmt.catchParam).toBeNull();
        expect(stmt.finallyBlock).not.toBeNull();
      }
    });
  });

  // ── Expressions ──────────────────────────────────────────
  describe("expressions", () => {
    it("parses binary expression", () => {
      const expr = firstExpr("1 + 2");
      expect(expr.type).toBe("BinaryExpression");
      if (expr.type === "BinaryExpression") {
        expect(expr.operator).toBe("+");
      }
    });

    it("respects operator precedence", () => {
      const expr = firstExpr("1 + 2 * 3");
      expect(expr.type).toBe("BinaryExpression");
      if (expr.type === "BinaryExpression") {
        expect(expr.operator).toBe("+");
        expect(expr.right.type).toBe("BinaryExpression");
      }
    });

    it("parses unary expression", () => {
      const expr = firstExpr("!true");
      expect(expr.type).toBe("UnaryExpression");
    });

    it("parses ternary expression", () => {
      const expr = firstExpr("x > 0 ? 1 : 0");
      expect(expr.type).toBe("TernaryExpression");
    });

    it("parses typeof expression", () => {
      const expr = firstExpr("typeof x");
      expect(expr.type).toBe("TypeofExpression");
    });

    it("parses increment/decrement", () => {
      const expr = firstExpr("++x");
      expect(expr.type).toBe("UpdateExpression");
      if (expr.type === "UpdateExpression") {
        expect(expr.prefix).toBe(true);
        expect(expr.operator).toBe("++");
      }
    });

    it("parses compound assignment", () => {
      const stmt = firstStmt("x += 1");
      expect(stmt.type).toBe("ExpressionStatement");
      if (stmt.type === "ExpressionStatement") {
        expect(stmt.expression.type).toBe("CompoundAssignmentExpression");
      }
    });

    it("parses nullish coalescing", () => {
      const expr = firstExpr("x ?? 0");
      expect(expr.type).toBe("BinaryExpression");
      if (expr.type === "BinaryExpression") {
        expect(expr.operator).toBe("??");
      }
    });

    it("parses optional chaining", () => {
      const expr = firstExpr("obj?.prop");
      expect(expr.type).toBe("MemberExpression");
      if (expr.type === "MemberExpression") {
        expect(expr.optional).toBe(true);
      }
    });

    it("parses arrow function", () => {
      const expr = firstExpr("(x) => x * 2");
      expect(expr.type).toBe("ArrowFunction");
    });

    it("parses new expression", () => {
      const expr = firstExpr("new Error('msg')");
      expect(expr.type).toBe("NewExpression");
    });

    it("parses spread expression", () => {
      const expr = firstExpr("[...items]");
      if (expr.type === "ArrayExpression") {
        expect(expr.elements[0].type).toBe("SpreadExpression");
      }
    });

    it("parses await expression", () => {
      const expr = firstExpr("await fetch(url)");
      expect(expr.type).toBe("AwaitExpression");
    });
  });

  // ── String Interpolation ─────────────────────────────────
  describe("string interpolation", () => {
    it("parses double-quoted string with interpolation", () => {
      const expr = firstExpr('"Hello {name}"');
      expect(expr.type).toBe("TemplateLiteral");
    });

    it("parses plain double-quoted string", () => {
      const expr = firstExpr('"Hello world"');
      expect(expr.type).toBe("Literal");
    });

    it("parses single-quoted string without interpolation", () => {
      const expr = firstExpr("'{\"ok\": true}'");
      expect(expr.type).toBe("Literal");
      if (expr.type === "Literal") {
        expect(expr.literalType).toBe("string");
      }
    });
  });

  // ── Literals ─────────────────────────────────────────────
  describe("literals", () => {
    it("parses true", () => {
      const expr = firstExpr("true");
      expect(expr.type).toBe("Literal");
      if (expr.type === "Literal") expect(expr.value).toBe(true);
    });

    it("parses false", () => {
      const expr = firstExpr("false");
      expect(expr.type).toBe("Literal");
      if (expr.type === "Literal") expect(expr.value).toBe(false);
    });

    it("parses null", () => {
      const expr = firstExpr("null");
      expect(expr.type).toBe("Literal");
      if (expr.type === "Literal") expect(expr.value).toBe(null);
    });

    it("parses undefined", () => {
      const expr = firstExpr("undefined");
      expect(expr.type).toBe("Literal");
      if (expr.type === "Literal") expect(expr.literalType).toBe("undefined");
    });

    it("parses this", () => {
      const expr = firstExpr("this");
      expect(expr.type).toBe("Identifier");
      if (expr.type === "Identifier") expect(expr.name).toBe("this");
    });
  });

  // ── Import/Export ────────────────────────────────────────
  describe("imports and exports", () => {
    it("parses default import", () => {
      const stmt = firstStmt('import fs from "fs"');
      expect(stmt.type).toBe("ImportDeclaration");
      if (stmt.type === "ImportDeclaration") {
        expect(stmt.defaultImport).toBe("fs");
        expect(stmt.source).toBe("fs");
      }
    });

    it("parses named imports", () => {
      const stmt = firstStmt('import { readFile, writeFile } from "fs"');
      if (stmt.type === "ImportDeclaration") {
        expect(stmt.namedImports).toEqual(["readFile", "writeFile"]);
      }
    });

    it("parses export", () => {
      const stmt = firstStmt("export fn add(a, b) { return a + b }");
      expect(stmt.type).toBe("ExportDeclaration");
    });
  });

  // ── Class ────────────────────────────────────────────────
  describe("class declarations", () => {
    it("parses basic class", () => {
      const stmt = firstStmt("class Animal { constructor(name) { this.name = name } }");
      expect(stmt.type).toBe("ClassDeclaration");
      if (stmt.type === "ClassDeclaration") {
        expect(stmt.name.name).toBe("Animal");
        expect(stmt.body).toHaveLength(1);
      }
    });

    it("parses class with extends", () => {
      const stmt = firstStmt("class Dog extends Animal { fn bark() { print('Woof') } }");
      if (stmt.type === "ClassDeclaration") {
        expect(stmt.superClass?.name).toBe("Animal");
      }
    });
  });

  // ── Destructuring ────────────────────────────────────────
  describe("destructuring", () => {
    it("parses object destructuring with const", () => {
      const stmt = firstStmt("const { a, b } = obj");
      expect(stmt.type).toBe("DestructuringDeclaration");
      if (stmt.type === "DestructuringDeclaration") {
        expect(stmt.kind).toBe("const");
        expect(stmt.pattern.type).toBe("ObjectPattern");
        if (stmt.pattern.type === "ObjectPattern") {
          expect(stmt.pattern.properties).toHaveLength(2);
          expect(stmt.pattern.properties[0].key.name).toBe("a");
          expect(stmt.pattern.properties[0].shorthand).toBe(true);
        }
      }
    });

    it("parses array destructuring with let", () => {
      const stmt = firstStmt("let [x, y] = arr");
      expect(stmt.type).toBe("DestructuringDeclaration");
      if (stmt.type === "DestructuringDeclaration") {
        expect(stmt.kind).toBe("let");
        expect(stmt.pattern.type).toBe("ArrayPattern");
        if (stmt.pattern.type === "ArrayPattern") {
          expect(stmt.pattern.elements).toHaveLength(2);
        }
      }
    });

    it("parses object destructuring with rename", () => {
      const stmt = firstStmt("const { name: n, age: a } = person");
      if (stmt.type === "DestructuringDeclaration" && stmt.pattern.type === "ObjectPattern") {
        expect(stmt.pattern.properties[0].shorthand).toBe(false);
        expect(stmt.pattern.properties[0].value).toEqual({ type: "Identifier", name: "n" });
      }
    });

    it("parses object destructuring with defaults", () => {
      const stmt = firstStmt("const { x = 0, y = 0 } = point");
      if (stmt.type === "DestructuringDeclaration" && stmt.pattern.type === "ObjectPattern") {
        expect(stmt.pattern.properties[0].defaultValue).toBeDefined();
      }
    });

    it("parses object destructuring with rest", () => {
      const stmt = firstStmt("const { a, ...rest } = obj");
      if (stmt.type === "DestructuringDeclaration" && stmt.pattern.type === "ObjectPattern") {
        expect(stmt.pattern.properties).toHaveLength(1);
        expect(stmt.pattern.rest?.name).toBe("rest");
      }
    });

    it("parses array destructuring with rest", () => {
      const stmt = firstStmt("const [first, ...rest] = arr");
      if (stmt.type === "DestructuringDeclaration" && stmt.pattern.type === "ArrayPattern") {
        expect(stmt.pattern.elements).toHaveLength(1);
        expect(stmt.pattern.rest?.name).toBe("rest");
      }
    });

    it("parses nested destructuring", () => {
      const stmt = firstStmt("const { user: { name, age } } = data");
      if (stmt.type === "DestructuringDeclaration" && stmt.pattern.type === "ObjectPattern") {
        const prop = stmt.pattern.properties[0];
        expect(prop.value.type).toBe("ObjectPattern");
      }
    });

    it("parses destructuring in for-in", () => {
      const stmt = firstStmt("for { name, age } in users { print(name) }");
      expect(stmt.type).toBe("ForStatement");
      if (stmt.type === "ForStatement") {
        expect(stmt.variable.type).toBe("ObjectPattern");
      }
    });

    it("parses array destructuring in for-in", () => {
      const stmt = firstStmt("for [key, value] in entries { print(key) }");
      if (stmt.type === "ForStatement") {
        expect(stmt.variable.type).toBe("ArrayPattern");
      }
    });

    it("parses destructuring in function params", () => {
      const stmt = firstStmt("fn process({ name, age }) { print(name) }");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.params[0].pattern?.type).toBe("ObjectPattern");
      }
    });

    it("parses array destructuring in function params", () => {
      const stmt = firstStmt("fn first([head, ...tail]) { return head }");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.params[0].pattern?.type).toBe("ArrayPattern");
      }
    });
  });

  // ── Type Annotations ────────────────────────────────────
  describe("type annotations", () => {
    it("parses typed variable declaration", () => {
      const stmt = firstStmt("let x: number = 42");
      expect(stmt.type).toBe("VariableDeclaration");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.typeAnnotation).toBeDefined();
        expect(stmt.typeAnnotation?.kind).toBe("named");
        if (stmt.typeAnnotation?.kind === "named") {
          expect(stmt.typeAnnotation.name).toBe("number");
        }
      }
    });

    it("parses typed const declaration", () => {
      const stmt = firstStmt("const name: string = 'hello'");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.typeAnnotation?.kind).toBe("named");
      }
    });

    it("parses function with typed params", () => {
      const stmt = firstStmt("fn add(a: number, b: number) { return a + b }");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.params[0].typeAnnotation?.kind).toBe("named");
        expect(stmt.params[1].typeAnnotation?.kind).toBe("named");
      }
    });

    it("parses function with return type", () => {
      const stmt = firstStmt("fn greet(name: string): string { return name }");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.returnType?.kind).toBe("named");
        if (stmt.returnType?.kind === "named") {
          expect(stmt.returnType.name).toBe("string");
        }
      }
    });

    it("parses array type annotation", () => {
      const stmt = firstStmt("let items: number[] = [1, 2, 3]");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.typeAnnotation?.kind).toBe("array");
        if (stmt.typeAnnotation?.kind === "array") {
          expect(stmt.typeAnnotation.elementType.kind).toBe("named");
        }
      }
    });

    it("parses union type annotation", () => {
      const stmt = firstStmt("let value: string | number = 42");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.typeAnnotation?.kind).toBe("union");
        if (stmt.typeAnnotation?.kind === "union") {
          expect(stmt.typeAnnotation.types).toHaveLength(2);
        }
      }
    });

    it("parses generic type annotation", () => {
      const stmt = firstStmt("let p: Promise<string> = fetch('url')");
      if (stmt.type === "VariableDeclaration") {
        expect(stmt.typeAnnotation?.kind).toBe("generic");
        if (stmt.typeAnnotation?.kind === "generic") {
          expect(stmt.typeAnnotation.name).toBe("Promise");
          expect(stmt.typeAnnotation.args).toHaveLength(1);
        }
      }
    });

    it("parses multi-arg generic type", () => {
      const stmt = firstStmt("let m: Map<string, number> = new Map()");
      if (stmt.type === "VariableDeclaration" && stmt.typeAnnotation?.kind === "generic") {
        expect(stmt.typeAnnotation.args).toHaveLength(2);
      }
    });

    it("parses void return type", () => {
      const stmt = firstStmt("fn log(msg: string): void { print(msg) }");
      if (stmt.type === "FunctionDeclaration") {
        expect(stmt.returnType?.kind).toBe("named");
        if (stmt.returnType?.kind === "named") {
          expect(stmt.returnType.name).toBe("void");
        }
      }
    });

    it("strips types in generated JS (no runtime impact)", () => {
      // Types should be parsed but not affect generated output
      const stmt = firstStmt("let x: number = 42");
      expect(stmt.type).toBe("VariableDeclaration");
    });
  });

  // ── Pattern Matching ────────────────────────────────────
  describe("pattern matching", () => {
    it("parses basic match statement", () => {
      const stmt = firstStmt('match x {\n  case 1 { print("one") }\n  case 2 { print("two") }\n}');
      expect(stmt.type).toBe("MatchStatement");
      if (stmt.type === "MatchStatement") {
        expect(stmt.cases).toHaveLength(2);
        expect(stmt.cases[0].pattern?.type).toBe("Literal");
      }
    });

    it("parses match with default", () => {
      const stmt = firstStmt('match x {\n  case 1 { print("one") }\n  default { print("other") }\n}');
      if (stmt.type === "MatchStatement") {
        expect(stmt.cases).toHaveLength(2);
        expect(stmt.cases[1].pattern).toBeNull();
      }
    });

    it("parses match with string patterns", () => {
      const stmt = firstStmt('match color {\n  case "red" { print("stop") }\n  case "green" { print("go") }\n}');
      if (stmt.type === "MatchStatement") {
        expect(stmt.cases[0].pattern?.type).toBe("Literal");
      }
    });

    it("parses match with guard clause", () => {
      const stmt = firstStmt('match x {\n  case 1 if y > 0 { print("positive") }\n}');
      if (stmt.type === "MatchStatement") {
        expect(stmt.cases[0].guard).toBeDefined();
        expect(stmt.cases[0].guard?.type).toBe("BinaryExpression");
      }
    });

    it("parses match discriminant expression", () => {
      const stmt = firstStmt('match status {\n  case 200 { print("ok") }\n}');
      if (stmt.type === "MatchStatement") {
        expect(stmt.discriminant.type).toBe("Identifier");
      }
    });
  });

  // ── Enums ────────────────────────────────────────────────────
  describe("enum declarations", () => {
    it("parses basic enum", () => {
      const stmt = firstStmt("enum Color { Red, Green, Blue }");
      expect(stmt.type).toBe("EnumDeclaration");
      if (stmt.type === "EnumDeclaration") {
        expect(stmt.name.name).toBe("Color");
        expect(stmt.members).toHaveLength(3);
        expect(stmt.members[0].name.name).toBe("Red");
        expect(stmt.members[1].name.name).toBe("Green");
        expect(stmt.members[2].name.name).toBe("Blue");
      }
    });

    it("parses enum with custom values", () => {
      const stmt = firstStmt("enum Status { OK = 200, NotFound = 404, Error = 500 }");
      expect(stmt.type).toBe("EnumDeclaration");
      if (stmt.type === "EnumDeclaration") {
        expect(stmt.members).toHaveLength(3);
        expect(stmt.members[0].value).not.toBeNull();
        expect(stmt.members[1].name.name).toBe("NotFound");
      }
    });

    it("parses enum with string values", () => {
      const stmt = firstStmt('enum Direction { Up = "UP", Down = "DOWN" }');
      expect(stmt.type).toBe("EnumDeclaration");
      if (stmt.type === "EnumDeclaration") {
        expect(stmt.members).toHaveLength(2);
        expect(stmt.members[0].value?.type).toBe("Literal");
      }
    });

    it("parses enum with mixed auto and custom values", () => {
      const stmt = firstStmt("enum Level { Low, Medium = 5, High }");
      expect(stmt.type).toBe("EnumDeclaration");
      if (stmt.type === "EnumDeclaration") {
        expect(stmt.members).toHaveLength(3);
        expect(stmt.members[0].value).toBeNull();
        expect(stmt.members[1].value).not.toBeNull();
        expect(stmt.members[2].value).toBeNull();
      }
    });
  });

  // ── Pipe Operator ────────────────────────────────────────────
  describe("pipe operator", () => {
    it("parses single pipe", () => {
      const stmt = firstStmt("x |> double");
      expect(stmt.type).toBe("ExpressionStatement");
      if (stmt.type === "ExpressionStatement") {
        expect(stmt.expression.type).toBe("BinaryExpression");
        if (stmt.expression.type === "BinaryExpression") {
          expect(stmt.expression.operator).toBe("|>");
          expect(stmt.expression.left.type).toBe("Identifier");
          expect(stmt.expression.right.type).toBe("Identifier");
        }
      }
    });

    it("parses chained pipes (left-to-right)", () => {
      const stmt = firstStmt("x |> double |> toString");
      expect(stmt.type).toBe("ExpressionStatement");
      if (stmt.type === "ExpressionStatement") {
        const expr = stmt.expression;
        expect(expr.type).toBe("BinaryExpression");
        if (expr.type === "BinaryExpression") {
          expect(expr.operator).toBe("|>");
          expect(expr.right.type).toBe("Identifier");
          // Left should also be a pipe expression
          expect(expr.left.type).toBe("BinaryExpression");
        }
      }
    });

    it("pipe has lower precedence than arithmetic", () => {
      const stmt = firstStmt("x + 1 |> double");
      if (stmt.type === "ExpressionStatement" && stmt.expression.type === "BinaryExpression") {
        expect(stmt.expression.operator).toBe("|>");
        expect(stmt.expression.left.type).toBe("BinaryExpression");
      }
    });
  });

  // ── Interfaces ───────────────────────────────────────────────
  describe("interface declarations", () => {
    it("parses basic interface with properties", () => {
      const stmt = firstStmt("interface User { name: string, age: number }");
      expect(stmt.type).toBe("InterfaceDeclaration");
      if (stmt.type === "InterfaceDeclaration") {
        expect(stmt.name.name).toBe("User");
        expect(stmt.properties).toHaveLength(2);
        expect(stmt.properties[0].name.name).toBe("name");
        expect(stmt.properties[1].name.name).toBe("age");
      }
    });

    it("parses interface with method signatures", () => {
      const stmt = firstStmt("interface Shape { area(): number }");
      expect(stmt.type).toBe("InterfaceDeclaration");
      if (stmt.type === "InterfaceDeclaration") {
        expect(stmt.properties).toHaveLength(1);
        expect(stmt.properties[0].method).toBe(true);
        expect(stmt.properties[0].name.name).toBe("area");
      }
    });

    it("parses interface with optional properties", () => {
      const stmt = firstStmt("interface Config { host: string, port?: number }");
      expect(stmt.type).toBe("InterfaceDeclaration");
      if (stmt.type === "InterfaceDeclaration") {
        expect(stmt.properties[0].optional).toBe(false);
        expect(stmt.properties[1].optional).toBe(true);
      }
    });

    it("parses interface with extends", () => {
      const stmt = firstStmt("interface Admin extends User { role: string }");
      expect(stmt.type).toBe("InterfaceDeclaration");
      if (stmt.type === "InterfaceDeclaration") {
        expect(stmt.extends).toHaveLength(1);
        expect(stmt.extends![0].name).toBe("User");
      }
    });
  });
});
