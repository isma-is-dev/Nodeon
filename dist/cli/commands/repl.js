const readline = require("readline");
const vm = require("vm");
import { compile } from "../../compiler/compile.js";
import { CYAN, GREEN, DIM, YELLOW, RESET } from "../utils/colors.js";
import { formatError } from "../utils/errors.js";
function hasUnclosedBraces(src) {
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "(" || ch === "[") {
      depth = depth + 1;
    }
    if (ch === ")" || ch === "]") {
      depth = depth - 1;
    }
    if (ch === "{") {
      depth = depth + 1;
    }
    if (ch === "}") {
      depth = depth - 1;
    }
    i = i + 1;
  }
  return depth > 0;
}
function formatValue(val) {
  if (val === null) {
    return "null";
  }
  if (val === undefined) {
    return "undefined";
  }
  if (typeof val === "string") {
    return "\"" + val + "\"";
  }
  if (typeof val === "object") {
    try {
      return JSON.stringify(val, null, 2);
    } catch (e) {
      return String(val);
    }
  }
  return String(val);
}
export function startRepl() {
  console.log(CYAN + "Nodeon REPL" + RESET);
  console.log(DIM + "Type .help for commands, .exit to quit" + RESET + "\n");
  const sandbox = { console: console, setTimeout: setTimeout, setInterval: setInterval, clearTimeout: clearTimeout, clearInterval: clearInterval, JSON: JSON, Math: Math, Date: Date, RegExp: RegExp, Error: Error, TypeError: TypeError, RangeError: RangeError, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, isFinite: isFinite, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent, Array: Array, Object: Object, String: String, Number: Number, Boolean: Boolean, Map: Map, Set: Set, Promise: Promise, Symbol: Symbol };
  const ctx = vm.createContext(Object.assign({}, sandbox));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: GREEN + "nodeon>" + RESET + " ", terminal: true });
  let buffer = "";
  let multiLine = false;
  const evalInput = input => {
    try {
      const result = compile(input);
      const val = vm.runInContext(result.js, ctx);
      if (val !== undefined) {
        console.log(CYAN + formatValue(val) + RESET);
      }
    } catch (err) {
      console.error(formatError("<repl>", input, err));
    }
  };
  rl.prompt();
  rl.on("line", line => {
    const trimmed = line.trim();
    if (!multiLine) {
      if (trimmed === ".exit" || trimmed === ".quit") {
        console.log(DIM + "Bye!" + RESET);
        rl.close();
        return;
      }
      if (trimmed === ".help") {
        console.log(CYAN + ".help" + RESET + "   Show this help");
        console.log(CYAN + ".exit" + RESET + "   Exit the REPL");
        console.log(CYAN + ".clear" + RESET + "  Clear the context\n");
        console.log(DIM + "Enter Nodeon code to compile and execute." + RESET);
        console.log(DIM + "Multi-line input auto-detects unclosed braces/parens/brackets" + RESET + "\n");
        rl.prompt();
        return;
      }
      if (trimmed === ".clear") {
        const keys = Object.keys(ctx);
        let ki = 0;
        while (ki < keys.length) {
          const k = keys[ki];
          if (sandbox[k] === undefined) {
            delete ctx[k];
          }
          ki = ki + 1;
        }
        console.log(YELLOW + "Context cleared" + RESET);
        rl.prompt();
        return;
      }
    }
    buffer = buffer + buffer ? "\n" : "" + line;
    if (hasUnclosedBraces(buffer)) {
      multiLine = true;
      rl.setPrompt(DIM + "..." + RESET + "   ");
      rl.prompt();
      return;
    }
    if (buffer.trim().length > 0) {
      evalInput(buffer);
    }
    buffer = "";
    multiLine = false;
    rl.setPrompt(GREEN + "nodeon>" + RESET + " ");
    rl.prompt();
  });
  rl.on("close", () => process.exit(0));
}