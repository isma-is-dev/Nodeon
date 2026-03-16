import { GREEN, RED, DIM, YELLOW, CYAN, BOLD, RESET } from "../utils/colors.js";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
function loadConfig() {
  const configPath = path.resolve(process.cwd(), "nodeon.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return {};
  }
}
const exportedNames = [];
const exportRegex = /^export\s+(function|class|const|let)\s+(\w+)/gm;
const origJs = result.js;
let exportMatch = exportRegex.exec(origJs);
while (exportMatch !== null) {
  exportedNames.push(exportMatch[2]);
  exportMatch = exportRegex.exec(origJs);
}
if (exportedNames.length > 0) {
  let serverCode = serverCode + "\n" + exportedNames.map(n => "module.exports." + n + " = " + n + ";").join("\n");
}
fs.writeFileSync(jsOutPath, serverCode, "utf8");
if (sourceMap && result.map) {
  fs.writeFileSync(jsOutPath + ".map", result.map, "utf8");
}
stats.compiled = stats.compiled + 1;
console.log("  " + GREEN + "✓" + RESET + " " + stats.compiled + " files compiled");
if (fs.existsSync(pagesDir)) {
  console.log("");
  console.log("  " + CYAN + "Pre-rendering pages..." + RESET);
  const pageFiles = walkFiles(pagesDir, ".no");
  for (const file of pageFiles) {
    const relPath = path.relative(pagesDir, file);
    const routePath = fileToRoute(relPath);
    if (routePath.includes(":")) {
      console.log("  " + YELLOW + "⊘" + RESET + " " + routePath + " " + DIM + "(dynamic — skipped)" + RESET);
      continue;
    }
    if (relPath.startsWith("api" + path.sep) || relPath.startsWith("api/")) {
      console.log("  " + YELLOW + "⊘" + RESET + " " + routePath + " " + DIM + "(API — server only)" + RESET);
      continue;
    }
    try {
      const source = fs.readFileSync(file, "utf8");
      const result = compiler.compile(source, { minify: false });
      serverCode = result.js;
      serverCode = serverCode.replace(/^import\s+.*$/gm, "");
      serverCode = serverCode.replace(/^export\s+/gm, "");
      const sandbox = { module: { exports: {} }, exports: {}, require: require, console: console, process: process, Buffer: Buffer, setTimeout: setTimeout };
      sandbox.module.exports = sandbox.exports;
      try {
        vm.runInNewContext(serverCode, sandbox, { timeout: 5000 });
      } catch (evalErr) {
        console.log("  " + YELLOW + "⊘" + RESET + " " + routePath + " " + DIM + "(cannot pre-render: " + evalErr.message + ")" + RESET);
        continue;
      }
      const mod = sandbox.module.exports;
      let html = "";
      if (typeof mod.template === "function") {
        html = mod.template();
      } else if (typeof mod.render === "function") {
        html = mod.render();
      } else if (typeof mod.default === "function") {
        const defaultExport = mod.default;
        if (typeof defaultExport.prototype?.template === "function") {
          const instance = new defaultExport();
          html = instance.template();
        } else {
          html = defaultExport();
        }
      }
      if (!html || typeof html !== "string") {
        console.log("  " + YELLOW + "⊘" + RESET + " " + routePath + " " + DIM + "(no template output)" + RESET);
        continue;
      }
      const title = mod.title ?? mod.meta?.title ?? "Nodeon App";
      const fullHtml = wrapHtml(html, title, config);
      let outPath = "";
      if (routePath === "/") {
        outPath = path.join(outDir, "index.html");
      } else {
        outPath = path.join(outDir, routePath, "index.html");
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, fullHtml, "utf8");
      const sizeRaw = fullHtml.length / 1024;
      const sizeKb = sizeRaw.toFixed(1);
      console.log("  " + GREEN + "✓" + RESET + " " + routePath + " → " + path.relative(projectDir, outPath) + " (" + sizeKb + "kb)");
      stats.pages = stats.pages + 1;
    } catch (err) {
      console.log("  " + RED + "✗" + RESET + " " + routePath + ": " + err.message);
      stats.errors = stats.errors + 1;
    }
  }
}
const islandsDir = path.join(srcDir, "islands");
const componentsDir = path.join(srcDir, "components");
let islandFiles = [];
if (fs.existsSync(islandsDir)) {
  islandFiles = walkFiles(islandsDir, ".no").concat(walkFiles(islandsDir, ".js"));
}
if (fs.existsSync(componentsDir)) {
  const componentFiles = walkFiles(componentsDir, ".no").concat(walkFiles(componentsDir, ".js"));
  for (const file of componentFiles) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("@island") || content.includes("island(")) {
      islandFiles.push(file);
    }
  }
}
console.log("");
console.log("  " + CYAN + "Generating server entry..." + RESET);
const serverEntry = generateServerEntry(config, serverOutDir, outDir);
fs.writeFileSync(path.join(outDir, "server.js"), serverEntry, "utf8");
console.log("  " + GREEN + "✓" + RESET + " server.js");
const elapsed = Date.now() - startTime;
const elapsedRaw = elapsed / 1000;
const elapsedSec = elapsedRaw.toFixed(2);
console.log("");
console.log("  " + BOLD + GREEN + "Build complete" + RESET + " in " + elapsedSec + "s");
console.log("  " + DIM + stats.compiled + " compiled, " + stats.pages + " pages, " + stats.islands + " islands" + stats.errors > 0 ? ", " + RED + stats.errors + " errors" + RESET : "" + RESET);
console.log("  " + DIM + "Output: " + path.relative(projectDir, outDir) + "/" + RESET);
console.log("");
if (stats.errors > 0) {
  process.exit(1);
}
function generateServerEntry(config, serverOutDir, outDir) {
  const port = config.port ?? 3000;
  let entry = "// Auto-generated Nodeon production server\n";
  entry = entry + "const http = require(\"http\");\n";
  entry = entry + "const fs = require(\"fs\");\n";
  entry = entry + "const path = require(\"path\");\n\n";
  entry = entry + "const PORT = process.env.PORT || " + port + ";\n";
  entry = entry + "const STATIC_DIR = __dirname;\n";
  entry = entry + "const SERVER_DIR = path.join(__dirname, \"server\");\n\n";
  entry = entry + "const MIME_TYPES = {\n";
  entry = entry + "  \".html\": \"text/html\",\n";
  entry = entry + "  \".js\": \"application/javascript\",\n";
  entry = entry + "  \".css\": \"text/css\",\n";
  entry = entry + "  \".json\": \"application/json\",\n";
  entry = entry + "  \".png\": \"image/png\",\n";
  entry = entry + "  \".jpg\": \"image/jpeg\",\n";
  entry = entry + "  \".svg\": \"image/svg+xml\",\n";
  entry = entry + "  \".ico\": \"image/x-icon\",\n";
  entry = entry + "  \".woff2\": \"font/woff2\",\n";
  entry = entry + "};\n\n";
  entry = entry + "const server = http.createServer(async (req, res) => {\n";
  entry = entry + "  const url = new URL(req.url, \"http://localhost\");\n";
  entry = entry + "  const pathname = url.pathname;\n\n";
  entry = entry + "  // API routes\n";
  entry = entry + "  const apiDir = path.join(SERVER_DIR, \"pages\", \"api\");\n";
  entry = entry + "  if (pathname.startsWith(\"/api/\")) {\n";
  entry = entry + "    const apiFile = path.join(apiDir, pathname.slice(5) + \".js\");\n";
  entry = entry + "    if (fs.existsSync(apiFile)) {\n";
  entry = entry + "      try {\n";
  entry = entry + "        const mod = require(apiFile);\n";
  entry = entry + "        const handler = mod.handler || mod.default || mod.GET || mod[req.method];\n";
  entry = entry + "        if (handler) {\n";
  entry = entry + "          const result = await handler(req, res);\n";
  entry = entry + "          if (!res.headersSent && result !== undefined) {\n";
  entry = entry + "            res.writeHead(200, { \"Content-Type\": \"application/json\" });\n";
  entry = entry + "            res.end(JSON.stringify(result));\n";
  entry = entry + "          }\n";
  entry = entry + "          return;\n";
  entry = entry + "        }\n";
  entry = entry + "      } catch (e) {\n";
  entry = entry + "        res.writeHead(500, { \"Content-Type\": \"application/json\" });\n";
  entry = entry + "        res.end(JSON.stringify({ error: e.message }));\n";
  entry = entry + "        return;\n";
  entry = entry + "      }\n";
  entry = entry + "    }\n";
  entry = entry + "  }\n\n";
  entry = entry + "  // Static files\n";
  entry = entry + "  let filePath = pathname === \"/\" ? \"/index.html\" : pathname;\n";
  entry = entry + "  let fullPath = path.join(STATIC_DIR, filePath);\n\n";
  entry = entry + "  // Try /path/index.html for clean URLs\n";
  entry = entry + "  if (!path.extname(fullPath) && !fs.existsSync(fullPath)) {\n";
  entry = entry + "    fullPath = path.join(STATIC_DIR, filePath, \"index.html\");\n";
  entry = entry + "  }\n\n";
  entry = entry + "  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {\n";
  entry = entry + "    const ext = path.extname(fullPath);\n";
  entry = entry + "    const contentType = MIME_TYPES[ext] || \"application/octet-stream\";\n";
  entry = entry + "    res.writeHead(200, { \"Content-Type\": contentType });\n";
  entry = entry + "    fs.createReadStream(fullPath).pipe(res);\n";
  entry = entry + "    return;\n";
  entry = entry + "  }\n\n";
  entry = entry + "  res.writeHead(404, { \"Content-Type\": \"text/html\" });\n";
  entry = entry + "  res.end(\"<h1>404 Not Found</h1>\");\n";
  entry = entry + "});\n\n";
  entry = entry + "server.listen(PORT, () => {\n";
  entry = entry + "  console.log(\"\\n  Nodeon production server on http://localhost:\" + PORT + \"\\n\");\n";
  entry = entry + "});\n";
  return entry;
}
function wrapHtml(body, title, config) {
  let html = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n";
  html = html + "  <meta charset=\"UTF-8\">\n";
  html = html + "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n";
  html = html + "  <title>" + title + "</title>\n";
  if (config.css) {
    html = html + "  <link rel=\"stylesheet\" href=\"" + config.css + "\">\n";
  }
  html = html + "</head>\n<body>\n";
  html = html + body + "\n";
  html = html + "  <script type=\"module\">\n";
  html = html + "    document.querySelectorAll(\"[data-island]\").forEach(async el => {\n";
  html = html + "      const name = el.dataset.island;\n";
  html = html + "      try {\n";
  html = html + "        const mod = await import(\"/_nova/islands/\" + name + \".js\");\n";
  html = html + "        if (mod.default?.hydrate) mod.default.hydrate(el);\n";
  html = html + "        else if (mod.hydrate) mod.hydrate(el);\n";
  html = html + "      } catch (e) { console.warn(\"Island hydration failed:\", name, e); }\n";
  html = html + "    });\n";
  html = html + "  </script>\n";
  html = html + "</body>\n</html>";
  return html;
}
function fileToRoute(relPath) {
  let route = relPath.replace(/\\/g, "/").replace(/\.no$/, "").replace(/\.js$/, "");
  if (route.endsWith("/index")) {
    route = route.slice(0, route.length - 6);
  }
  if (route === "index") {
    route = "";
  }
  route = route.replace(/\[(\w+)\]/g, ":$1");
  return "/" + route;
}
function walkFiles(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const sub = walkFiles(full, ext);
      for (const s of sub) {
        results.push(s);
      }
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
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