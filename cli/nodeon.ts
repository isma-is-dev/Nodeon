#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { compile, compileWithSourceMap } from "@compiler/compile";
import vm from "vm";
import readline from "readline";

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

  // Fallback: try to extract a numeric offset (e.g., "position 182") and map to line/col.
  const posMatch = err.message.match(/position\s+(\d+)/i) || err.message.match(/pos(?:ition)?[: ](\d+)/i);

  if (source && (match || posMatch)) {
    let line = 0;
    let col = 0;

    if (match) {
      line = parseInt(match[1], 10);
      col = parseInt(match[2], 10);
    } else if (posMatch) {
      const offset = parseInt(posMatch[1], 10);
      ({ line, col } = offsetToLineCol(source, offset));
    }

    if (line > 0 && col > 0) {
      const srcLines = source.split("\n");
      const lineStr = srcLines[line - 1] ?? "";
      const lineNum = String(line).padStart(4);
      lines.push(`  ${DIM}-->${RESET} ${CYAN}${file}:${line}:${col}${RESET}`);
      lines.push(`  ${DIM}${lineNum} |${RESET} ${lineStr}`);
      lines.push(`  ${DIM}${" ".repeat(4)} |${RESET} ${" ".repeat(col - 1)}${RED}^${RESET}`);
      return lines.join("\n");
    }
  }

  lines.push(`  ${DIM}-->${RESET} ${CYAN}${file}${RESET}`);

  return lines.join("\n");
}

function offsetToLineCol(src: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < src.length && i < offset; i++) {
    if (src[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function printHelp() {
  console.log(
`nodeon v${VERSION}

Usage: nodeon <command> [options] <file>

Commands:
  build [options] <input> [output]   Compile .no → .js
  run <input>                        Compile and execute
  repl                               Interactive REPL
  help                               Show this help
  version                            Show version

Build Options:
  -min, --minify    Minified output (e.g. nodeon build -min hello.no)
  --map             Generate source map (.js.map)

Examples:
  nodeon build hello.no              → hello.js
  nodeon build -min hello.no         → hello.min.js
  nodeon build hello.no out.js       → out.js
  nodeon run hello.no                → compile & execute
  nodeon repl                        → interactive mode`
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

function startRepl() {
  console.log(`${CYAN}${BOLD}Nodeon REPL${RESET} v${VERSION}`);
  console.log(`${DIM}Type .help for commands, .exit to quit${RESET}\n`);

  const sandbox: Record<string, any> = {
    console, setTimeout, setInterval, clearTimeout, clearInterval,
    JSON, Math, Date, RegExp, Error, TypeError, RangeError,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    Array, Object, String, Number, Boolean, Map, Set, Promise, Symbol,
  };
  const ctx = vm.createContext(sandbox);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GREEN}nodeon>${RESET} `,
    terminal: true,
  });

  let buffer = "";
  let multiLine = false;

  function evalInput(input: string) {
    try {
      const { js } = compile(input);
      const result = vm.runInContext(js, ctx, { filename: "repl.js" });
      if (result !== undefined) {
        console.log(`${CYAN}${formatValue(result)}${RESET}`);
      }
    } catch (err: any) {
      console.error(`${RED}${err.message}${RESET}`);
    }
  }

  function formatValue(val: any): string {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (typeof val === "string") return `"${val}"`;
    if (typeof val === "object") {
      try { return JSON.stringify(val, null, 2); } catch { return String(val); }
    }
    return String(val);
  }

  function hasUnclosedBraces(src: string): boolean {
    let depth = 0;
    for (const ch of src) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    return depth > 0;
  }

  rl.prompt();

  rl.on("line", (line: string) => {
    const trimmed = line.trim();

    // REPL commands
    if (!multiLine) {
      if (trimmed === ".exit" || trimmed === ".quit") {
        console.log(`${DIM}Bye!${RESET}`);
        rl.close();
        return;
      }
      if (trimmed === ".help") {
        console.log(`${BOLD}REPL Commands:${RESET}`);
        console.log(`  ${CYAN}.help${RESET}   Show this help`);
        console.log(`  ${CYAN}.exit${RESET}   Exit the REPL`);
        console.log(`  ${CYAN}.clear${RESET}  Clear the context\n`);
        console.log(`${DIM}Enter Nodeon code to compile and execute.${RESET}`);
        console.log(`${DIM}Multi-line input auto-detects unclosed { ( [${RESET}\n`);
        rl.prompt();
        return;
      }
      if (trimmed === ".clear") {
        for (const key of Object.keys(ctx)) {
          if (!(key in sandbox)) {
            delete (ctx as any)[key];
          }
        }
        console.log(`${YELLOW}Context cleared${RESET}`);
        rl.prompt();
        return;
      }
    }

    buffer += (buffer ? "\n" : "") + line;

    if (hasUnclosedBraces(buffer)) {
      multiLine = true;
      rl.setPrompt(`${DIM}...${RESET}   `);
      rl.prompt();
      return;
    }

    if (buffer.trim().length > 0) {
      evalInput(buffer);
    }
    buffer = "";
    multiLine = false;
    rl.setPrompt(`${GREEN}nodeon>${RESET} `);
    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
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

  if (cmd === "repl") {
    startRepl();
    return;
  }

  console.error(`Unknown command '${cmd}'`);
  printHelp();
  process.exit(1);
}

if (require.main === module) {
  main();
}
