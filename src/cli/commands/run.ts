import { existsSync } from "fs";
import { basename, join, resolve } from "path";
import { compileFile } from "../utils/compile";
import { runInSandbox } from "../utils/runtime";
import { RED, BOLD, RESET } from "../utils/colors";

export function resolveNodeonFile(input: string): string {
  const candidates = [input, `${input}.no`, join(input, "index.no")];

  for (const candidate of candidates) {
    const abs = resolve(process.cwd(), candidate);
    if (existsSync(abs)) return candidate;
  }

  console.error("error: file not found");
  console.error("tried:");
  for (const candidate of candidates) {
    console.error(`  ${candidate}`);
  }
  process.exit(1);
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
