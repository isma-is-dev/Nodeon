#!/usr/bin/env node
const { build } = require("esbuild");
const path = require("path");

const outFile = path.resolve(__dirname, "../dist/nodeon.js");

build({
  entryPoints: [path.resolve(__dirname, "../src/cli/index.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  minify: false,
  alias: {
    "@commands": path.resolve(__dirname, "../src/cli/commands"),
    "@compiler": path.resolve(__dirname, "../src/compiler"),
  },
  logLevel: "info",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
