#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Lexer } from "../src/lexer/lexer";
import { Parser } from "../src/compiler/parser/parser";
import { TokenType } from "../src/language/tokens";

function printHelp() {
  console.log(`nodeon <command> [file]\n\nCommands:\n  build <input> [output]  Compile .no to .js\n  run <input>             Compile and execute\n  help                    Show this help`);
}

function compileFile(inputPath: string, outputPath?: string) {
  const absIn = resolve(process.cwd(), inputPath);
  const source = readFileSync(absIn, "utf8");
  const tokens = new Lexer(source).tokenize();
  // ensure EOF
  if (tokens[tokens.length - 1].type !== TokenType.EOF) {
    tokens.push({ type: TokenType.EOF, value: "", position: source.length });
  }
  const ast = new Parser(tokens).parseProgram();
  // TODO: implement generator; placeholder writes AST JSON
  const out = outputPath ? resolve(process.cwd(), outputPath) : absIn.replace(/\.no$/, ".ast.json");
  writeFileSync(out, JSON.stringify(ast, null, 2), "utf8");
  return { ast, out };
}

function runFile(inputPath: string) {
  const { ast, out } = compileFile(inputPath);
  console.log(`Compiled to AST at ${out}`);
  // TODO: generate JS and execute; placeholder prints AST
  console.log(JSON.stringify(ast, null, 2));
}

function main() {
  const [,, cmd, arg1, arg2] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "build") {
    if (!arg1) {
      console.error("build requires an input .no file");
      process.exit(1);
    }
    const { out } = compileFile(arg1, arg2);
    console.log(`Wrote output to ${out}`);
    return;
  }

  if (cmd === "run") {
    if (!arg1) {
      console.error("run requires an input .no file");
      process.exit(1);
    }
    runFile(arg1);
    return;
  }

  console.error(`Unknown command '${cmd}'`);
  printHelp();
  process.exit(1);
}

main();
