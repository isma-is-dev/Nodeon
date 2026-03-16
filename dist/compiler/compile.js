import { Lexer } from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
import { generateJS, generateJSWithSourceMap } from "./generator/js-generator.js";
import { typeCheck } from "./type-checker.js";
import { SourceMapBuilder } from "./generator/source-map.js";
import { format } from "./formatter/formatter.js";
export function compile(source, options) {
  const opts = options ?? {};
  const ast = compileToAST(source);
  const rawErrors = ast.errors ?? [];
  const parserErrors = [];
  for (const err of rawErrors) {
    parserErrors.push({ message: err.message, source: "parser" });
  }
  const typeErrors = opts.check ? typeCheck(ast) : [];
  const diagnostics = parserErrors.concat(typeErrors);
  const js = generateJS(ast, opts.minify ?? false);
  return { js: js, ast: ast, diagnostics: diagnostics };
}
export function compileWithSourceMap(source, sourceFile, outputFile, options) {
  const opts = options ?? {};
  const ast = compileToAST(source);
  const result = generateJSWithSourceMap(ast, sourceFile, source, outputFile, opts.minify ?? false);
  return { js: result.js, ast: ast, sourceMap: result.sourceMap };
}
export function compileToAST(source) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens, source).parseProgram();
}
export { Lexer } from "./lexer/lexer.js";
export { Parser } from "./parser/parser.js";
export { generateJS, generateJSWithSourceMap } from "./generator/js-generator.js";
export { SourceMapBuilder } from "./generator/source-map.js";
export { typeCheck } from "./type-checker.js";
export { format } from "./formatter/formatter.js";