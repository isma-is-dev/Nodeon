/**
 * Nova Island Bundler — generates per-island client-side JS bundles.
 *
 * Uses esbuild to create optimized, self-contained bundles for each island
 * component. These bundles are placed in the output directory and loaded
 * on-demand by the hydration runtime.
 *
 * API:
 *   bundleIslands(opts)          — bundle all registered islands
 *   bundleIsland(id, opts)       — bundle a single island
 *   generateIslandEntry(island)  — generate entry file content for an island
 *   scanForIslands(srcDir)       — scan source files for island registrations
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Island Scanner ──────────────────────────────────────────────

/**
 * Scan source directory for files that register islands.
 * Looks for island() calls or _island metadata.
 * @param {string} srcDir - Directory to scan
 * @returns {object[]} Array of { id, name, filePath, strategy }
 */
function scanForIslands(srcDir) {
  const results = [];
  if (!fs.existsSync(srcDir)) return results;

  const files = walkDir(srcDir);
  for (const filePath of files) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".no")) continue;

    try {
      const content = fs.readFileSync(filePath, "utf8");
      // Look for island() registration patterns
      const regex = /island\s*\(\s*(\w+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        results.push({
          name: match[1],
          filePath: filePath,
          exportName: match[1],
        });
      }
    } catch (e) {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Generate the entry file content for a single island bundle.
 * The entry imports the island component and registers it for hydration.
 * @param {object} island - { name, filePath, exportName }
 * @returns {string} JavaScript source for the entry file
 */
function generateIslandEntry(island) {
  const relPath = island.filePath.replace(/\\/g, "/");
  return [
    '// Auto-generated island entry for: ' + island.name,
    'import { ' + island.exportName + ' } from "' + relPath + '";',
    'export default ' + island.exportName + ';',
  ].join("\n") + "\n";
}

/**
 * Generate a manifest of all island entries (for the hydration runtime).
 * @param {object[]} islands - Array of island info objects
 * @param {string} baseUrl - Base URL for island scripts
 * @returns {string} JavaScript source for the manifest
 */
function generateManifest(islands, baseUrl) {
  const entries = islands.map(function(island) {
    return '  "' + island.name + '": () => import("' + baseUrl + island.name + '.js")';
  });

  return [
    '// Auto-generated Nova island manifest',
    'export const islandModules = {',
    entries.join(",\n"),
    '};',
  ].join("\n") + "\n";
}

// ── Bundler ─────────────────────────────────────────────────────

/**
 * Bundle all islands found in the source directory.
 * @param {object} opts
 * @param {string} opts.srcDir - Source directory with island components
 * @param {string} opts.outDir - Output directory for bundles
 * @param {string} [opts.baseUrl] - Base URL for island scripts (default: "/_nova/islands/")
 * @param {boolean} [opts.minify] - Minify output (default: true)
 * @param {object[]} [opts.islands] - Pre-scanned island list (skips scanning)
 * @returns {Promise<object>} Build result { islands, manifest, errors }
 */
async function bundleIslands(opts) {
  const srcDir = opts.srcDir;
  const outDir = opts.outDir || path.join(srcDir, "..", "dist", "_nova", "islands");
  const baseUrl = opts.baseUrl || "/_nova/islands/";
  const minify = opts.minify !== false;
  const islands = opts.islands || scanForIslands(srcDir);

  if (islands.length === 0) {
    return { islands: [], manifest: null, errors: [] };
  }

  // Ensure output directory
  fs.mkdirSync(outDir, { recursive: true });

  // Generate entry files in a temp directory
  const tmpDir = path.join(outDir, ".tmp-entries");
  fs.mkdirSync(tmpDir, { recursive: true });

  const entryPoints = [];
  for (const island of islands) {
    const entryContent = generateIslandEntry(island);
    const entryPath = path.join(tmpDir, island.name + ".entry.js");
    fs.writeFileSync(entryPath, entryContent, "utf8");
    entryPoints.push(entryPath);
  }

  // Generate manifest
  const manifestContent = generateManifest(islands, baseUrl);
  const manifestPath = path.join(outDir, "manifest.js");
  fs.writeFileSync(manifestPath, manifestContent, "utf8");

  const errors = [];
  const bundled = [];

  // Try to use esbuild if available
  try {
    const esbuild = require("esbuild");

    for (let i = 0; i < islands.length; i++) {
      const island = islands[i];
      const entryPath = entryPoints[i];

      try {
        const result = await esbuild.build({
          entryPoints: [entryPath],
          outfile: path.join(outDir, island.name + ".js"),
          bundle: true,
          format: "esm",
          platform: "browser",
          minify: minify,
          sourcemap: true,
          target: ["es2020"],
          logLevel: "silent",
        });

        if (result.errors && result.errors.length > 0) {
          errors.push({ island: island.name, errors: result.errors });
        } else {
          const outFile = path.join(outDir, island.name + ".js");
          const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
          bundled.push({
            name: island.name,
            path: outFile,
            size: size,
          });
        }
      } catch (buildErr) {
        errors.push({ island: island.name, error: buildErr.message });
      }
    }
  } catch (e) {
    // esbuild not available — generate simple pass-through bundles
    for (const island of islands) {
      const entryContent = generateIslandEntry(island);
      const outFile = path.join(outDir, island.name + ".js");
      fs.writeFileSync(outFile, entryContent, "utf8");
      bundled.push({
        name: island.name,
        path: outFile,
        size: entryContent.length,
        unbundled: true,
      });
    }
  }

  // Clean up temp entries
  try {
    fs.rmSync(tmpDir, { recursive: true });
  } catch (e) {
    // ignore cleanup errors
  }

  return {
    islands: bundled,
    manifest: manifestPath,
    errors: errors,
  };
}

/**
 * Bundle a single island component.
 * @param {object} island - { name, filePath, exportName }
 * @param {object} opts - { outDir, minify }
 * @returns {Promise<object>} Build result
 */
async function bundleIsland(island, opts) {
  return bundleIslands({
    srcDir: path.dirname(island.filePath),
    outDir: opts.outDir,
    minify: opts.minify,
    islands: [island],
  });
}

// ── Utility ─────────────────────────────────────────────────────

function walkDir(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const sub = walkDir(full);
      for (const s of sub) results.push(s);
    } else {
      results.push(full);
    }
  }
  return results;
}

module.exports = {
  scanForIslands,
  generateIslandEntry,
  generateManifest,
  bundleIslands,
  bundleIsland,
};
