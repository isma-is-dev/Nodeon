import { describe, it, expect } from "vitest";
import { compile } from "@compiler/compile";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC_NO = resolve(__dirname, "..", "src-no");

function compileNoFile(relPath: string): string {
  const src = readFileSync(resolve(SRC_NO, relPath), "utf8");
  return compile(src).js;
}

describe("bootstrap: .no modules compile", () => {
  it("language/tokens.no compiles", () => {
    const js = compileNoFile("language/tokens.no");
    expect(js.length).toBeGreaterThan(0);
    expect(js).toContain("Identifier");
  });

  it("language/keywords.no compiles", () => {
    const js = compileNoFile("language/keywords.no");
    expect(js).toContain("new Set");
    expect(js).toContain('"fn"');
  });

  it("language/operators.no compiles", () => {
    const js = compileNoFile("language/operators.no");
    expect(js).toContain("OPERATORS");
    expect(js).toContain("TWO_CHAR_OPERATORS");
  });

  it("language/symbols.no compiles", () => {
    const js = compileNoFile("language/symbols.no");
    expect(js).toContain("DELIMITERS");
  });

  it("language/precedence.no compiles", () => {
    const js = compileNoFile("language/precedence.no");
    expect(js).toContain("PRECEDENCE");
    expect(js).toContain("COMPOUND_ASSIGN");
  });

  it("compiler/lexer/lexer.no compiles", () => {
    const js = compileNoFile("compiler/lexer/lexer.no");
    expect(js).toContain("class Lexer");
    expect(js).toContain("tokenize");
    expect(js.length).toBeGreaterThan(5000);
  });

  it("compiler/parser/parser-base.no compiles", () => {
    const js = compileNoFile("compiler/parser/parser-base.no");
    expect(js).toContain("class ParserBase");
    expect(js).toContain("checkKeyword");
    expect(js).toContain("consumeIdentifier");
  });

  it("compiler/compile.no compiles", () => {
    const js = compileNoFile("compiler/compile.no");
    expect(js).toContain("compile");
    expect(js).toContain("compileToAST");
  });

  it("compiler/resolver.no compiles", () => {
    const js = compileNoFile("compiler/resolver.no");
    expect(js).toContain("resolveImport");
    expect(js).toContain("rewriteImportSource");
  });

  it("compiler/generator/js-generator.no compiles", () => {
    const js = compileNoFile("compiler/generator/js-generator.no");
    expect(js).toContain("generateJS");
    expect(js).toContain("emitStatement");
    expect(js).toContain("emitExpression");
    expect(js.length).toBeGreaterThan(10000);
  });

  it("compiler/type-checker.no compiles", () => {
    const js = compileNoFile("compiler/type-checker.no");
    expect(js).toContain("class TypeEnv");
    expect(js).toContain("function typeCheck");
    expect(js).toContain("inferExpression");
  });

  it("compiler/parser/parser-types.no compiles", () => {
    const js = compileNoFile("compiler/parser/parser-types.no");
    expect(js).toContain("class ParserTypes");
    expect(js).toContain("parseTypeAnnotation");
    expect(js).toContain("parseObjectPattern");
  });

  it("compiler/parser/parser-expressions.no compiles", () => {
    const js = compileNoFile("compiler/parser/parser-expressions.no");
    expect(js).toContain("class ParserExpressions");
    expect(js).toContain("parseExpression");
    expect(js).toContain("parsePrimary");
    expect(js).toContain("parseStringLiteral");
    expect(js.length).toBeGreaterThan(10000);
  });

  it("compiler/parser/parser-statements.no compiles", () => {
    const js = compileNoFile("compiler/parser/parser-statements.no");
    expect(js).toContain("class ParserStatements");
    expect(js).toContain("parseBlock");
    expect(js).toContain("parseImportDeclaration");
    expect(js).toContain("parseClassDeclaration");
    expect(js.length).toBeGreaterThan(15000);
  });

  it("compiler/parser/parser.no compiles", () => {
    const js = compileNoFile("compiler/parser/parser.no");
    expect(js).toContain("class Parser");
    expect(js).toContain("parseProgram");
    expect(js).toContain("parseStatement");
  });
});

describe("bootstrap: self-compilation (compiled compiler compiles itself)", () => {
  // Build and bundle must have been run first: node scripts/build-no.js && node scripts/bundle-no.js
  const bundlePath = resolve(__dirname, "..", "dist-no", "nodeon-compiler.cjs");
  const bundleExists = require("fs").existsSync(bundlePath);

  it("compiled compiler bundle exists", () => {
    expect(bundleExists).toBe(true);
  });

  if (bundleExists) {
    const selfCompiler = require(bundlePath);

    const noFiles = [
      "language/tokens.no", "language/keywords.no", "language/operators.no",
      "language/symbols.no", "language/precedence.no",
      "compiler/lexer/lexer.no", "compiler/parser/parser-base.no",
      "compiler/parser/parser-types.no", "compiler/parser/parser-expressions.no",
      "compiler/parser/parser-statements.no", "compiler/parser/parser.no",
      "compiler/compile.no", "compiler/resolver.no",
      "compiler/generator/js-generator.no", "compiler/type-checker.no",
    ];

    for (const rel of noFiles) {
      it(`self-compiles ${rel}`, () => {
        const src = readFileSync(resolve(SRC_NO, rel), "utf8");
        const result = selfCompiler.compile(src);
        expect(result.js).toBeDefined();
        expect(result.js.length).toBeGreaterThan(0);
      });
    }
  }
});

function stripModuleSyntax(js: string): string {
  return js
    .replace(/^export /gm, "")
    .replace(/^import .+$/gm, "");
}

describe("bootstrap: compiled lexer produces valid tokens", () => {
  it("tokenizes a simple expression", () => {
    const keywordsJs = stripModuleSyntax(compileNoFile("language/keywords.no"));
    const operatorsJs = stripModuleSyntax(compileNoFile("language/operators.no"));
    const symbolsJs = stripModuleSyntax(compileNoFile("language/symbols.no"));
    const lexerJs = stripModuleSyntax(compileNoFile("compiler/lexer/lexer.no"));

    const bundle = `
      ${keywordsJs}
      ${operatorsJs}
      ${symbolsJs}
      ${lexerJs}
      return Lexer;
    `;

    const LexerClass = new Function(bundle)();
    const lexer = new LexerClass('let x = 42');
    const tokens = lexer.tokenize();

    expect(tokens.length).toBe(5); // let, x, =, 42, EOF
    expect(tokens[0].type).toBe("Keyword");
    expect(tokens[0].value).toBe("let");
    expect(tokens[1].type).toBe("Identifier");
    expect(tokens[1].value).toBe("x");
    expect(tokens[2].type).toBe("Operator");
    expect(tokens[2].value).toBe("=");
    expect(tokens[3].type).toBe("Number");
    expect(tokens[3].value).toBe("42");
    expect(tokens[4].type).toBe("EOF");
  });
});
