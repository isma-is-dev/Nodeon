const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const rootDir = path.resolve(__dirname, "../..");

// ── Path-alias plugin ───────────────────────────────────────────────
// Resolves @lexer/*, @parser/*, etc. used by the language-server source
// so esbuild can bundle everything into a single dist/server.js file.

const aliases = {
  "@language": path.join(rootDir, "src", "language"),
  "@lexer":    path.join(rootDir, "src", "compiler", "lexer"),
  "@parser":   path.join(rootDir, "src", "compiler", "parser"),
  "@compiler": path.join(rootDir, "src", "compiler"),
  "@ast":      path.join(rootDir, "src", "compiler", "ast"),
  "@src":      path.join(rootDir, "src"),
};

/**
 * Try to resolve a path by checking common extensions on disk.
 */
function tryResolve(basePath) {
  const exts = [".ts", ".js", "/index.ts", "/index.js"];
  for (const ext of exts) {
    const full = basePath + ext;
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/** @type {import('esbuild').Plugin} */
const tsconfigPathsPlugin = {
  name: "tsconfig-paths",
  setup(build) {
    build.onResolve({ filter: /^@/ }, (args) => {
      for (const [alias, target] of Object.entries(aliases)) {
        const prefix = alias + "/";
        if (args.path.startsWith(prefix)) {
          const rest = args.path.slice(prefix.length);
          const resolved = tryResolve(path.join(target, rest));
          if (resolved) return { path: resolved };
        }
        if (args.path === alias) {
          const resolved = tryResolve(target);
          if (resolved) return { path: resolved };
        }
      }
    });
  },
};

// ── Problem-matcher plugin ──────────────────────────────────────────

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(
            `    ${location.file}:${location.line}:${location.column}:`
          );
        }
      });
      console.log("[watch] build finished");
    });
  },
};

// ── Build ───────────────────────────────────────────────────────────

async function main() {
  // 1) VSCode extension client
  const extCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // 2) Language server (bundled into the extension package)
  const serverEntry = path.resolve(
    __dirname, "..", "language-server", "src", "server.ts"
  );
  const serverCtx = await esbuild.context({
    entryPoints: [serverEntry],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/server.js",
    logLevel: "silent",
    plugins: [tsconfigPathsPlugin, esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await Promise.all([extCtx.watch(), serverCtx.watch()]);
  } else {
    await Promise.all([extCtx.rebuild(), serverCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), serverCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
