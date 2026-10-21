// Incremental Compilation — Only recompile changed files
// Uses file content hashing to detect changes and a persistent cache

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CACHE_FILE = ".nodeon-cache.json";

/**
 * Create an incremental build context.
 */
function createIncrementalContext(options) {
  const opts = options || {};
  const cacheDir = opts.cacheDir || process.cwd();
  const cachePath = path.join(cacheDir, CACHE_FILE);

  let cache = loadCache(cachePath);

  return {
    /**
     * Check if a file needs recompilation.
     * Returns true if the file has changed since last build.
     */
    needsRebuild: function(filePath) {
      const absPath = path.resolve(filePath);
      const currentHash = hashFile(absPath);
      if (!currentHash) return true;

      const cached = cache.files[absPath];
      if (!cached) return true;
      if (cached.hash !== currentHash) return true;

      // Check if output file still exists
      if (cached.outputPath && !fs.existsSync(cached.outputPath)) return true;

      // Check if any dependency has changed
      if (cached.deps && cached.deps.length > 0) {
        for (const dep of cached.deps) {
          const depHash = hashFile(dep);
          const cachedDep = cache.files[dep];
          if (!cachedDep || cachedDep.hash !== depHash) return true;
        }
      }

      return false;
    },

    /**
     * Record a successful compilation.
     */
    recordBuild: function(filePath, outputPath, deps) {
      const absPath = path.resolve(filePath);
      cache.files[absPath] = {
        hash: hashFile(absPath),
        outputPath: outputPath ? path.resolve(outputPath) : null,
        deps: (deps || []).map(function(d) { return path.resolve(d); }),
        timestamp: Date.now(),
      };
    },

    /**
     * Invalidate a specific file's cache entry.
     */
    invalidate: function(filePath) {
      const absPath = path.resolve(filePath);
      delete cache.files[absPath];
    },

    /**
     * Invalidate all cache entries.
     */
    invalidateAll: function() {
      cache.files = {};
    },

    /**
     * Save the cache to disk.
     */
    save: function() {
      saveCache(cachePath, cache);
    },

    /**
     * Get stats about the cache.
     */
    stats: function() {
      const entries = Object.keys(cache.files);
      return {
        totalEntries: entries.length,
        cacheFile: cachePath,
        lastBuild: cache.lastBuild,
      };
    },

    /**
     * Filter a list of files to only those needing rebuild.
     */
    filterChanged: function(files) {
      var self = this;
      return files.filter(function(f) { return self.needsRebuild(f); });
    },

    /**
     * Mark the build as complete and save.
     */
    finalize: function() {
      cache.lastBuild = Date.now();
      this.save();
    },
  };
}

/**
 * Hash a file's contents using SHA-256.
 */
function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch (e) {
    return null;
  }
}

/**
 * Hash a string.
 */
function hashString(str) {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

/**
 * Load the cache from disk.
 */
function loadCache(cachePath) {
  try {
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (data && data.version === 1 && data.files) {
        return data;
      }
    }
  } catch (e) {
    // Corrupted cache, start fresh
  }
  return { version: 1, files: {}, lastBuild: null };
}

/**
 * Save the cache to disk.
 */
function saveCache(cachePath, cache) {
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache), "utf8");
  } catch (e) {
    // Silently fail if we can't write cache
  }
}

/**
 * Scan for dependencies in a .no source file (basic import analysis).
 */
function extractDependencies(source, filePath) {
  const deps = [];
  const dir = path.dirname(filePath);
  const importRegex = /import\s+.*?\s+from\s+["']([^"']+)["']/g;
  var match;
  while ((match = importRegex.exec(source)) !== null) {
    const src = match[1];
    if (src.startsWith("./") || src.startsWith("../")) {
      const ext = src.endsWith(".no") ? "" : ".no";
      const resolved = path.resolve(dir, src + ext);
      if (fs.existsSync(resolved)) {
        deps.push(resolved);
      }
    }
  }
  return deps;
}

module.exports = {
  createIncrementalContext,
  hashFile,
  hashString,
  extractDependencies,
};
