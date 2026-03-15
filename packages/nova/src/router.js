import fs from "fs";
import path from "path";
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
      } else if (entry.name.endsWith(".no") || entry.name.endsWith(".js")) {
        const ext = path.extname(entry.name);
        const base = entry.name.slice(0, -ext.length);
        const segment = (() => { if (base === "index") { return ""; } else { return "/" + base; } })();
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
      return (() => { if (a.isDynamic) { return 1; } else { return -1; } })();
    }
    return a.pattern.localeCompare(b.pattern);
  });
  return routes;
}
function matchRoute(routes, urlPath) {
  const normalized = (() => { if (urlPath === "/") { return "/"; } else { return urlPath.replace(/\/$/, ""); } })();
  for (const route of routes) {
    const matched = normalized.match(route.regex);
    if (matched) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = matched[i + 1];
      });
      return { route: route, params: params };
    }
  }
  return null;
}
export { buildRoutes, matchRoute };