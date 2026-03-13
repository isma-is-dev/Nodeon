#!/usr/bin/env node
const path = require("path");

// Early handling for simple flags to avoid ts-node startup cost.
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
