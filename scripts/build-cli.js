#!/usr/bin/env node
const { build } = require("esbuild");
const fs = require("fs");
const path = require("path");

const distEntry = path.resolve(__dirname, "../dist/cli/index.js");
const outFile = path.resolve(__dirname, "../dist/nodeon.js");

if (!fs.existsSync(distEntry)) {
  console.error("dist/cli/index.js not found. Run `node scripts/build.js` first to compile .no sources.");
  process.exit(1);
}

const noResolvePlugin = {
  name: "no-resolve",
  setup(b) {
    b.onResolve({ filter: /\.no$/ }, (args) => {
      const jsPath = args.path.replace(/\.no$/, ".js");
      const absPath = path.resolve(args.resolveDir, jsPath);
      return { path: absPath };
    });
  },
};

build({
  entryPoints: [distEntry],
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
  plugins: [noResolvePlugin],
  logLevel: "info",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
