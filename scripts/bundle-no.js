#!/usr/bin/env node
// Bundle the compiled dist modules into a single CJS file for testing.
const { build } = require("esbuild");
const path = require("path");

const entry = path.resolve(__dirname, "../dist/compiler/compile.js");
const outFile = path.resolve(__dirname, "../dist/nodeon-compiler.cjs");

build({
  entryPoints: [entry],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  minify: false,
  logLevel: "info",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
