import { basename } from "path";
import { compileFile } from "../utils/compile";
import { runInSandbox } from "../utils/runtime";
import { RED, BOLD, RESET } from "../utils/colors";

export function runRun(args: string[]) {
  const input = args[0];
  if (!input) {
    console.error("run requires an input .no file");
    process.exit(1);
  }

  const result = compileFile(input, undefined, { minify: false, write: false });
  if (!result) return;
  const { jsCode } = result;
  try {
    runInSandbox(jsCode, basename(input).replace(/\.no$/, ".js"));
  } catch (err: any) {
    console.error(`${RED}${BOLD}runtime error${RESET}: ${err.message}`);
    process.exit(1);
  }
}
