import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
export function resolveImport(source, fromFile) {
  if (!source.startsWith(".") && !source.startsWith("/")) {
    return null;
  }
  const dir = dirname(fromFile);
  const candidates = [join(dir, source.endsWith(".no") ? source : source + ".no"), join(dir, source, "index.no")];
  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (existsSync(abs)) {
      return abs;
    }
  }
  return null;
}
export function rewriteImportSource(source) {
  if (!source.startsWith(".") && !source.startsWith("/")) {
    return source;
  }
  if (source.endsWith(".js") || source.endsWith(".mjs") || source.endsWith(".json")) {
    return source;
  }
  if (source.endsWith(".no")) {
    return source.slice(0, -3) + ".js";
  }
  return source + ".js";
}