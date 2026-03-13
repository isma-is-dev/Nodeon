import { basename } from "path";
import { compileFile } from "../utils/compile";
import { CYAN, RESET } from "../utils/colors";

export function runBuild(args: string[]) {
  const flags = args;
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
  console.log(`${CYAN}✓${RESET} ${basename(input)} → ${basename(out!)}${extra ? ` (${extra})` : ""}`);
}
