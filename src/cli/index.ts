#!/usr/bin/env node

import { CYAN, RESET } from "./utils/colors";
import { suggestClosest } from "./utils/strings";

export async function main(argv = process.argv) {
  const args = argv.slice(2);
  const cmd = args[0];

  // Early exit for help/version without loading heavy deps.
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    const { printHelp } = await import("@commands/help");
    printHelp();
    return;
  }

  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    const { printVersion } = await import("@commands/help");
    printVersion();
    return;
  }

  if (cmd === "init") {
    const { runInit } = await import("@commands/init");
    runInit(args.slice(1));
    return;
  }

  if (cmd === "build") {
    const { runBuild } = await import("@commands/build");
    runBuild(args.slice(1));
    return;
  }

  if (cmd === "run") {
    const { runRun } = await import("@commands/run");
    runRun(args.slice(1));
    return;
  }

  if (cmd === "repl") {
    const { startRepl } = await import("@commands/repl");
    startRepl();
    return;
  }

  if (cmd === "check") {
    const { runCheck } = await import("@commands/check");
    runCheck(args.slice(1));
    return;
  }

  if (cmd === "fmt") {
    const { runFmt } = await import("@commands/fmt");
    runFmt(args.slice(1));
    return;
  }

  // If it doesn't match a known command, try to run as a file first.
  // This allows `nodeon myfile` or `nodeon myfile.no` without `run`.
  {
    const { runRun, resolveNodeonFile } = await import("@commands/run");
    try {
      const resolved = resolveNodeonFile(cmd);
      runRun([resolved, ...args.slice(1)]);
      return;
    } catch {
      // Not a valid file — fall through to show suggestion
    }
  }

  const knownCommands = ["build", "run", "repl", "check", "fmt", "help", "version", "init"] as const;
  const suggestion = suggestClosest(cmd, knownCommands);
  console.error(`Unknown command '${cmd}'`);
  console.error(`See ${CYAN}'nodeon help'${RESET}.`);
  if (suggestion) {
    console.error(`did you mean: ${suggestion} ?`);
  }
  process.exit(1);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
