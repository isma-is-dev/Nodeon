#!/usr/bin/env node
// Self-hosted build: compiles all src-no .no files using the SELF-HOSTED
// compiler bundle (dist-no/nodeon-compiler.cjs) instead of the TypeScript
// compiler. This closes the bootstrap loop — Nodeon compiles itself.
const fs = require("fs");
const path = require("path");

const BUNDLE = path.resolve(__dirname, "../dist-no/nodeon-compiler.cjs");
if (!fs.existsSync(BUNDLE)) {
  console.error("Error: dist-no/nodeon-compiler.cjs not found.");
  console.error("Run 'node scripts/build-no.js && node scripts/bundle-no.js' first to bootstrap.");
  process.exit(1);
}

const { compile } = require(BUNDLE);

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

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    try {
      const source = fs.readFileSync(file, "utf8");
      const result = compile(source);
      fs.writeFileSync(outPath, result.js, "utf8");
      ok++;
      const kb = (result.js.length / 1024).toFixed(1);
      console.log(`  \u2713 ${outRel}  (${kb}kb)`);
    } catch (err) {
      fail++;
      console.error(`  \u2717 ${rel}: ${err.message}`);
    }
  }

  console.log(`\n  ${ok} compiled, ${fail} failed (self-hosted)\n`);
  if (fail > 0) process.exit(1);
}

buildAll();
