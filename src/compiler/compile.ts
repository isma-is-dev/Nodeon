import { Lexer } from "@lexer/lexer";
import { Parser } from "@parser/parser";
import { generateJS, generateJSWithSourceMap } from "@compiler/generator/js-generator";
import { Program } from "@ast/nodes";
import type { SourceMap } from "@compiler/generator/source-map";

export interface CompileResult {
  js: string;
  ast: Program;
}

export interface CompileWithMapResult {
  js: string;
  ast: Program;
  sourceMap: SourceMap;
}

export interface CompileOptions {
  minify?: boolean;
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const ast = compileToAST(source);
  const js = generateJS(ast, options.minify ?? false);
  return { js, ast };
}

export function compileWithSourceMap(
  source: string,
  sourceFile: string,
  outputFile: string,
  options: CompileOptions = {},
): CompileWithMapResult {
  const ast = compileToAST(source);
  const { js, sourceMap } = generateJSWithSourceMap(
    ast,
    sourceFile,
    source,
    outputFile,
    options.minify ?? false,
  );
  return { js, ast, sourceMap };
}

export function compileToAST(source: string): Program {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parseProgram();
}

export { Lexer } from "@lexer/lexer";
export { Parser } from "@parser/parser";
export { generateJS, generateJSWithSourceMap } from "@compiler/generator/js-generator";
export type { SourceMap } from "@compiler/generator/source-map";
