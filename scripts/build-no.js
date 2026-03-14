#!/usr/bin/env node
// Build script: compiles all src-no .no files to dist-no .js files
// using the TypeScript compiler as the bootstrap compiler.
const fs = require("fs");
const path = require("path");

// Bootstrap: use the TS compiler to compile .no files
require("ts-node").register({ transpileOnly: true });
require("tsconfig-paths").register();
const { compile } = require("../src/compiler/compile");

const SRC_DIR = path.resolve(__dirname, "../src-no");
const OUT_DIR = path.resolve(__dirname, "../dist-no");

function findNoFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findNoFiles(full));
    } else if (entry.name.endsWith(".no")) {
      results.push(full);
    }
  }
  return results;
}

function buildAll() {
  const files = findNoFiles(SRC_DIR);
  let ok = 0;
  let fail = 0;

  // Clean output
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true });
  }

  for (const file of files) {
    const rel = path.relative(SRC_DIR, file);
    const outRel = rel.replace(/\.no$/, ".js");
    const outPath = path.join(OUT_DIR, outRel);

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    try {
      const source = fs.readFileSync(file, "utf8");
      const result = compile(source);
      fs.writeFileSync(outPath, result.js, "utf8");
      ok++;
      const kb = (result.js.length / 1024).toFixed(1);
      console.log(`  ✓ ${outRel}  (${kb}kb)`);
    } catch (err) {
      fail++;
      console.error(`  ✗ ${rel}: ${err.message}`);
    }
  }

  console.log(`\n  ${ok} compiled, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

buildAll();
