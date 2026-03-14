#!/usr/bin/env node
// Self-hosted Nodeon CLI — uses the compiled .no bundle directly.
// No TypeScript, no ts-node, no tsconfig-paths needed.
const path = require("path");
const fs = require("fs");

const bundlePath = path.resolve(__dirname, "../dist-no/nodeon-compiler.cjs");
if (!fs.existsSync(bundlePath)) {
  console.error("Error: dist-no/nodeon-compiler.cjs not found.");
  console.error("Run 'node scripts/build-no.js && node scripts/bundle-no.js' first.");
  process.exit(1);
}

// The CLI is compiled separately — load the dist-no/cli/index.js module
const cliPath = path.resolve(__dirname, "../dist-no/cli/index.js");
if (!fs.existsSync(cliPath)) {
  console.error("Error: dist-no/cli/index.js not found.");
  console.error("Run 'node scripts/build-no.js' first.");
  process.exit(1);
}

const { main } = require(cliPath);
main();
