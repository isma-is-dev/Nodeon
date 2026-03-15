import http from "http";
import fs from "fs";
import path from "path";
import { buildRoutes, matchRoute } from "./router.js";
import { renderPage, wrapHtmlShell } from "./renderer.js";
import { compileNoFile } from "./compiler-bridge.js";
import { injectIslandScripts } from "./island.js";
const MIME_TYPES = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
function createDevServer(projectDir, opts) {
  const port = opts.port || 3000;
  const pagesDir = path.join(projectDir, "src", "pages");
  const publicDir = path.join(projectDir, "public");
  let routes = buildRoutes(pagesDir);
  async function handleRequest(req, res) {
    const url = new URL(req.url, "http://localhost");
    const urlPath = url.pathname;
    if (urlPath !== "/" && fs.existsSync(publicDir)) {
      const staticPath = path.join(publicDir, urlPath);
      if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
        const ext = path.extname(staticPath);
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        fs.createReadStream(staticPath).pipe(res);
        return;
      }
    }
    const matched = matchRoute(routes, urlPath);
    if (matched) {
      try {
        const pageMod = await loadPageModule(matched.route.filePath);
        if (matched.route.isApi) {
          const handler = pageMod.default || pageMod;
          const result = (() => { if (typeof handler === "function") { return await handler(req, res, matched.params); } else { return handler; } })();
          if (!res.headersSent) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          }
        } else {
          let html = await renderPage(pageMod, matched.params, {});
          html = wrapHtmlShell(html, "Nova");
          html = injectIslandScripts(html, {});
          if (opts.liveReload !== false) {
            html = injectLiveReload(html, port);
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        }
      } catch (err) {
        console.error("  \u001b[31mError rendering " + urlPath + ":\u001b[0m", err.message);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(renderErrorPage(err, urlPath));
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(render404(urlPath, routes));
  }
  const server = http.createServer(handleRequest);
  if (fs.existsSync(pagesDir)) {
    fs.watch(pagesDir, { recursive: true }, () => {
      routes = buildRoutes(pagesDir);
      console.log("  \u001b[2m[nova] Routes reloaded\u001b[0m");
    });
  }
  server.listen(port, () => {
    console.log("");
    console.log("  \u001b[36m\u001b[1m⚡ Nova dev server\u001b[0m");
    console.log("");
    console.log("  \u001b[1mLocal:\u001b[0m   http://localhost:" + port);
    console.log("  \u001b[1mRoutes:\u001b[0m  " + routes.length + " pages");
    console.log("");
    for (const r of routes) {
      const tag = (() => { if (r.isApi) { return " \u001b[33m[API]\u001b[0m"; } else { return ""; } })();
      const dyn = (() => { if (r.isDynamic) { return " \u001b[36m[dynamic]\u001b[0m"; } else { return ""; } })();
      console.log("  \u001b[2m→\u001b[0m " + r.pattern + tag + dyn);
    }
    console.log("");
  });
  return server;
}
async function loadPageModule(filePath) {
  if (filePath.endsWith(".no")) {
    return compileNoFile(filePath);
  }
  const fileUrl = "file:///" + filePath.replace(/\\/g, "/");
  return import(fileUrl);
}
function injectLiveReload(html, port) {
  const script = `
<script>(() => { const es = new EventSource('/__nova_reload'); es.onmessage = () => location.reload(); \})();</script>
`;
  if (html.includes("</body>")) {
    return html.replace("</body>", script + "</body>");
  }
  return html + script;
}
function renderErrorPage(err, urlPath) {
  return `<!DOCTYPE html><html><head><title>Nova Error</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0\}pre{background:#16213e;padding:1rem;border-radius:8px;overflow-x:auto;border-left:4px solid #e94560\}h1{color:#e94560\}code{color:#0f3460\}</style></head><body><h1>⚠ Server Error</h1><p>Error rendering <code>` + urlPath + "</code></p><pre>" + escapeHtml(err.stack || err.message) + "</pre></body></html>";
}
function render404(urlPath, routes) {
  const routeList = routes.map(r => {
    return "<li><a href=\"" + r.pattern + "\">" + r.pattern + "</a></li>";
  }).join("");
  return `<!DOCTYPE html><html><head><title>404 — Nova</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0\}a{color:#00d2ff\}h1{color:#e94560\}ul{list-style:none;padding:0\}li{padding:4px 0\}</style></head><body><h1>404 — Not Found</h1><p>No route matches <code>` + urlPath + "</code></p><h2>Available routes:</h2><ul>" + routeList + "</ul></body></html>";
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export { createDevServer };