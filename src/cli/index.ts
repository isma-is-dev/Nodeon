#!/usr/bin/env node

import { CYAN, RESET } from "./utils/colors";

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

  const knownCommands = ["build", "run", "repl", "help", "version"] as const;
  const suggestion = suggestCommand(cmd, knownCommands);
  console.error(`Unknown command '${cmd}'`);
  console.error(`See ${CYAN}'nodeon help'${RESET}.`);
  if (suggestion) {
    console.error(`did you mean: ${suggestion} ?`);
    process.exit(1);
  }

  // Fallback: treat the first arg as a file to run (extensionless allowed).
  {
    const { runRun, resolveNodeonFile } = await import("@commands/run");
    const resolved = resolveNodeonFile(cmd);
    runRun([resolved, ...args.slice(1)]);
    return;
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = temp;
    }
  }
  return dp[n];
}

function suggestCommand(cmd: string, commands: readonly string[]): string | null {
  let best: { name: string; dist: number } | null = null;
  for (const candidate of commands) {
    const dist = levenshtein(cmd, candidate);
    if (dist <= 2 && (!best || dist < best.dist)) {
      best = { name: candidate, dist };
    }
  }
  return best ? best.name : null;
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
