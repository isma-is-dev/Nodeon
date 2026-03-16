import { Lexer } from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
import { generateJS, generateJSWithSourceMap } from "./generator/js-generator.js";
import { typeCheck } from "./type-checker.js";
import { SourceMapBuilder } from "./generator/source-map.js";
import { format } from "./formatter/formatter.js";
import { PluginRegistry, defaultRegistry } from "./plugin.js";
export function compile(source, options) {
  const opts = options ?? {};
  const registry = opts.plugins ?? defaultRegistry;
  const ctx = { filePath: opts.filePath, compileOptions: opts, metadata: {} };
  const transformedSource = registry.runBeforeParse(source, ctx);
  let ast = compileToAST(transformedSource);
  ast = registry.runAfterParse(ast, ctx);
  const rawErrors = ast.errors ?? [];
  const parserErrors = [];
  for (const err of rawErrors) {
    parserErrors.push({ message: err.message, source: "parser" });
  }
  const typeErrors = opts.check ? typeCheck(ast) : [];
  const diagnostics = parserErrors.concat(typeErrors);
  ast = registry.runBeforeGenerate(ast, ctx);
  let js = generateJS(ast, opts.minify ?? false);
  js = registry.runAfterGenerate(js, ctx);
  return { js: js, ast: ast, diagnostics: diagnostics };
}
export function compileWithSourceMap(source, sourceFile, outputFile, options) {
  const opts = options ?? {};
  const registry = opts.plugins ?? defaultRegistry;
  const ctx = { filePath: opts.filePath ?? sourceFile, compileOptions: opts, metadata: {} };
  const transformedSource = registry.runBeforeParse(source, ctx);
  let ast = compileToAST(transformedSource);
  ast = registry.runAfterParse(ast, ctx);
  ast = registry.runBeforeGenerate(ast, ctx);
  const result = generateJSWithSourceMap(ast, sourceFile, transformedSource, outputFile, opts.minify ?? false);
  const js = registry.runAfterGenerate(result.js, ctx);
  return { js: js, ast: ast, sourceMap: result.sourceMap };
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
export { PluginRegistry, defaultRegistry } from "./plugin.js";