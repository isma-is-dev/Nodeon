import { existsSync, watch } from "fs";
import { basename, join, resolve, dirname } from "path";
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
  const watchMode = args.includes("-w") || args.includes("--watch");
  const positional = args.filter((f) => !f.startsWith("-"));
  const input = positional[0];

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

  // Initial run
  executeFile(resolvedInput);

  // Watch mode: re-run on changes
  if (watchMode) {
    console.log(`\n${CYAN}👀${RESET} Watching ${basename(resolvedInput)} for changes... (Ctrl+C to stop)`);
    watchAndRun(resolvedInput);
  }
}

function executeFile(resolvedInput: string): boolean {
  try {
    const result = compileFile(resolvedInput, undefined, { minify: false, write: false });
    if (!result) return false;
    const { jsCode } = result;
    runInSandbox(jsCode, basename(resolvedInput).replace(/\.no$/, ".js"));
    return true;
  } catch (err: any) {
    if (err instanceof SyntaxError || err.name === "SyntaxError") {
      console.error(`${RED}error${RESET}: ${err.message}`);
    } else {
      console.error(`${RED}${BOLD}runtime error${RESET}: ${err.message}`);
    }
    return false;
  }
}

function watchAndRun(resolvedInput: string): void {
  const absInput = resolve(resolvedInput);
  const dir = dirname(absInput);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(dir, (eventType, filename) => {
    if (!filename || !filename.endsWith(".no")) return;

    // Debounce rapid file changes
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`\n${CYAN}↻${RESET} Change detected: ${filename}`);
      console.log("─".repeat(40));
      executeFile(resolvedInput);
      console.log(`\n${CYAN}👀${RESET} Waiting for changes...`);
    }, 150);
  });

  process.on("SIGINT", () => {
    watcher.close();
    console.log(`\n${CYAN}✓${RESET} Watch stopped.`);
    process.exit(0);
  });
}
