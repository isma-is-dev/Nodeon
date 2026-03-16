import { resolve, relative, basename } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { GREEN, RED, DIM, YELLOW, RESET } from "../utils/colors";
import { formatError } from "../utils/errors";
import { resolveNodeonFile } from "./run";

export function runFmt(args: string[]) {
  const flags = args.filter((f) => f.startsWith("-"));
  const positional = args.filter((f) => !f.startsWith("-"));
  const dryRun = flags.includes("--check") || flags.includes("--dry-run");
  const inputArg = positional[0];

  if (!inputArg) {
    console.error("fmt requires an input .no file");
    process.exit(1);
  }

  let input: string;
  try {
    input = resolveNodeonFile(inputArg);
  } catch (err: any) {
    console.error(`${RED}error${RESET}: ${err.message}`);
    process.exit(1);
  }

  const absInput = resolve(input);
  const relFile = relative(process.cwd(), absInput);

  try {
    const source = readFileSync(absInput, "utf8");
    const { compileToAST } = require("@compiler/compile");
    const { format } = require("@compiler/formatter/formatter");
    const ast = compileToAST(source);
    const formatted: string = format(ast);

    if (dryRun) {
      if (source === formatted) {
        console.log(`  ${GREEN}✓${RESET} ${basename(relFile)} ${DIM}(already formatted)${RESET}`);
      } else {
        console.log(`  ${YELLOW}~${RESET} ${basename(relFile)} ${DIM}(would be reformatted)${RESET}`);
        process.exit(1);
      }
    } else {
      if (source === formatted) {
        console.log(`  ${GREEN}✓${RESET} ${basename(relFile)} ${DIM}(unchanged)${RESET}`);
      } else {
        writeFileSync(absInput, formatted, "utf8");
        console.log(`  ${GREEN}✓${RESET} ${basename(relFile)} ${DIM}(formatted)${RESET}`);
      }
    }
  } catch (err: any) {
    const source = existsSync(absInput) ? readFileSync(absInput, "utf8") : "";
    console.error(`  ${RED}✗${RESET} ${basename(relFile)}`);
    console.error(`    ${formatError(relFile, source, err)}`);
    process.exit(1);
  }
}
