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
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens, source).parseProgram();
}

export { Lexer } from "@lexer/lexer";
export { Parser } from "@parser/parser";
export { generateJS, generateJSWithSourceMap } from "@compiler/generator/js-generator";
export type { SourceMap } from "@compiler/generator/source-map";
export { typeCheck } from "@compiler/type-checker";
export type { TypeDiagnostic } from "@compiler/type-checker";
export { PluginRegistry, defaultRegistry } from "@compiler/plugin";
export type { CompilerPlugin, PluginContext } from "@compiler/plugin";
