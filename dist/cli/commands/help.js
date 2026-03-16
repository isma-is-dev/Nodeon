import { CYAN, BOLD, RESET } from "../utils/colors.js";
const version = "0.3.0";
const helpText = `nodeon v${version}

Usage: nodeon <command> [options]

Project:
  new <name>                         Create a new project
  init [name]                        Initialize in existing directory
  dev [--port 3000]                   Start development server with live reload

Compile:
  build [options] <input> [output]   Compile .no to .js
  build --prod                        Production build (bundle + pre-render)
  run <input>                        Compile and execute
  check <input>                      Type-check without compiling

Deploy:
  deploy [docker|vercel|fly]         Generate deploy config
  deploy docker --run                Build and start Docker container

Code Quality:
  test [pattern]                     Run .test.no files
  fmt <input>                        Format .no source code
  repl                               Interactive REPL

Generate:
  generate entity <name>             Model + migration + service + API + tests
  generate page <path>               Page component
  generate component <name>          Server component
  generate island <name>             Interactive island component
  generate service <name>            Injectable service
  generate middleware <name>         Request middleware
  generate job <name>                Background job
  generate module <name>             Full module (all of the above)
  (alias: g)

Info:
  help                               Show this help
  version                            Show version

Build Options:
  -min, --minify    Minified output
  --map             Generate source map (.js.map)
  --check           Enable type checking

Examples:
  nodeon new my-app                  Create a full-stack project
  nodeon build hello.no              Compile to hello.js
  nodeon build --prod                Production build with pre-rendering
  nodeon run hello.no                Compile and execute
  nodeon test                        Run all tests
  nodeon deploy docker               Generate Dockerfile + docker-compose
  nodeon g entity user               Generate user entity + CRUD
  nodeon g module blog               Generate complete blog module`;
export function printHelp() {
  return console.log(helpText);
}
export function printVersion() {
  return console.log(CYAN + BOLD + "nodeon v" + version + RESET);
}