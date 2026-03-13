#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

// Prefer prebuilt bundle if present (production fast path).
const distBundle = path.resolve(__dirname, "../dist/nodeon.js");
if (fs.existsSync(distBundle)) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bundled = require(distBundle);
  if (bundled && typeof bundled.main === "function") {
    const maybe = bundled.main(process.argv);
    if (maybe && typeof maybe.then === "function") {
      maybe.catch((err) => {
        console.error(err);
        process.exit(1);
      });
    }
    return;
  }
  return;
}

// Dev mode: register ts-node and tsconfig-paths first.
require("ts-node").register({
  project: path.resolve(__dirname, "../tsconfig.json"),
  transpileOnly: true,
});
require("tsconfig-paths").register({
  project: path.resolve(__dirname, "../tsconfig.json"),
});

// Early handling for simple flags to avoid full CLI startup cost.
const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  const { helpText } = require("../src/cli/help-content");
  console.log(helpText);
  process.exit(0);
}

if (cmd === "version" || cmd === "--version" || cmd === "-v") {
  const { version } = require("../src/cli/help-content");
  console.log(`nodeon v${version}`);
  process.exit(0);
}

// Full CLI: already registered above.
const { main } = require("../src/cli/index");
main();

