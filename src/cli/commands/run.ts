import { existsSync, readdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { compileFile } from "../utils/compile";
import { runInSandbox } from "../utils/runtime";
import { RED, BOLD, RESET, CYAN } from "../utils/colors";

export function resolveNodeonFile(input: string): string {
  const candidates = [input, `${input}.no`, join(input, "index.no")];

  for (const candidate of candidates) {
    const abs = resolve(process.cwd(), candidate);
    if (existsSync(abs)) return candidate;
  }

  console.error("error: file not found");

  const suggestion = suggestClosestFile(input);
  if (suggestion) {
    console.error(`did you mean: ${CYAN}${suggestion}${RESET} ?`);
  }

  process.exit(1);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = temp;
    }
  }
  return dp[n];
}

function suggestClosestFile(input: string): string | null {
  const parsed = basename(input);
  const dir = dirname(input) === "." ? "." : dirname(input);
  const desired = parsed.includes(".") ? parsed : `${parsed}.no`;
  const dirAbs = resolve(process.cwd(), dir);
  let best: { name: string; dist: number } | null = null;
  try {
    const entries = readdirSync(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".no")) continue;
      const dist = levenshtein(desired, entry.name);
      if (dist <= 3 && (!best || dist < best.dist)) {
        best = { name: entry.name, dist };
      }
    }
  } catch {
    // ignore directory read errors
  }

  if (best) {
    const maybePath = dir === "." ? best.name : join(dir, best.name);
    return maybePath;
  }
  return null;
}

export function runRun(args: string[]) {
  const input = args[0];
  if (!input) {
    console.error("run requires an input .no file");
    process.exit(1);
  }

  const resolvedInput = resolveNodeonFile(input);
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
