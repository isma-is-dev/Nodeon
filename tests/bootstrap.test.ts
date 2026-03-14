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
