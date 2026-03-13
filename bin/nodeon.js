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

// Dev mode: Early handling for simple flags to avoid ts-node startup cost.
const args = process.argv.slice(2);
const cmd = args[0];

const { helpText: HELP_TEXT, version: VERSION } = require("../src/cli/help-content.js");

function printVersionLite() {
  console.log(`nodeon v${VERSION}`);
}

function printHelpLite() {
  console.log(HELP_TEXT);
}

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  printHelpLite();
  process.exit(0);
}

if (cmd === "version" || cmd === "--version" || cmd === "-v") {
  printVersionLite();
  process.exit(0);
}

// Heavy path: register ts-node only when needed.
require("ts-node").register({
  project: path.resolve(__dirname, "../tsconfig.json"),
  transpileOnly: true,
});
require("tsconfig-paths").register({
  project: path.resolve(__dirname, "../tsconfig.json"),
});
const { main } = require("../src/cli/index");
main();


