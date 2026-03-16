import { GREEN, RED, DIM, YELLOW, CYAN, BOLD, RESET } from "../utils/colors.js";
import { compileFile } from "../utils/compile.js";
const fs = require("fs");
const path = require("path");
const http = require("http");
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
const MIME_TYPES = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm" };
function compileAndRun(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const compiler = require(path.resolve(process.cwd(), "dist", "nodeon-compiler.cjs"));
  const result = compiler.compile(source);
  if (result.diagnostics.length > 0) {
    for (const diag of result.diagnostics) {
      console.error("  " + RED + "error" + RESET + ": " + diag.message);
    }
    return null;
  }
  const vm = require("vm");
  const mod = { exports: {} };
  let code = result.js;
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g, "const {$1} = require(\"$2\");");
  code = code.replace(/import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g, "const $1 = require(\"$2\");");
  code = code.replace(/export\s+(class|function|const|let|var)\s+/g, "$1 ");
  code = code.replace(/export\s+default\s+/g, "module.exports.default = ");
  const exportPattern = /(?:class|function)\s+(\w+)/g;
  let matched = exportPattern.exec(result.js);
  const namedExports = [];
  while (matched !== null) {
    if (result.js.includes("export " + matched[0].trim().split(" ")[0]) || result.js.includes("export " + matched[0])) {
      namedExports.push(matched[1]);
    }
    matched = exportPattern.exec(result.js);
  }
  for (const name of namedExports) {
    code = code + "\nmodule.exports." + name + " = typeof " + name + " !== 'undefined' ? " + name + " : undefined;";
  }
  try {
    const script = new vm.Script(code, { filename: filePath });
    const sandbox = { module: mod, exports: mod.exports, require: require, __filename: filePath, __dirname: path.dirname(filePath), console: console, process: process, Buffer: Buffer, setTimeout: setTimeout, setInterval: setInterval, clearTimeout: clearTimeout, clearInterval: clearInterval, URL: URL, URLSearchParams: URLSearchParams };
    script.runInNewContext(sandbox);
    return mod.exports;
  } catch (err) {
    console.error("  " + RED + "error" + RESET + " executing " + filePath + ": " + err.message);
    return null;
  }
}
function buildRoutes(pagesDir) {
  const routes = [];
  if (!fs.existsSync(pagesDir)) {
    return routes;
  }
  function scan(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, prefix + "/" + entry.name);
      } else {
        if (!entry.name.endsWith(".no") && !entry.name.endsWith(".js")) {
          continue;
        }
        const ext = path.extname(entry.name);
        const base = entry.name.slice(0, 0 - ext.length);
        const segment = base === "index" ? "" : "/" + base;
        const urlPath = prefix + segment || "/";
        const paramNames = [];
        const pattern = urlPath.replace(/\[([^\]]+)\]/g, (_, name) => {
          paramNames.push(name);
          return ":(" + name + ")";
        });
        const regexStr = "^" + pattern.replace(/:\(([^)]+)\)/g, "([^/]+)").replace(/\//g, "\\/") + "$";
        routes.push({ pattern: urlPath, regex: new RegExp(regexStr), paramNames: paramNames, filePath: full, isDynamic: paramNames.length > 0, isApi: urlPath.startsWith("/api/") || urlPath.startsWith("/api") });
      }
    }
  }
  scan(pagesDir, "");
  routes.sort((a, b) => {
    if (a.isDynamic !== b.isDynamic) {
      return a.isDynamic ? 1 : -1;
    }
    return a.pattern.localeCompare(b.pattern);
  });
  return routes;
}
function matchRoute(routes, urlPath) {
  const normalized = urlPath === "/" ? "/" : urlPath.replace(/\/$/, "");
  for (const route of routes) {
    const matched = normalized.match(route.regex);
    if (matched) {
      const params = {};
      let i = 0;
      while (i < route.paramNames.length) {
        params[route.paramNames[i]] = matched[i + 1];
        i = i + 1;
      }
      return { route: route, params: params };
    }
  }
  return null;
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderErrorPage(err, urlPath) {
  return "<!DOCTYPE html><html><head><title>Nova Error</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0}pre{background:#16213e;padding:1rem;border-radius:8px;overflow-x:auto;border-left:4px solid #e94560}h1{color:#e94560}</style></head><body><h1>Server Error</h1><p>Error rendering <code>" + urlPath + "</code></p><pre>" + escapeHtml(err.stack || err.message) + "</pre></body></html>";
}
function render404(urlPath, routes) {
  const routeList = routes.map(r => "<li><a href=\"" + r.pattern + "\">" + r.pattern + "</a></li>").join("");
  return "<!DOCTYPE html><html><head><title>404 - Nova</title><style>body{font-family:system-ui;padding:2rem;background:#1a1a2e;color:#e0e0e0}a{color:#00d2ff}h1{color:#e94560}ul{list-style:none;padding:0}li{padding:4px 0}</style></head><body><h1>404 - Not Found</h1><p>No route matches <code>" + urlPath + "</code></p><h2>Available routes:</h2><ul>" + routeList + "</ul></body></html>";
}
function wrapHtmlShell(html, title) {
  if (html.includes("<html") || html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
    return html;
  }
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>" + (title || "Nova") + "</title>\n</head>\n<body>\n" + html + "\n</body>\n</html>";
}
function injectLiveReload(html, port) {
  const script = "\n<script>(function(){ var es = new EventSource(\"/__nova_reload\"); es.onmessage = function(){ location.reload(); }; })();</script>\n";
  if (html.includes("</body>")) {
    return html.replace("</body>", script + "</body>");
  }
  return html + script;
}
let sseClients = [];
function notifyReload() {
  for (const client of sseClients) {
    try {
      client.write("data: reload\n\n");
    } catch (e) {

    }
  }
}
export function runDev(args) {
  const config = loadConfig();
  const flags = args || [];
  let port = 3000;
  const portIdx = flags.indexOf("--port");
  if (portIdx !== -1 && flags[portIdx + 1]) {
    port = parseInt(flags[portIdx + 1], 10);
  } else if (config.port) {
    port = config.port;
  }
  const projectDir = process.cwd();
  const pagesDir = path.join(projectDir, "src", "pages");
  const publicDir = path.join(projectDir, "public");
  if (!fs.existsSync(pagesDir)) {
    console.error("");
    console.error("  " + RED + "Error:" + RESET + " No src/pages/ directory found.");
    console.error("  " + DIM + "Run 'nodeon new' to create a project, or create src/pages/ manually." + RESET);
    console.error("");
    process.exit(1);
  }
  let routes = buildRoutes(pagesDir);
  function handleRequest(req, res) {
    const url = new URL(req.url, "http://localhost");
    const urlPath = url.pathname;
    if (urlPath === "/__nova_reload") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });
      res.write("data: connected\n\n");
      sseClients.push(res);
      req.on("close", () => {
        sseClients = sseClients.filter(c => c !== res);
      });
      return;
    }
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
        const pageMod = compileAndRun(matched.route.filePath);
        if (!pageMod) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(renderErrorPage({ message: "Compilation failed" }, urlPath));
          return;
        }
        if (matched.route.isApi) {
          const handler = pageMod.default || pageMod;
          let result = null;
          if (typeof handler === "function") {
            result = handler(req, res, matched.params);
          } else {
            const method = req.method.toLowerCase();
            const methodName = method === "delete" ? "del" : method;
            if (handler[methodName] && typeof handler[methodName] === "function") {
              result = handler[methodName](req, matched.params);
            } else if (typeof handler === "object") {
              result = handler;
            }
          }
          if (!res.headersSent) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          }
        } else {
          const PageClass = pageMod.default || pageMod;
          let html = "";
          if (typeof PageClass === "function" && PageClass.prototype && PageClass.prototype.template) {
            const instance = new PageClass();
            let data = {};
            if (typeof instance.load === "function") {
              data = instance.load(matched.params) || {};
            }
            html = instance.template(data, matched.params);
            if (typeof instance.style === "function") {
              const css = instance.style();
              if (css) {
                html = "<style>" + css + "</style>" + html;
              }
            }
          } else if (typeof PageClass === "function") {
            html = PageClass(matched.params);
          } else if (typeof PageClass === "string") {
            html = PageClass;
          }
          html = wrapHtmlShell(html, "Nova");
          html = injectLiveReload(html, port);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        }
      } catch (err) {
        console.error("  " + RED + "Error rendering " + urlPath + ":" + RESET + " " + err.message);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(renderErrorPage(err, urlPath));
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(render404(urlPath, routes));
  }
  const server = http.createServer(handleRequest);
  let debounceTimer = null;
  function watchHandler() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      routes = buildRoutes(pagesDir);
      console.log("  " + DIM + "[nova] Routes reloaded (" + routes.length + " routes)" + RESET);
      notifyReload();
    }, 100);
  }
  if (fs.existsSync(pagesDir)) {
    fs.watch(pagesDir, { recursive: true }, watchHandler);
  }
  const srcDir = path.join(projectDir, "src");
  if (fs.existsSync(srcDir)) {
    fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
      if (filename && !filename.startsWith("pages")) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          console.log("  " + DIM + "[nova] Source changed: " + filename + RESET);
          notifyReload();
        }, 150);
      }
    });
  }
  server.listen(port, () => {
    console.log("");
    console.log("  " + CYAN + BOLD + "⚡ Nova dev server" + RESET);
    console.log("");
    console.log("  " + BOLD + "Local:" + RESET + "   http://localhost:" + port);
    console.log("  " + BOLD + "Routes:" + RESET + "  " + routes.length + " pages");
    console.log("");
    for (const route of routes) {
      const tag = route.isApi ? " " + YELLOW + "[API]" + RESET : "";
      const dyn = route.isDynamic ? " " + CYAN + "[dynamic]" + RESET : "";
      console.log("  " + DIM + "→" + RESET + " " + route.pattern + tag + dyn);
    }
    console.log("");
    console.log("  " + DIM + "Watching for changes..." + RESET);
    console.log("");
  });
}