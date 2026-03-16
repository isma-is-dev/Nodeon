import { CYAN, BOLD, RESET } from "../utils/colors.js";
const version = "0.1.0";
const helpText = `nodeon v${version}

Usage: nodeon <command> [options] <file>

Commands:
  build [options] <input> [output]   Compile .no → .js
  run <input>                        Compile and execute
  check <input>                      Type-check without compiling
  fmt <input>                        Format .no source code
  repl                               Interactive REPL
  init [name]                        Initialize a new project
  help                               Show this help
  version                            Show version

Build Options:
  -min, --minify    Minified output
  --map             Generate source map (.js.map)
  --check           Enable type checking

Examples:
  nodeon build hello.no              → hello.js
  nodeon build -min hello.no         → hello.min.js
  nodeon run hello.no                → compile & execute
  nodeon check hello.no              → type-check
  nodeon fmt hello.no                → format in-place
  nodeon repl                        → interactive mode`;
export function printHelp() {
  return console.log(helpText);
}
export function printVersion() {
  return console.log(CYAN + BOLD + "nodeon v" + version + RESET);
}