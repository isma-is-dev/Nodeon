#!/usr/bin/env node
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

  // Fallback: treat the first arg as a file to run (extensionless allowed).
  {
    const { runRun, resolveNodeonFile } = await import("@commands/run");
    const resolved = resolveNodeonFile(cmd);
    runRun([resolved, ...args.slice(1)]);
    return;
  }

  const { printHelp } = await import("@commands/help");
  console.error(`Unknown command '${cmd}'`);
  printHelp();
  process.exit(1);
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
