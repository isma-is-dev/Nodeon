#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { compile, compileWithSourceMap } from "@compiler/compile";
import vm from "vm";

const VERSION = "0.1.0";

// ── ANSI colors (no dependencies) ────────────────────────
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function formatError(file: string, source: string, err: Error): string {
  const lines: string[] = [];
  lines.push(`${RED}${BOLD}error${RESET}: ${err.message}`);

  // Extract line:col from SyntaxError messages like "... at 3:5"
  const match = err.message.match(/at (\d+):(\d+)$/);
  if (match && source) {
    const line = parseInt(match[1], 10);
    const col = parseInt(match[2], 10);
    const srcLines = source.split("\n");
    const lineStr = srcLines[line - 1] ?? "";
    const lineNum = String(line).padStart(4);
    lines.push(`  ${DIM}-->${RESET} ${CYAN}${file}:${line}:${col}${RESET}`);
    lines.push(`  ${DIM}${lineNum} |${RESET} ${lineStr}`);
    lines.push(`  ${DIM}${" ".repeat(4)} |${RESET} ${" ".repeat(col - 1)}${RED}^${RESET}`);
  } else {
    lines.push(`  ${DIM}-->${RESET} ${CYAN}${file}${RESET}`);
  }

  return lines.join("\n");
}

function printHelp() {
  console.log(
`nodeon v${VERSION}

Usage: nodeon <command> [options] <file>

Commands:
  build [options] <input> [output]   Compile .no → .js
  run <input>                        Compile and execute
  help                               Show this help
  version                            Show version

Build Options:
  -min, --minify    Minified output (e.g. nodeon build -min hello.no)
  --map             Generate source map (.js.map)

Examples:
  nodeon build hello.no              → hello.js
  nodeon build -min hello.no         → hello.min.js
  nodeon build hello.no out.js       → out.js
  nodeon run hello.no                → compile & execute`
  );
}

interface CLICompileOptions {
  minify: boolean;
  write: boolean;
  sourceMap?: boolean;
}

function compileFile(inputPath: string, outputPath?: string, opts: CLICompileOptions = { minify: false, write: true }) {
  const absIn = resolve(process.cwd(), inputPath);

  if (!existsSync(absIn)) {
    console.error(`${RED}error${RESET}: file not found: ${CYAN}${inputPath}${RESET}`);
    process.exit(1);
  }

  const source = readFileSync(absIn, "utf8");

  try {
    let out: string | null = null;
    if (opts.write) {
      if (outputPath) {
        out = resolve(process.cwd(), outputPath);
      } else if (opts.minify) {
        out = absIn.replace(/\.no$/, ".min.js");
      } else {
        out = absIn.replace(/\.no$/, ".js");
      }
    }

    if (opts.sourceMap && out) {
      const outFile = basename(out);
      const { js: jsCode, ast, sourceMap } = compileWithSourceMap(source, inputPath, outFile, { minify: opts.minify });
      writeFileSync(out, jsCode, "utf8");
      writeFileSync(out + ".map", JSON.stringify(sourceMap), "utf8");
      return { ast, jsCode, out };
    }

    const { js: jsCode, ast } = compile(source, { minify: opts.minify });
    if (out) writeFileSync(out, jsCode, "utf8");
    return { ast, jsCode, out };
  } catch (err: any) {
    console.error(formatError(inputPath, source, err));
    process.exit(1);
  }
}

function runFile(inputPath: string) {
  const result = compileFile(inputPath, undefined, { minify: false, write: false });
  if (!result) return;
  const { jsCode } = result;
  try {
    vm.runInNewContext(jsCode, { console, setTimeout, setInterval, clearTimeout, clearInterval, JSON, Math, Date, RegExp, Error, TypeError, RangeError, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Array, Object, String, Number, Boolean, Map, Set, Promise, Symbol }, { filename: basename(inputPath).replace(/\.no$/, ".js") });
  } catch (err: any) {
    console.error(`${RED}${BOLD}runtime error${RESET}: ${err.message}`);
    process.exit(1);
  }
}

export function main(argv = process.argv) {
  const args = argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    console.log(`nodeon v${VERSION}`);
    return;
  }

  if (cmd === "build") {
    const flags = args.slice(1);
    const minify = flags.includes("-min") || flags.includes("--minify");
    const sourceMap = flags.includes("--map");
    const positional = flags.filter((f) => !f.startsWith("-"));

    if (positional.length === 0) {
      console.error("build requires an input .no file");
      process.exit(1);
    }

    const input = positional[0];
    const output = positional[1];
    const { out } = compileFile(input, output, { minify, write: true, sourceMap });
    const extra = [minify ? "minified" : "", sourceMap ? "+map" : ""].filter(Boolean).join(", ");
    console.log(`✓ ${basename(input)} → ${basename(out!)}${extra ? ` (${extra})` : ""}`);
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
