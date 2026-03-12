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
});
