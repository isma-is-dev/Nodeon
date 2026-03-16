const { version = "0.0.0" } = require("../../package.json");

const helpText = `nodeon v${version}

Usage: nodeon <command> [options] <file>

Commands:
  build [options] <input> [output]   Compile .no → .js
  run <input>                        Compile and execute
  check <input>                      Type check without compiling
  fmt <input>                        Format .no source code
  repl                               Interactive REPL
  help                               Show this help
  version                            Show version

Build Options:
  -min, --minify    Minified output (e.g. nodeon build -min hello.no)
  --map             Generate source map (.js.map)

Format Options:
  --check           Check formatting without writing (exit 1 if unformatted)

Examples:
  nodeon build hello.no              → hello.js
  nodeon build -min hello.no         → hello.min.js
  nodeon build hello.no out.js       → out.js
  nodeon run hello.no                → compile & execute
  nodeon check hello.no              → type check only
  nodeon fmt hello.no                → format source file
  nodeon fmt --check hello.no        → check formatting only
  nodeon repl                        → interactive mode`;

module.exports = { helpText, version };
