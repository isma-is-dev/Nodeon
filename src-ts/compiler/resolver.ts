import { existsSync } from "fs";
import { resolve, dirname, join } from "path";

/**
 * Resolve a Nodeon import source to an absolute .no file path.
 * Tries: source.no, source/index.no, source (as-is if .no already).
 * Returns null for bare imports (npm packages, builtins).
 */
export function resolveImport(source: string, fromFile: string): string | null {
  // Skip bare imports (npm packages, builtins like "fs", "path")
  if (!source.startsWith(".") && !source.startsWith("/")) {
    return null;
  }

  const dir = dirname(fromFile);
  const candidates = [
    join(dir, source.endsWith(".no") ? source : `${source}.no`),
    join(dir, source, "index.no"),
  ];

  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (existsSync(abs)) return abs;
  }

  return null; // Not found — might be a JS file, let it pass through
}

/**
 * Rewrite a relative import source from .no convention to .js for output.
 * "./utils" → "./utils.js", bare imports pass through unchanged.
 */
export function rewriteImportSource(source: string): string {
  if (!source.startsWith(".") && !source.startsWith("/")) {
    return source; // npm/builtin — keep as-is
  }
  // Already has extension
  if (source.endsWith(".js") || source.endsWith(".mjs") || source.endsWith(".json")) {
    return source;
  }
  // Strip .no extension and add .js
  if (source.endsWith(".no")) {
    return source.slice(0, -3) + ".js";
  }
  // Add .js
  return source + ".js";
}
