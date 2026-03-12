#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve, basename } from "path";
import { Lexer } from "@lexer/lexer";
import { Parser } from "@parser/parser";
import { generateJS } from "@compiler/generator/js-generator";
import vm from "vm";

function printHelp() {
  console.log(
`nodeon <command> [options] <file>

Commands:
  build [options] <input> [output]   Compile .no → .js
  run <input>                        Compile and execute
  help                               Show this help

Build Options:
  -min, --minify    Minified output (e.g. nodeon build -min hello.no)

Examples:
  nodeon build hello.no              → hello.js
  nodeon build -min hello.no         → hello.min.js
  nodeon build hello.no out.js       → out.js
  nodeon run hello.no                → compile & execute`
  );
}

interface CompileOptions {
  minify: boolean;
}

function compileFile(inputPath: string, outputPath?: string, opts: CompileOptions = { minify: false }) {
  const absIn = resolve(process.cwd(), inputPath);
  const source = readFileSync(absIn, "utf8");
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens).parseProgram();
  const jsCode = generateJS(ast, opts.minify);

  let out: string;
  if (outputPath) {
    out = resolve(process.cwd(), outputPath);
  } else if (opts.minify) {
    out = absIn.replace(/\.no$/, ".min.js");
  } else {
    out = absIn.replace(/\.no$/, ".js");
  }

  writeFileSync(out, jsCode, "utf8");
  return { ast, jsCode, out };
}

function runFile(inputPath: string) {
  const { jsCode, out } = compileFile(inputPath);
  console.log(`Compiled → ${basename(out)}`);
  // Ejecución en un contexto aislado (Node runtime por ahora)
  vm.runInNewContext(jsCode, { console }, { filename: out });
}

export function main(argv = process.argv) {
  const args = argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "build") {
    const flags = args.slice(1);
    const minify = flags.includes("-min") || flags.includes("--minify");
    const positional = flags.filter((f) => !f.startsWith("-"));

    if (positional.length === 0) {
      console.error("build requires an input .no file");
      process.exit(1);
    }

    const input = positional[0];
    const output = positional[1];
    const { out } = compileFile(input, output, { minify });
    console.log(`✓ ${basename(input)} → ${basename(out)}${minify ? " (minified)" : ""}`);
    return;
  }

  if (cmd === "run") {
    const input = args[1];
    if (!input) {
      console.error("run requires an input .no file");
      process.exit(1);
    }
    runFile(input);
    return;
  }

  console.error(`Unknown command '${cmd}'`);
  printHelp();
  process.exit(1);
}

if (require.main === module) {
  main();
}
