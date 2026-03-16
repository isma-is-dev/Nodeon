import { GREEN, RED, DIM, YELLOW, RESET } from "../utils/colors.js";
import { formatError } from "../utils/errors.js";
import { resolveNodeonFile } from "./run.js";
const fs = require("fs");
const path = require("path");
export function runCheck(args) {
  const positional = args.filter(f => !f.startsWith("-"));
  const inputArg = positional[0];
  if (!inputArg) {
    console.error("check requires an input .no file");
    process.exit(1);
  }
  let input = "";
  try {
    input = resolveNodeonFile(inputArg);
  } catch (err) {
    console.error(RED + "error" + RESET + ": " + err.message);
    process.exit(1);
  }
  const absInput = path.resolve(input);
  const files = collectFiles(absInput);
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFiles = 0;
  const compiler = require("../../compiler/compile.no");
  for (const file of files) {
    const relFile = path.relative(process.cwd(), file);
    try {
      const source = fs.readFileSync(file, "utf8");
      const ast = compiler.compileToAST(source);
      const diagnostics = compiler.compile(source, { check: true }).diagnostics;
      const errors = diagnostics.filter(d => d.severity === "error");
      const warnings = diagnostics.filter(d => d.severity === "warning");
      if (diagnostics.length === 0) {
        console.log("  " + GREEN + "✓" + RESET + " " + path.basename(relFile));
      } else {
        console.log("  " + RED + "✗" + RESET + " " + path.basename(relFile));
        for (const d of diagnostics) {
          let sev = DIM + "hint" + RESET;
          if (d.severity === "error") {
            sev = RED + "error" + RESET;
          }
          if (d.severity === "warning") {
            sev = YELLOW + "warn" + RESET;
          }
          console.log("    " + sev + ": " + d.message + " " + DIM + "(" + relFile + ":" + d.line + 1 + ":" + d.column + 1 + ")" + RESET);
        }
      }
      totalErrors = totalErrors + errors.length;
      totalWarnings = totalWarnings + warnings.length;
      totalFiles = totalFiles + 1;
    } catch (err) {
      const source = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      console.error("  " + RED + "✗" + RESET + " " + path.basename(relFile));
      console.error("    " + formatError(relFile, source, err));
      totalErrors = totalErrors + 1;
      totalFiles = totalFiles + 1;
    }
  }
  console.log();
  if (totalErrors === 0 && totalWarnings === 0) {
    const plural = totalFiles > 1 ? "s" : "";
    console.log(GREEN + "✓ " + totalFiles + " file" + plural + " checked — no issues found" + RESET);
  } else {
    const parts = [];
    if (totalErrors > 0) {
      const ep = totalErrors > 1 ? "s" : "";
      parts.push(RED + totalErrors + " error" + ep + RESET);
    }
    if (totalWarnings > 0) {
      const wp = totalWarnings > 1 ? "s" : "";
      parts.push(YELLOW + totalWarnings + " warning" + wp + RESET);
    }
    const plural = totalFiles > 1 ? "s" : "";
    console.log(totalFiles + " file" + plural + " checked — " + parts.join(", "));
    if (totalErrors > 0) {
      process.exit(1);
    }
  }
}
function collectFiles(entryFile) {
  const visited = new Set();
  const ordered = [];
  const compiler = require("../../compiler/compile.js") ?? require("../../compiler/compile.no");
  const resolver = require("../../compiler/resolver.js") ?? require("../../compiler/resolver.no");
  function walk(absFile) {
    if (visited.has(absFile)) {
      return;
    }
    visited.add(absFile);
    try {
      const source = fs.readFileSync(absFile, "utf8");
      const ast = compiler.compileToAST(source);
      for (const stmt of ast.body) {
        let importSource = undefined;
        if (stmt.type === "ImportDeclaration") {
          importSource = stmt.source;
        } else if (stmt.type === "ExportDeclaration" && stmt.source) {
          importSource = stmt.source;
        }
        if (importSource) {
          const resolved = resolver.resolveImport(importSource, absFile);
          if (resolved) {
            walk(resolved);
          }
        }
      }
    } catch (e) {

    }
    ordered.push(absFile);
  }
  walk(entryFile);
  return ordered;
}