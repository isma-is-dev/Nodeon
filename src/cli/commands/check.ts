import { resolve, relative, basename } from "path";
import { readFileSync, existsSync } from "fs";
import { GREEN, RED, DIM, YELLOW, RESET } from "../utils/colors";
import { formatError } from "../utils/errors";
import { resolveNodeonFile } from "./run";
import { resolveImport } from "@compiler/resolver";
import type { TypeDiagnostic } from "@compiler/compile";

export function runCheck(args: string[]) {
  const positional = args.filter((f) => !f.startsWith("-"));
  const inputArg = positional[0];

  if (!inputArg) {
    console.error("check requires an input .no file");
    process.exit(1);
  }

  let input: string;
  try {
    input = resolveNodeonFile(inputArg);
  } catch (err: any) {
    console.error(`${RED}error${RESET}: ${err.message}`);
    process.exit(1);
  }

  const absInput = resolve(input);
  const files = collectFiles(absInput);

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFiles = 0;

  for (const file of files) {
    const relFile = relative(process.cwd(), file);
    try {
      const source = readFileSync(file, "utf8");
      const { compileToAST, typeCheck } = require("@compiler/compile");
      const ast = compileToAST(source);
      const diagnostics: TypeDiagnostic[] = typeCheck(ast);

      const errors = diagnostics.filter((d) => d.severity === "error");
      const warnings = diagnostics.filter((d) => d.severity === "warning");

      if (diagnostics.length === 0) {
        console.log(`  ${GREEN}✓${RESET} ${basename(relFile)}`);
      } else {
        console.log(`  ${RED}✗${RESET} ${basename(relFile)}`);
        for (const d of diagnostics) {
          const sev = d.severity === "error" ? `${RED}error${RESET}`
            : d.severity === "warning" ? `${YELLOW}warn${RESET}`
            : `${DIM}hint${RESET}`;
          console.log(`    ${sev}: ${d.message} ${DIM}(${relFile}:${d.line + 1}:${d.column + 1})${RESET}`);
        }
      }

      totalErrors += errors.length;
      totalWarnings += warnings.length;
      totalFiles++;
    } catch (err: any) {
      const source = existsSync(file) ? readFileSync(file, "utf8") : "";
      console.error(`  ${RED}✗${RESET} ${basename(relFile)}`);
      console.error(`    ${formatError(relFile, source, err)}`);
      totalErrors++;
      totalFiles++;
    }
  }

  console.log();
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`${GREEN}✓ ${totalFiles} file${totalFiles > 1 ? "s" : ""} checked — no issues found${RESET}`);
  } else {
    const parts: string[] = [];
    if (totalErrors > 0) parts.push(`${RED}${totalErrors} error${totalErrors > 1 ? "s" : ""}${RESET}`);
    if (totalWarnings > 0) parts.push(`${YELLOW}${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}${RESET}`);
    console.log(`${totalFiles} file${totalFiles > 1 ? "s" : ""} checked — ${parts.join(", ")}`);
    if (totalErrors > 0) process.exit(1);
  }
}

function collectFiles(entryFile: string): string[] {
  const visited = new Set<string>();
  const ordered: string[] = [];

  function walk(absFile: string) {
    if (visited.has(absFile)) return;
    visited.add(absFile);

    try {
      const source = readFileSync(absFile, "utf8");
      const { compileToAST } = require("@compiler/compile");
      const ast = compileToAST(source);

      for (const stmt of ast.body) {
        let importSource: string | undefined;
        if (stmt.type === "ImportDeclaration") importSource = stmt.source;
        else if (stmt.type === "ExportDeclaration" && stmt.source) importSource = stmt.source;

        if (importSource) {
          const resolved = resolveImport(importSource, absFile);
          if (resolved) walk(resolved);
        }
      }
    } catch {
      // Parsing errors will be caught during the check phase
    }

    ordered.push(absFile);
  }

  walk(entryFile);
  return ordered;
}
