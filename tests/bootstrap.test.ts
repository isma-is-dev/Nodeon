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

  it("compiler/formatter/formatter.no compiles", () => {
    const js = compileNoFile("compiler/formatter/formatter.no");
    expect(js).toContain("function format");
    expect(js).toContain("fmtStatement");
    expect(js.length).toBeGreaterThan(10000);
  });

  it("compiler/generator/source-map.no compiles", () => {
    const js = compileNoFile("compiler/generator/source-map.no");
    expect(js).toContain("class SourceMapBuilder");
    expect(js).toContain("vlqEncode");
  });

  it("compiler/errors.no compiles", () => {
    const js = compileNoFile("compiler/errors.no");
    expect(js).toContain("class NodeonError");
    expect(js).toContain("findSuggestions");
  });

  it("compiler/ast/visitor.no compiles", () => {
    const js = compileNoFile("compiler/ast/visitor.no");
    expect(js).toContain("walkProgram");
    expect(js).toContain("walkStatement");
    expect(js).toContain("walkExpression");
  });

  it("cli/utils/colors.no compiles", () => {
    const js = compileNoFile("cli/utils/colors.no");
    expect(js).toContain("RED");
    expect(js).toContain("RESET");
  });

  it("cli/utils/strings.no compiles", () => {
    const js = compileNoFile("cli/utils/strings.no");
    expect(js).toContain("levenshtein");
    expect(js).toContain("suggestClosest");
  });

  it("cli/utils/errors.no compiles", () => {
    const js = compileNoFile("cli/utils/errors.no");
    expect(js).toContain("formatError");
    expect(js).toContain("appendSourceContext");
  });

  it("cli/utils/runtime.no compiles", () => {
    const js = compileNoFile("cli/utils/runtime.no");
    expect(js).toContain("runInSandbox");
    expect(js).toContain("sandboxGlobals");
  });

  it("cli/utils/compile.no compiles", () => {
    const js = compileNoFile("cli/utils/compile.no");
    expect(js).toContain("compileFile");
    expect(js).toContain("computeCacheKey");
  });

  it("cli/commands/build.no compiles", () => {
    const js = compileNoFile("cli/commands/build.no");
    expect(js).toContain("runBuild");
  });

  it("cli/commands/run.no compiles", () => {
    const js = compileNoFile("cli/commands/run.no");
    expect(js).toContain("runRun");
  });

  it("cli/commands/check.no compiles", () => {
    const js = compileNoFile("cli/commands/check.no");
    expect(js).toContain("runCheck");
  });

  it("cli/commands/fmt.no compiles", () => {
    const js = compileNoFile("cli/commands/fmt.no");
    expect(js).toContain("runFmt");
  });

  it("cli/commands/help.no compiles", () => {
    const js = compileNoFile("cli/commands/help.no");
    expect(js).toContain("printHelp");
    expect(js).toContain("printVersion");
  });

  it("cli/commands/init.no compiles", () => {
    const js = compileNoFile("cli/commands/init.no");
    expect(js).toContain("runInit");
  });

  it("cli/commands/repl.no compiles", () => {
    const js = compileNoFile("cli/commands/repl.no");
    expect(js).toContain("startRepl");
  });

  it("cli/index.no compiles", () => {
    const js = compileNoFile("cli/index.no");
    expect(js).toContain("main");
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
      "compiler/formatter/formatter.no", "compiler/generator/source-map.no",
      "compiler/errors.no", "compiler/ast/visitor.no",
      "cli/utils/colors.no", "cli/utils/strings.no",
      "cli/utils/errors.no", "cli/utils/runtime.no", "cli/utils/compile.no",
      "cli/commands/build.no", "cli/commands/run.no", "cli/commands/check.no",
      "cli/commands/fmt.no", "cli/commands/help.no", "cli/commands/init.no",
      "cli/commands/repl.no", "cli/index.no",
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
