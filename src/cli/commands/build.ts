import { basename, resolve, dirname, relative } from "path";
import { compileFile } from "../utils/compile";
import { GREEN, RED, DIM, YELLOW, RESET } from "../utils/colors";
import { resolveNodeonFile } from "./run";
import { resolveImport } from "@compiler/resolver";
import { compileToAST } from "@compiler/compile";
import { readFileSync } from "fs";
import { ImportDeclaration, ExportDeclaration } from "@ast/nodes";
import type { TypeDiagnostic } from "@compiler/compile";

export function runBuild(args: string[]) {
  const flags = args;
  const minify = flags.includes("-min") || flags.includes("--minify");
  const sourceMap = flags.includes("--map");
  const check = flags.includes("--check");
  const positional = flags.filter((f) => !f.startsWith("-"));

  if (positional.length === 0) {
    console.error("build requires an input .no file");
    process.exit(1);
  }

  let input: string;
  try {
    input = resolveNodeonFile(positional[0]);
  } catch (err: any) {
    console.error(`${RED}error${RESET}: ${err.message}`);
    process.exit(1);
  }

  const output = positional[1];

  // Collect all files to compile (entry + recursive imports)
  const absInput = resolve(input);
  const filesToCompile = collectDependencies(absInput);

  let compiled = 0;
  let failed = 0;

  for (const file of filesToCompile) {
    const relFile = relative(process.cwd(), file);
    try {
      // For the entry file, use the explicit output path if given
      const outPath = (file === absInput) ? output : undefined;
      const { out, diagnostics } = compileFile(relFile, outPath, { minify, write: true, sourceMap, check });
      const extra = [minify ? "minified" : "", sourceMap ? "+map" : ""].filter(Boolean).join(", ");
      console.log(`  ${GREEN}✓${RESET} ${basename(relFile)} → ${basename(out!)}${extra ? ` (${extra})` : ""}`);
      if (diagnostics && diagnostics.length > 0) {
        printDiagnostics(relFile, diagnostics);
      }
      compiled++;
    } catch (err: any) {
      console.error(`  ${RED}✗${RESET} ${basename(relFile)}: ${err.message}`);
      failed++;
    }
  }

  if (filesToCompile.length > 1) {
    console.log(`\n${DIM}${compiled} compiled${failed ? `, ${failed} failed` : ""}${RESET}`);
  }
}

function printDiagnostics(file: string, diagnostics: TypeDiagnostic[]): void {
  for (const d of diagnostics) {
    const sev = d.severity === "error" ? `${RED}error${RESET}`
      : d.severity === "warning" ? `${YELLOW}warn${RESET}`
      : `${DIM}hint${RESET}`;
    console.log(`    ${sev}: ${d.message} ${DIM}(${file}:${d.line + 1}:${d.column + 1})${RESET}`);
  }
}

/**
 * Walk the AST of a file and collect all local .no dependencies recursively.
 * Returns a Set of absolute paths in dependency order (dependencies first).
 */
function collectDependencies(entryFile: string): string[] {
  const visited = new Set<string>();
  const ordered: string[] = [];

  function walk(absFile: string) {
    if (visited.has(absFile)) return;
    visited.add(absFile);

    try {
      const source = readFileSync(absFile, "utf8");
      const ast = compileToAST(source);

      for (const stmt of ast.body) {
        let importSource: string | undefined;

        if (stmt.type === "ImportDeclaration") {
          importSource = (stmt as ImportDeclaration).source;
        } else if (stmt.type === "ExportDeclaration") {
          const exp = stmt as ExportDeclaration;
          if (exp.source) importSource = exp.source;
        }

        if (importSource) {
          const resolved = resolveImport(importSource, absFile);
          if (resolved) {
            walk(resolved); // dependencies first
          }
        }
      }
    } catch {
      // If parsing fails, we'll catch it during actual compilation
    }

    ordered.push(absFile);
  }

  walk(entryFile);
  return ordered;
}
