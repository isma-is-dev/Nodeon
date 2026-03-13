import { existsSync } from "fs";
import { basename, join, resolve } from "path";
import { compileFile } from "../utils/compile";
import { runInSandbox } from "../utils/runtime";
import { RED, BOLD, RESET, CYAN } from "../utils/colors";
import { suggestClosest } from "../utils/strings";

export function resolveNodeonFile(input: string): string {
  const candidates = [input, `${input}.no`, join(input, "index.no")];

  for (const candidate of candidates) {
    const abs = resolve(process.cwd(), candidate);
    if (existsSync(abs)) return candidate;
  }

  // Look for similar .no files to suggest
  const suggestion = suggestClosestFile(input);
  const msg = suggestion
    ? `file not found: ${input} (did you mean: ${suggestion} ?)`
    : `file not found: ${input}`;
  throw new Error(msg);
}

function suggestClosestFile(input: string): string | null {
  const parsed = basename(input);
  const { dirname } = require("path") as typeof import("path");
  const { readdirSync } = require("fs") as typeof import("fs");
  const dir = dirname(input) === "." ? "." : dirname(input);
  const desired = parsed.includes(".") ? parsed : `${parsed}.no`;
  const dirAbs = resolve(process.cwd(), dir);
  try {
    const entries = readdirSync(dirAbs, { withFileTypes: true });
    const noFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".no"))
      .map((e) => e.name);
    return suggestClosest(desired, noFiles, 3);
  } catch {
    return null;
  }
}

export function runRun(args: string[]) {
  const input = args[0];
  if (!input) {
    console.error("run requires an input .no file");
    process.exit(1);
  }

  let resolvedInput: string;
  try {
    resolvedInput = resolveNodeonFile(input);
  } catch (err: any) {
    console.error(`${RED}error${RESET}: ${err.message}`);
    process.exit(1);
  }

  const result = compileFile(resolvedInput, undefined, { minify: false, write: false });
  if (!result) return;
  const { jsCode } = result;
  try {
    runInSandbox(jsCode, basename(resolvedInput).replace(/\.no$/, ".js"));
  } catch (err: any) {
    console.error(`${RED}${BOLD}runtime error${RESET}: ${err.message}`);
    process.exit(1);
  }
}

