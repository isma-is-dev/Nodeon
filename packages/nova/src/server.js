// Nova dev server
// HTTP server with file-based routing, live reload, and static file serving.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { buildRoutes, matchRoute } = require("./router");
const { renderPage, wrapHtmlShell } = require("./renderer");
const { compileNoFile } = require("./compiler-bridge");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/**
 * Create and start the Nova dev server.
 */
function createDevServer(projectDir, opts) {
  const port = opts.port || 3000;
  const pagesDir = path.join(projectDir, "src", "pages");
  const publicDir = path.join(projectDir, "public");

  let routes = buildRoutes(pagesDir);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const urlPath = url.pathname;

    // 1. Try static files from public/
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

    // 2. Try route matching
    const matched = matchRoute(routes, urlPath);
    if (matched) {
      try {
        const pageMod = await loadPageModule(matched.route.filePath);

        if (matched.route.isApi) {
          // API route — return JSON
          const handler = pageMod.default || pageMod;
          const result = typeof handler === "function"
            ? await handler(req, res, matched.params)
            : handler;
          if (!res.headersSent) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          }
        } else {
          // Page route — render HTML
          let html = await renderPage(pageMod, matched.params, {});
          html = wrapHtmlShell(html, "Nova");

          // Inject island hydration scripts if any islands are present
          const { injectIslandScripts } = require("./island");
          html = injectIslandScripts(html, {});

          // Inject live reload script in dev mode
          if (opts.liveReload !== false) {
            html = injectLiveReload(html, port);
          }

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        }
      } catch (err) {
        console.error("  \x1b[31mError rendering " + urlPath + ":\x1b[0m", err.message);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(renderErrorPage(err, urlPath));
      }
      return;
    }

    // 3. 404
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(render404(urlPath, routes));
  });

  // File watcher for route changes
  if (fs.existsSync(pagesDir)) {
    fs.watch(pagesDir, { recursive: true }, () => {
      routes = buildRoutes(pagesDir);
      console.log("  \x1b[2m[nova] Routes reloaded\x1b[0m");
    });
  }

  server.listen(port, () => {
    console.log("");
    console.log("  \x1b[36m\x1b[1m⚡ Nova dev server\x1b[0m");
    console.log("");
    console.log("  \x1b[1mLocal:\x1b[0m   http://localhost:" + port);
    console.log("  \x1b[1mRoutes:\x1b[0m  " + routes.length + " pages");
    console.log("");
    for (const r of routes) {
      const tag = r.isApi ? " \x1b[33m[API]\x1b[0m" : "";
      const dyn = r.isDynamic ? " \x1b[36m[dynamic]\x1b[0m" : "";
      console.log("  \x1b[2m→\x1b[0m " + r.pattern + tag + dyn);
    }
    console.log("");
  });

  return server;
}

/**
 * Load a page module — compile .no files on-the-fly, or require .js directly.
 */
async function loadPageModule(filePath) {
  if (filePath.endsWith(".no")) {
    return compileNoFile(filePath);
  }
  // Clear require cache for hot reload
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

/**
 * Inject live reload script into HTML.
 */
function injectLiveReload(html, port) {
  const script = "\n<script>(() => { const es = new EventSource('/__nova_reload'); es.onmessage = () => location.reload(); })();</script>\n";
  if (html.includes("</body>")) {
    return html.replace("</body>", script + "</body>");
  }
  return html + script;
}

/**
 * Render a dev-friendly error page.
 */
function renderErrorPage(err, urlPath) {
  return "<!DOCTYPE html><html><head><title>Nova Error</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0}pre{background:#16213e;padding:1rem;border-radius:8px;overflow-x:auto;border-left:4px solid #e94560}h1{color:#e94560}code{color:#0f3460}</style></head><body><h1>⚠ Server Error</h1><p>Error rendering <code>" + urlPath + "</code></p><pre>" + escapeHtml(err.stack || err.message) + "</pre></body></html>";
}

/**
 * Render a dev-friendly 404 page with available routes.
 */
function render404(urlPath, routes) {
  const routeList = routes.map(function(r) {
    return "<li><a href=\"" + r.pattern + "\">" + r.pattern + "</a></li>";
  }).join("");
  return "<!DOCTYPE html><html><head><title>404 — Nova</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0}a{color:#00d2ff}h1{color:#e94560}ul{list-style:none;padding:0}li{padding:4px 0}</style></head><body><h1>404 — Not Found</h1><p>No route matches <code>" + urlPath + "</code></p><h2>Available routes:</h2><ul>" + routeList + "</ul></body></html>";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

module.exports = { createDevServer };
