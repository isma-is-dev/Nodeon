#!/usr/bin/env node
import { printHelp, printVersion } from "@commands/help";
import { runBuild } from "@commands/build";
import { runRun } from "@commands/run";
import { startRepl } from "@commands/repl";

export function main(argv = process.argv) {
  const args = argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    printVersion();
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

  if (cmd === "repl") {
    startRepl();
    return;
  }

  console.error(`Unknown command '${cmd}'`);
  printHelp();
  process.exit(1);
}

if (require.main === module) {
  main();
}
