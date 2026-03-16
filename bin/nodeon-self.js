#!/usr/bin/env node
// Self-hosted Nodeon CLI — uses the compiled .no bundle directly.
// No TypeScript, no ts-node, no tsconfig-paths needed.
const path = require("path");
const fs = require("fs");

const cliBundlePath = path.resolve(__dirname, "../dist-no/nodeon-cli.cjs");
if (!fs.existsSync(cliBundlePath)) {
  console.error("Error: dist-no/nodeon-cli.cjs not found.");
  console.error("Run 'npm run build' first.");
  process.exit(1);
}

const { main } = require(cliBundlePath);
main();
