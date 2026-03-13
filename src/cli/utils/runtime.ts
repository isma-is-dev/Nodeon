import vm from "vm";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { RED, BOLD, RESET, DIM, CYAN } from "./colors";

const sandboxGlobals = {
  console,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  JSON,
  Math,
  Date,
  RegExp,
  Error,
  TypeError,
  RangeError,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Map,
  Set,
  Promise,
  Symbol,
};

export function runInSandbox(jsCode: string, filename: string): void {
  try {
    vm.runInNewContext(jsCode, { ...sandboxGlobals }, { filename });
  } catch (err: any) {
    const name = err?.name || "RuntimeError";
    const message = err?.message || String(err);

    const stack = typeof err?.stack === "string" ? err.stack : "";
    const locMatch = stack.match(/([^\s()]+\.\w+):(\d+):(\d+)/);
    const lineNum = locMatch ? Number(locMatch[2]) : 1;
    const colNum = locMatch ? Number(locMatch[3]) : 1;
    const fileOnStack = locMatch ? locMatch[1] : filename;

    // Prefer original .no source if it exists alongside .js.
    const candidateNo = fileOnStack.endsWith(".no") ? fileOnStack : fileOnStack.replace(/\.js$/, ".no");
    const resolvedNo = resolve(process.cwd(), candidateNo);
    const resolvedJs = resolve(process.cwd(), fileOnStack);
    const filePath = existsSync(resolvedNo) ? resolvedNo : resolvedJs;
    let sourceLine = "";
    if (existsSync(filePath)) {
      const fileLines = readFileSync(filePath, "utf8").split(/\r?\n/);
      sourceLine = fileLines[lineNum - 1] ?? "";
    }

    const relPath = filePath ? filePath.replace(process.cwd() + "/", "") : fileOnStack;
    console.error(`${RED}${BOLD}${name}${RESET}: ${message}`);
    console.error(`${DIM}  --> ${RESET}${CYAN}${relPath}:${lineNum}:${colNum}${RESET}`);
    if (sourceLine) {
      console.error(`   ${lineNum} | ${sourceLine}`);
      const marker = `${" ".repeat(Math.max(0, String(lineNum).length + 3 + Math.max(0, colNum - 1)))}^`;
      console.error(`   ${marker}`);
    }
    process.exit(1);
  }
}
