import { GREEN, RED, DIM, YELLOW, CYAN, BOLD, RESET } from "../utils/colors.js";
import { compileFile } from "../utils/compile.js";
import { esmToCjs } from "../utils/runtime.js";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
function findTestFiles(dir, pattern) {
  const results = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
      const sub = findTestFiles(full, pattern);
      for (const f of sub) {
        results.push(f);
      }
    } else if (entry.isFile() && entry.name.endsWith(".test.no")) {
      if (!pattern || full.includes(pattern)) {
        results.push(full);
      }
    }
  }
  return results;
}
function resolveTestImport(src, fromDir) {
  if (src === "@nodeon/test" || src === "@nodeon/core") {
    const pkgName = src.replace("@nodeon/", "");
    const candidates = [path.resolve(process.cwd(), "packages", pkgName, "dist", "index.js"), path.resolve(__dirname, "..", "..", "..", "packages", pkgName, "dist", "index.js")];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    return null;
  }
  if (src.startsWith(".")) {
    const noPath = path.resolve(fromDir, src.endsWith(".no") ? src : src + ".no");
    if (fs.existsSync(noPath)) {
      return noPath;
    }
    const jsPath = path.resolve(fromDir, src.endsWith(".js") ? src : src + ".js");
    if (fs.existsSync(jsPath)) {
      return jsPath;
    }
  }
  return null;
}
function compileNoFile(filePath) {
  try {
    const result = compileFile(path.relative(process.cwd(), filePath), undefined, { minify: false, write: false });
    return result.jsCode;
  } catch (e) {
    return null;
  }
}
function testRequire(src) {
  if (src === "@nodeon/test" || src === "@nodeon/core") {
    const resolved = resolveTestImport(src, testFileDir);
    if (resolved) {
      return require(resolved);
    }
    const pkgName = src.replace("@nodeon/", "");
    const srcPath = path.resolve(process.cwd(), "packages", pkgName, "src", "index.no");
    if (fs.existsSync(srcPath)) {
      const js = compileNoFile(srcPath);
      if (js) {
        const mod = { exports: {} };
        const cjs = esmToCjs(js);
        const fn2 = new Function("module", "exports", "require", "__dirname", "__filename", cjs);
        fn2(mod, mod.exports, createTestRequire(path.dirname(srcPath)), path.dirname(srcPath), srcPath);
        return mod.exports;
      }
    }
  }
  if (src.startsWith(".")) {
    const noPath = path.resolve(testFileDir, src.endsWith(".no") ? src : src + ".no");
    if (fs.existsSync(noPath)) {
      const js = compileNoFile(noPath);
      if (js) {
        const mod = { exports: {} };
        const cjs = esmToCjs(js);
        const fn2 = new Function("module", "exports", "require", "__dirname", "__filename", cjs);
        fn2(mod, mod.exports, createTestRequire(path.dirname(noPath)), path.dirname(noPath), noPath);
        return mod.exports;
      }
    }
  }
  return require(src);
}
async function runTestFile(filePath) {
  const relPath = path.relative(process.cwd(), filePath);
  try {
    const result = compileFile(relPath, undefined, { minify: false, write: false });
    const cjsCode = esmToCjs(result.jsCode);
    const testDir = path.dirname(filePath);
    const testRequire = createTestRequire(testDir);
    const mod = { exports: {} };
    const runFn = new Function("module", "exports", "require", "__dirname", "__filename", "console", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "JSON", "Math", "Date", "Error", "TypeError", "RangeError", "Array", "Object", "String", "Number", "Boolean", "Map", "Set", "Promise", "Symbol", "Buffer", "process", "queueMicrotask", "globalThis", cjsCode);
    runFn(mod, mod.exports, testRequire, testDir, filePath, console, setTimeout, setInterval, clearTimeout, clearInterval, JSON, Math, Date, Error, TypeError, RangeError, Array, Object, String, Number, Boolean, Map, Set, Promise, Symbol, Buffer, process, queueMicrotask, globalThis);
    const testLib = testRequire("@nodeon/test");
    if (testLib && testLib.run) {
      const results = await testLib.run();
      return { file: relPath, results: results };
    }
    return { file: relPath, results: { passed: 0, failed: 0, skipped: 0, failures: [] } };
  } catch (err) {
    console.error(RED + "  ✗ " + RESET + relPath + ": " + err.message);
    if (err.stack) {
      const lines = err.stack.split("\n").slice(0, 3);
      for (const line of lines) {
        console.error(DIM + "    " + line + RESET);
      }
    }
    return { file: relPath, results: { passed: 0, failed: 1, skipped: 0, failures: [{ name: relPath, error: err }] } };
  }
}
export async function runTest(args) {
  const flags = args.filter(a => a.startsWith("-"));
  const positional = args.filter(a => !a.startsWith("-"));
  const pattern = positional[0] || null;
  const watchMode = flags.includes("-w") || flags.includes("--watch");
  console.log("");
  console.log(BOLD + "  Nodeon Test Runner" + RESET);
  console.log("");
  const searchDirs = ["tests", "test", "src", "packages"];
  let testFiles = [];
  for (const dir of searchDirs) {
    const absDir = path.resolve(process.cwd(), dir);
    const found = findTestFiles(absDir, pattern);
    for (const f of found) {
      testFiles.push(f);
    }
  }
  const rootEntries = fs.readdirSync(process.cwd(), { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.endsWith(".test.no")) {
      if (!pattern || entry.name.includes(pattern)) {
        testFiles.push(path.resolve(process.cwd(), entry.name));
      }
    }
  }
  if (testFiles.length === 0) {
    console.log(YELLOW + "  No test files found." + RESET);
    console.log(DIM + "  Looking for *.test.no files in: tests/, test/, src/, packages/" + RESET);
    console.log("");
    return;
  }
  console.log(DIM + "  Found " + testFiles.length + " test file" + testFiles.length > 1 ? "s" : "" + RESET);
  console.log("");
  const startTime = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  for (const file of testFiles) {
    const relFile = path.relative(process.cwd(), file);
    console.log(CYAN + "  " + relFile + RESET);
    const fileResult = await runTestFile(file);
    if (fileResult.results) {
      totalPassed = totalPassed + fileResult.results.passed;
      totalFailed = totalFailed + fileResult.results.failed;
      totalSkipped = totalSkipped + fileResult.results.skipped;
    }
  }
  const elapsed = Date.now() - startTime;
  console.log("");
  console.log("  " + BOLD + "Results:" + RESET);
  const passLabel = GREEN + totalPassed + " passed" + RESET;
  const failLabel = totalFailed > 0 ? RED + totalFailed + " failed" + RESET : "";
  const skipLabel = totalSkipped > 0 ? YELLOW + totalSkipped + " skipped" + RESET : "";
  const parts = [passLabel, failLabel, skipLabel].filter(Boolean);
  const total = totalPassed + totalFailed + totalSkipped;
  console.log("  Tests: " + parts.join(", ") + " (" + total + " total)");
  console.log("  Files: " + testFiles.length);
  const elapsedSec = elapsed / 1000;
  console.log("  Time:  " + elapsedSec.toFixed(2) + "s");
  console.log("");
  if (totalFailed > 0) {
    process.exit(1);
  }
}