#!/usr/bin/env node
// Unified build script for Nodeon compiler.
//
// Strategy:
//   1. If dist-no/nodeon-compiler.cjs exists → use self-hosted compiler (fast, no TS deps)
//   2. Otherwise → bootstrap from TypeScript compiler (requires ts-node)
//
// Usage:
//   node scripts/build.js              # auto-detect best compiler
//   node scripts/build.js --bootstrap  # force TS bootstrap compiler
//   node scripts/build.js --self       # force self-hosted compiler (error if missing)
//   node scripts/build.js --verify     # build + verify fixpoint (self === self²)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SRC_DIR = path.resolve(__dirname, "../src-no");
const OUT_DIR = path.resolve(__dirname, "../dist-no");
const BUNDLE_PATH = path.resolve(OUT_DIR, "nodeon-compiler.cjs");
const ENTRY_JS = path.resolve(OUT_DIR, "compiler/compile.js");

const args = process.argv.slice(2);
const forceBootstrap = args.includes("--bootstrap");
const forceSelf = args.includes("--self");
const verify = args.includes("--verify");

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

function loadCompiler(mode) {
  if (mode === "self") {
    return require(BUNDLE_PATH);
  }
  // Bootstrap: load TS compiler via ts-node
  require("ts-node").register({ transpileOnly: true });
  require("tsconfig-paths").register();
  return require("../src/compiler/compile");
}

function buildAll(compiler, label) {
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
      const result = compiler.compile(source);
      fs.writeFileSync(outPath, result.js, "utf8");
      ok++;
      const kb = (result.js.length / 1024).toFixed(1);
      console.log(`  \u2713 ${outRel}  (${kb}kb)`);
    } catch (err) {
      fail++;
      console.error(`  \u2717 ${rel}: ${err.message}`);
    }
  }

  console.log(`\n  ${ok} compiled, ${fail} failed (${label})\n`);
  if (fail > 0) process.exit(1);
}

function bundle() {
  const { buildSync } = require("esbuild");
  const result = buildSync({
    entryPoints: [ENTRY_JS],
    outfile: BUNDLE_PATH,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    minify: false,
    logLevel: "silent",
  });
  const size = (fs.statSync(BUNDLE_PATH).size / 1024).toFixed(1);
  console.log(`  Bundled: ${path.relative(process.cwd(), BUNDLE_PATH)}  (${size}kb)\n`);
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// ── Main ─────────────────────────────────────────────────────────

const hasSelfHosted = fs.existsSync(BUNDLE_PATH);

let mode;
if (forceBootstrap) {
  mode = "bootstrap";
} else if (forceSelf) {
  if (!hasSelfHosted) {
    console.error("Error: --self requires dist-no/nodeon-compiler.cjs to exist.");
    console.error("Run 'node scripts/build.js --bootstrap' first to create it.");
    process.exit(1);
  }
  mode = "self";
} else {
  // Auto-detect: prefer self-hosted if available
  mode = hasSelfHosted ? "self" : "bootstrap";
}

console.log(`\n  Nodeon build (${mode === "self" ? "self-hosted" : "TS bootstrap"})\n`);

const compiler = loadCompiler(mode);
buildAll(compiler, mode === "self" ? "self-hosted" : "TS bootstrap");
bundle();

if (verify) {
  console.log("  Verifying fixpoint...\n");
  // Save Gen1 hash
  const gen1Hash = hashFile(BUNDLE_PATH);

  // Gen2: recompile using Gen1 bundle
  // Need to clear require cache to pick up new bundle
  delete require.cache[require.resolve(BUNDLE_PATH)];
  const gen2Compiler = require(BUNDLE_PATH);
  buildAll(gen2Compiler, "self\u00b2 verify");
  bundle();

  const gen2Hash = hashFile(BUNDLE_PATH);

  if (gen1Hash === gen2Hash) {
    console.log(`  \u2713 Fixpoint verified: ${gen1Hash.slice(0, 16)}\n`);
  } else {
    console.error(`  \u2717 Fixpoint FAILED!`);
    console.error(`    Gen1: ${gen1Hash.slice(0, 16)}`);
    console.error(`    Gen2: ${gen2Hash.slice(0, 16)}`);
    process.exit(1);
  }
}
