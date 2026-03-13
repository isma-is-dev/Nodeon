import { CYAN, BOLD, RESET } from "../utils/colors";

const VERSION = "0.1.0";

export function printHelp(): void {
  console.log(
`nodeon v${VERSION}

Usage: nodeon <command> [options] <file>

Commands:
  build [options] <input> [output]   Compile .no → .js
  run <input>                        Compile and execute
  repl                               Interactive REPL
  help                               Show this help
  version                            Show version

Build Options:
  -min, --minify    Minified output (e.g. nodeon build -min hello.no)
  --map             Generate source map (.js.map)

Examples:
  nodeon build hello.no              → hello.js
  nodeon build -min hello.no         → hello.min.js
  nodeon build hello.no out.js       → out.js
  nodeon run hello.no                → compile & execute
  nodeon repl                        → interactive mode`
  );
}

export function printVersion(): void {
  console.log(`${CYAN}${BOLD}nodeon v${VERSION}${RESET}`);
}
