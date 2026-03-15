// Nova file-based router
// Scans pages/ directory and maps files to URL routes.
//
// Convention:
//   pages/index.no      → /
//   pages/about.no      → /about
//   pages/blog/index.no → /blog
//   pages/blog/[slug].no → /blog/:slug  (dynamic)
//   pages/api/posts.no  → /api/posts   (API route)

const fs = require("fs");
const path = require("path");

/**
 * Scan a pages directory and return an array of route definitions.
 * Each route: { pattern, paramNames, filePath, isDynamic, isApi }
 */
function buildRoutes(pagesDir) {
  const routes = [];
  if (!fs.existsSync(pagesDir)) return routes;

  function scan(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, prefix + "/" + entry.name);
      } else if (entry.name.endsWith(".no") || entry.name.endsWith(".js")) {
        const ext = path.extname(entry.name);
        const base = entry.name.slice(0, -ext.length);
        const segment = base === "index" ? "" : "/" + base;
        const urlPath = (prefix + segment) || "/";
        const paramNames = [];

        // Convert [param] segments to :param
        const pattern = urlPath.replace(/\[([^\]]+)\]/g, (_, name) => {
          paramNames.push(name);
          return ":(" + name + ")";
        });

        // Build regex for matching
        const regexStr = "^" + pattern
          .replace(/:\(([^)]+)\)/g, "([^/]+)")
          .replace(/\//g, "\\/") + "$";

        routes.push({
          pattern: urlPath,
          regex: new RegExp(regexStr),
          paramNames,
          filePath: full,
          isDynamic: paramNames.length > 0,
          isApi: urlPath.startsWith("/api/") || urlPath.startsWith("/api"),
        });
      }
    }
  }

  scan(pagesDir, "");

  // Sort: static routes first, then dynamic
  routes.sort((a, b) => {
    if (a.isDynamic !== b.isDynamic) return a.isDynamic ? 1 : -1;
    return a.pattern.localeCompare(b.pattern);
  });

  return routes;
}

/**
 * Match a URL path against the route table.
 * Returns { route, params } or null.
 */
function matchRoute(routes, urlPath) {
  // Normalize: strip trailing slash (except root)
  const normalized = urlPath === "/" ? "/" : urlPath.replace(/\/$/, "");

  for (const route of routes) {
    const match = normalized.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { route, params };
    }
  }
  return null;
}

module.exports = { buildRoutes, matchRoute };
