import { Lexer } from "@lexer/lexer";
import { Parser } from "@parser/parser";
import { generateJS } from "@compiler/generator/js-generator";
import { Program } from "@ast/nodes";

export interface CompileResult {
  js: string;
  ast: Program;
}

export interface CompileOptions {
  minify?: boolean;
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const ast = compileToAST(source);
  const js = generateJS(ast, options.minify ?? false);
  return { js, ast };
}

export function compileToAST(source: string): Program {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parseProgram();
}

export { Lexer } from "@lexer/lexer";
export { Parser } from "@parser/parser";
export { generateJS } from "@compiler/generator/js-generator";
