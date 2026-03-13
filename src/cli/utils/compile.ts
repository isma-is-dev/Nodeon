import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, basename, join } from "path";
import crypto from "crypto";
import type * as Compiler from "@compiler/compile";
import { formatError } from "./errors";

let compilerModule: typeof Compiler | null = null;

function getCompiler(): typeof Compiler {
  if (!compilerModule) {
    // Lazy require to avoid loading heavy compiler on cache hits.
    compilerModule = require("@compiler/compile") as typeof Compiler;
  }
  return compilerModule!;
}

export interface CLICompileOptions {
  minify: boolean;
  write: boolean;
  sourceMap?: boolean;
}

export interface CompileResult {
  ast: unknown;
  jsCode: string;
  out?: string | null;
}

interface CacheEntry {
  jsCode: string;
  sourceMap?: unknown;
}

export function compileFile(inputPath: string, outputPath?: string, opts: CLICompileOptions = { minify: false, write: true }): CompileResult {
  const absIn = resolve(process.cwd(), inputPath);

  if (!existsSync(absIn)) {
    throw new Error(`file not found: ${inputPath}`);
  }

  const source = readFileSync(absIn, "utf8");

  const cacheDir = resolve(process.cwd(), ".nodeon-cache");
  const outFileName = (() => {
    if (outputPath) return basename(outputPath);
    if (opts.minify) return basename(absIn).replace(/\.no$/, ".min.js");
    return basename(absIn).replace(/\.no$/, ".js");
  })();

  const cacheKey = crypto
    .createHash("sha1")
    .update(inputPath)
    .update("|")
    .update(source)
    .update("|")
    .update(opts.minify ? "1" : "0")
    .update("|")
    .update(opts.sourceMap ? "1" : "0")
    .update("|")
    .update(outFileName)
    .digest("hex");

  const cachePath = join(cacheDir, `${cacheKey}.json`);

  const computeOutputPath = () => {
    if (opts.write) {
      if (outputPath) return resolve(process.cwd(), outputPath);
      if (opts.minify) return absIn.replace(/\.no$/, ".min.js");
      return absIn.replace(/\.no$/, ".js");
    }
    return null;
  };

  try {
    let out: string | null = computeOutputPath();

    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    if (existsSync(cachePath)) {
      const cached: CacheEntry = JSON.parse(readFileSync(cachePath, "utf8"));
      if (opts.sourceMap && cached.sourceMap && out) {
        writeFileSync(out, cached.jsCode, "utf8");
        writeFileSync(out + ".map", JSON.stringify(cached.sourceMap), "utf8");
      } else if (opts.write && out) {
        writeFileSync(out, cached.jsCode, "utf8");
      }
      return { ast: null, jsCode: cached.jsCode, out };
    }

    if (opts.sourceMap && out) {
      const outFile = basename(out);
      const { compileWithSourceMap } = getCompiler();
      const { js: jsCode, ast, sourceMap } = compileWithSourceMap(source, inputPath, outFile, { minify: opts.minify });
      writeFileSync(cachePath, JSON.stringify({ jsCode, sourceMap } satisfies CacheEntry), "utf8");
      if (out) {
        writeFileSync(out, jsCode, "utf8");
        writeFileSync(out + ".map", JSON.stringify(sourceMap), "utf8");
      }
      return { ast, jsCode, out };
    }

    const { compile } = getCompiler();
    const { js: jsCode, ast } = compile(source, { minify: opts.minify });
    writeFileSync(cachePath, JSON.stringify({ jsCode } satisfies CacheEntry), "utf8");
    if (out) writeFileSync(out, jsCode, "utf8");
    return { ast, jsCode, out };
  } catch (err: any) {
    console.error(formatError(inputPath, source, err));
    process.exit(1);
  }
}
