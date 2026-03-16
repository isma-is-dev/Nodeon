import { CYAN, RESET } from "./utils/colors.js";
import { suggestClosest } from "./utils/strings.js";
import { printHelp, printVersion } from "./commands/help.js";
import { runInit } from "./commands/init.js";
import { runBuild } from "./commands/build.js";
import { runRun, resolveNodeonFile } from "./commands/run.js";
import { runCheck } from "./commands/check.js";
import { runFmt } from "./commands/fmt.js";
import { startRepl } from "./commands/repl.js";
import { runTest } from "./commands/test.js";
import { runNew } from "./commands/new.js";
import { runGenerate } from "./commands/generate.js";
import { runDev } from "./commands/dev.js";
export async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    printVersion();
    return;
  }
  if (cmd === "new") {
    await runNew(args.slice(1));
    return;
  }
  if (cmd === "dev") {
    runDev(args.slice(1));
    return;
  }
  if (cmd === "init") {
    runInit(args.slice(1));
    return;
  }
  if (cmd === "build") {
    runBuild(args.slice(1));
    return;
  }
  if (cmd === "run") {
    runRun(args.slice(1));
    return;
  }
  if (cmd === "test") {
    await runTest(args.slice(1));
    return;
  }
  if (cmd === "repl") {
    startRepl();
    return;
  }
  if (cmd === "check") {
    runCheck(args.slice(1));
    return;
  }
  if (cmd === "fmt") {
    runFmt(args.slice(1));
    return;
  }
  if (cmd === "generate" || cmd === "g") {
    runGenerate(args.slice(1));
    return;
  }
  try {
    const resolved = resolveNodeonFile(cmd);
    runRun([resolved, ...args.slice(1)]);
    return;
  } catch (e) {

  }
  const knownCommands = ["build", "run", "repl", "check", "fmt", "help", "version", "init", "new", "test", "generate", "dev"];
  const suggestion = suggestClosest(cmd, knownCommands);
  console.error("Unknown command '" + cmd + "'");
  console.error("See " + CYAN + "'nodeon help'" + RESET + ".");
  if (suggestion) {
    console.error("did you mean: " + suggestion + " ?");
  }
  process.exit(1);
}
if (typeof require !== "undefined" && require.main === module) {
  main();
}