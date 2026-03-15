// Nova static site builder
// Renders all pages to static HTML files in the output directory.

const fs = require("fs");
const path = require("path");
const { buildRoutes } = require("./router");
const { renderPage, wrapHtmlShell } = require("./renderer");
const { compileNoFile } = require("./compiler-bridge");

/**
 * Build static site from pages/ into dist/.
 * @param {string} projectDir - Root of the Nova project
 * @param {object} opts - Build options
 */
async function buildSite(projectDir, opts) {
  const pagesDir = path.join(projectDir, "src", "pages");
  const outDir = path.join(projectDir, opts.outDir || "dist");
  const publicDir = path.join(projectDir, "public");

  console.log("");
  console.log("  \x1b[36m\x1b[1m⚡ Nova build\x1b[0m");
  console.log("");

  // Clean output
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Copy public/ to dist/
  if (fs.existsSync(publicDir)) {
    copyDir(publicDir, outDir);
    console.log("  \x1b[2m✓ Copied public/ assets\x1b[0m");
  }

  // Build routes
  const routes = buildRoutes(pagesDir);
  let built = 0;
  let failed = 0;

  for (const route of routes) {
    // Skip dynamic routes (need runtime params) and API routes
    if (route.isDynamic) {
      console.log("  \x1b[33m⊘\x1b[0m " + route.pattern + " \x1b[2m(dynamic — skipped)\x1b[0m");
      continue;
    }
    if (route.isApi) {
      console.log("  \x1b[33m⊘\x1b[0m " + route.pattern + " \x1b[2m(API — skipped)\x1b[0m");
      continue;
    }

    try {
      const pageMod = loadPageModule(route.filePath);
      let html = await renderPage(pageMod, {}, {});
      html = wrapHtmlShell(html, "Nova");

      // Write to dist/
      const outPath = route.pattern === "/"
        ? path.join(outDir, "index.html")
        : path.join(outDir, route.pattern, "index.html");

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, "utf8");

      const size = (html.length / 1024).toFixed(1);
      console.log("  \x1b[32m✓\x1b[0m " + route.pattern + " → " + path.relative(projectDir, outPath) + " (" + size + "kb)");
      built++;
    } catch (err) {
      console.error("  \x1b[31m✗\x1b[0m " + route.pattern + ": " + err.message);
      failed++;
    }
  }

  console.log("");
  console.log("  " + built + " pages built" + (failed > 0 ? ", " + failed + " failed" : "") + " → " + path.relative(projectDir, outDir) + "/");
  console.log("");

  if (failed > 0) process.exit(1);
}

function loadPageModule(filePath) {
  if (filePath.endsWith(".no")) {
    return compileNoFile(filePath);
  }
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

function copyDir(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = { buildSite };
