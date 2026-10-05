import { Lexer } from "@lexer/lexer";
import { Parser } from "@parser/parser";
import { generateJS, generateJSWithSourceMap } from "@compiler/generator/js-generator";
import { Program } from "@ast/nodes";
import type { SourceMap } from "@compiler/generator/source-map";
import { typeCheck, TypeDiagnostic } from "@compiler/type-checker";
import { PluginRegistry, defaultRegistry } from "@compiler/plugin";
import type { CompilerPlugin, PluginContext } from "@compiler/plugin";

export interface CompileResult {
  js: string;
  ast: Program;
  diagnostics: TypeDiagnostic[];
}

export interface CompileWithMapResult {
  js: string;
  ast: Program;
  sourceMap: SourceMap;
}

export interface CompileOptions {
  minify?: boolean;
  check?: boolean;
  plugins?: PluginRegistry;
  filePath?: string;
  /**
   * Throw when the source contains syntax errors instead of returning partial
   * output. Without this, a caller that ignores `diagnostics` — the build
   * script, `nodeon run` — happily ships a program from which a broken
   * statement (and sometimes the whole enclosing function) was removed.
   */
  strict?: boolean;
}

/** Thrown by `compile()` in strict mode when the source does not parse. */
export class CompileSyntaxError extends Error {
  public readonly diagnostics: TypeDiagnostic[];
  constructor(diagnostics: TypeDiagnostic[]) {
    super(
      `Nodeon syntax error: ${diagnostics.map((d) => d.message).join("; ")}`
    );
    this.name = "CompileSyntaxError";
    this.diagnostics = diagnostics;
  }
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const registry = options.plugins ?? defaultRegistry;
  const ctx: PluginContext = { filePath: options.filePath, compileOptions: options, metadata: {} };

  // Plugin: beforeParse
  const transformedSource = registry.runBeforeParse(source, ctx);

  let ast = compileToAST(transformedSource);

  // Plugin: afterParse
  ast = registry.runAfterParse(ast, ctx);

  const parserErrors = ((ast as any).errors ?? []).map((e: any) => ({ message: e.message, source: "parser" as const }));
  const diagnostics: TypeDiagnostic[] = options.check ? [...parserErrors, ...typeCheck(ast)] : parserErrors;

  // Strict mode refuses to generate code from a source that does not parse.
  // Emitting "everything except the broken part" is a silent, partial program.
  if (options.strict && parserErrors.length > 0) {
    throw new CompileSyntaxError(parserErrors);
  }

  // Plugin: beforeGenerate
  ast = registry.runBeforeGenerate(ast, ctx);

  let js = generateJS(ast, options.minify ?? false);

  // Plugin: afterGenerate
  js = registry.runAfterGenerate(js, ctx);

  return { js, ast, diagnostics };
}

export function compileWithSourceMap(
  source: string,
  sourceFile: string,
  outputFile: string,
  options: CompileOptions = {},
): CompileWithMapResult {
  const registry = options.plugins ?? defaultRegistry;
  const ctx: PluginContext = { filePath: options.filePath ?? sourceFile, compileOptions: options, metadata: {} };

  const transformedSource = registry.runBeforeParse(source, ctx);
  let ast = compileToAST(transformedSource);
  ast = registry.runAfterParse(ast, ctx);
  ast = registry.runBeforeGenerate(ast, ctx);

  const result = generateJSWithSourceMap(
    ast,
    sourceFile,
    transformedSource,
    outputFile,
    options.minify ?? false,
  );

  const js = registry.runAfterGenerate(result.js, ctx);
  return { js, ast, sourceMap: result.sourceMap };
}

export function compileToAST(source: string): Program {
  // The lexer can report two kinds of problem. A recoverable one (an unexpected
  // character) is collected in `lexer.errors` and scanning continues, so the
  // rest of the program survives. A fatal one (an unterminated string) throws,
  // and is converted here into a normal diagnostic — left uncaught it escaped
  // `compile()` entirely, so the caller never saw it, no `ErrorStatement` was
  // produced, and the build script counted the file as a success while writing
  // out an empty program.
  let tokens: any[];
  let lexErrors: SyntaxError[] = [];
  try {
    const lexer = new Lexer(source);
    tokens = lexer.tokenize();
    lexErrors = (lexer as any).errors ?? [];
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      return {
        type: "Program",
        body: [{ type: "ErrorStatement", message: err.message } as any],
        errors: [err],
      } as any;
    }
    throw err;
  }

  const program: any = new Parser(tokens, source).parseProgram();
  if (lexErrors.length > 0) {
    program.errors = [...lexErrors, ...(program.errors ?? [])];
    program.body = [
      ...lexErrors.map((e) => ({ type: "ErrorStatement", message: e.message })),
      ...(program.body ?? []),
    ];
  }
  return program as Program;
}

export { Lexer } from "@lexer/lexer";
export { Parser } from "@parser/parser";
export { generateJS, generateJSWithSourceMap } from "@compiler/generator/js-generator";
export type { SourceMap } from "@compiler/generator/source-map";
export { typeCheck } from "@compiler/type-checker";
export type { TypeDiagnostic } from "@compiler/type-checker";
export { PluginRegistry, defaultRegistry } from "@compiler/plugin";
export type { CompilerPlugin, PluginContext } from "@compiler/plugin";
