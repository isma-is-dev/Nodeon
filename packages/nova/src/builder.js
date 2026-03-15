import fs from "fs";
import path from "path";
import { buildRoutes } from "./router.js";
import { renderPage, wrapHtmlShell } from "./renderer.js";
import { compileNoFile } from "./compiler-bridge.js";
import { injectIslandScripts } from "./island.js";
async function buildSite(projectDir, opts) {
  const pagesDir = path.join(projectDir, "src", "pages");
  const outDir = path.join(projectDir, opts.outDir || "dist");
  const publicDir = path.join(projectDir, "public");
  console.log("");
  console.log("  \u001b[36m\u001b[1m⚡ Nova build\u001b[0m");
  console.log("");
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(publicDir)) {
    copyDir(publicDir, outDir);
    console.log("  \u001b[2m✓ Copied public/ assets\u001b[0m");
  }
  const routes = buildRoutes(pagesDir);
  let built = 0;
  let failed = 0;
  for (const route of routes) {
    if (route.isDynamic) {
      console.log("  \u001b[33m⊘\u001b[0m " + route.pattern + " \u001b[2m(dynamic — skipped)\u001b[0m");
      continue;
    }
    if (route.isApi) {
      console.log("  \u001b[33m⊘\u001b[0m " + route.pattern + " \u001b[2m(API — skipped)\u001b[0m");
      continue;
    }
    try {
      const pageMod = loadPageModule(route.filePath);
      let html = await renderPage(pageMod, {}, {});
      html = wrapHtmlShell(html, "Nova");
      html = injectIslandScripts(html, {});
      const outPath = (() => { if (route.pattern === "/") { return path.join(outDir, "index.html"); } else { return path.join(outDir, route.pattern, "index.html"); } })();
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, "utf8");
      const size = html.length / 1024.toFixed(1);
      console.log("  \u001b[32m✓\u001b[0m " + route.pattern + " → " + path.relative(projectDir, outPath) + " (" + size + "kb)");
      built++;
    } catch (err) {
      console.error("  \u001b[31m✗\u001b[0m " + route.pattern + ": " + err.message);
      failed++;
    }
  }
  console.log("");
  console.log("  " + built + " pages built" + (() => { if (failed > 0) { return ", " + failed + " failed"; } else { return ""; } })() + " → " + path.relative(projectDir, outDir) + "/");
  console.log("");
  if (failed > 0) {
    process.exit(1);
  }
}
function loadPageModule(filePath) {
  if (filePath.endsWith(".no")) {
    return compileNoFile(filePath);
  }
  const fileUrl = "file:///" + filePath.replace(/\\/g, "/");
  return import(fileUrl);
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
export { buildSite };