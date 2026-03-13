import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { compile, compileWithSourceMap } from "@compiler/compile";
import { formatError } from "./errors";

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

export function compileFile(inputPath: string, outputPath?: string, opts: CLICompileOptions = { minify: false, write: true }): CompileResult {
  const absIn = resolve(process.cwd(), inputPath);

  if (!existsSync(absIn)) {
    throw new Error(`file not found: ${inputPath}`);
  }

  const source = readFileSync(absIn, "utf8");

  try {
    let out: string | null = null;
    if (opts.write) {
      if (outputPath) {
        out = resolve(process.cwd(), outputPath);
      } else if (opts.minify) {
        out = absIn.replace(/\.no$/, ".min.js");
      } else {
        out = absIn.replace(/\.no$/, ".js");
      }
    }

    if (opts.sourceMap && out) {
      const outFile = basename(out);
      const { js: jsCode, ast, sourceMap } = compileWithSourceMap(source, inputPath, outFile, { minify: opts.minify });
      writeFileSync(out, jsCode, "utf8");
      writeFileSync(out + ".map", JSON.stringify(sourceMap), "utf8");
      return { ast, jsCode, out };
    }

    const { js: jsCode, ast } = compile(source, { minify: opts.minify });
    if (out) writeFileSync(out, jsCode, "utf8");
    return { ast, jsCode, out };
  } catch (err: any) {
    console.error(formatError(inputPath, source, err));
    process.exit(1);
  }
}
