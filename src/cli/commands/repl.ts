import readline from "readline";
import { compile } from "@compiler/compile";
import { runInContext } from "vm";
import { CYAN, GREEN, DIM, YELLOW, RESET } from "../utils/colors";
import { formatError } from "../utils/errors";

export function startRepl() {
  console.log(`${CYAN}${""}Nodeon REPL${RESET}`);
  console.log(`${DIM}Type .help for commands, .exit to quit${RESET}\n`);

  const sandbox: Record<string, any> = {
    console, setTimeout, setInterval, clearTimeout, clearInterval,
    JSON, Math, Date, RegExp, Error, TypeError, RangeError,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    Array, Object, String, Number, Boolean, Map, Set, Promise, Symbol,
  };
  const ctx = { ...sandbox } as any;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GREEN}nodeon>${RESET} `,
    terminal: true,
  });

  let buffer = "";
  let multiLine = false;

  const hasUnclosedBraces = (src: string): boolean => {
    let depth = 0;
    for (const ch of src) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    return depth > 0;
  };

  const formatValue = (val: any): string => {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (typeof val === "string") return `"${val}"`;
    if (typeof val === "object") {
      try { return JSON.stringify(val, null, 2); } catch { return String(val); }
    }
    return String(val);
  };

  const evalInput = (input: string) => {
    try {
      const { js } = compile(input);
      const result = runInContext(js, ctx, { filename: "repl.js" });
      if (result !== undefined) {
        console.log(`${CYAN}${formatValue(result)}${RESET}`);
      }
    } catch (err: any) {
      console.error(formatError("<repl>", input, err));
    }
  };

  rl.prompt();

  rl.on("line", (line: string) => {
    const trimmed = line.trim();

    if (!multiLine) {
      if (trimmed === ".exit" || trimmed === ".quit") {
        console.log(`${DIM}Bye!${RESET}`);
        rl.close();
        return;
      }
      if (trimmed === ".help") {
        console.log(`${CYAN}.help${RESET}   Show this help`);
        console.log(`${CYAN}.exit${RESET}   Exit the REPL`);
        console.log(`${CYAN}.clear${RESET}  Clear the context\n`);
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

  rl.on("close", () => process.exit(0));
}
