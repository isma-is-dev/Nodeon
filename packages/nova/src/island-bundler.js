import fs from "fs";
import path from "path";
function scanForIslands(srcDir) {
  const results = [];
  if (!fs.existsSync(srcDir)) {
    return results;
  }
  const files = walkDir(srcDir);
  for (const filePath of files) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".no")) {
      continue;
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const regex = /island\s*\(\s*(\w+)/g;
      let matched = regex.exec(content);
      while (matched !== null) {
        results.push({ name: matched[1], filePath: filePath, exportName: matched[1] });
        matched = regex.exec(content);
      }
    } catch (e) {

    }
  }
  return results;
}
function generateIslandEntry(islandInfo) {
  const relPath = islandInfo.filePath.replace(/\\/g, "/");
  return ["// Auto-generated island entry for: " + islandInfo.name, "import { " + islandInfo.exportName + " } from \"" + relPath + "\";", "export default " + islandInfo.exportName + ";"].join("\n") + "\n";
}
function generateManifest(islandList, baseUrl) {
  const entries = islandList.map(islandInfo => {
    return "  \"" + islandInfo.name + "\": () => import(\"" + baseUrl + islandInfo.name + ".js\")";
  });
  return ["// Auto-generated Nova island manifest", "export const islandModules = {", entries.join(",\n"), "};"].join("\n") + "\n";
}
async function bundleIslands(opts) {
  const srcDir = opts.srcDir;
  const outDir = opts.outDir || path.join(srcDir, "..", "dist", "_nova", "islands");
  const baseUrl = opts.baseUrl || "/_nova/islands/";
  const minify = opts.minify !== false;
  const islandList = opts.islands || scanForIslands(srcDir);
  if (islandList.length === 0) {
    return { islands: [], manifest: null, errors: [] };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = path.join(outDir, ".tmp-entries");
  fs.mkdirSync(tmpDir, { recursive: true });
  const entryPoints = [];
  for (const islandInfo of islandList) {
    const entryContent = generateIslandEntry(islandInfo);
    const entryPath = path.join(tmpDir, islandInfo.name + ".entry.js");
    fs.writeFileSync(entryPath, entryContent, "utf8");
    entryPoints.push(entryPath);
  }
  const manifestContent = generateManifest(islandList, baseUrl);
  const manifestPath = path.join(outDir, "manifest.js");
  fs.writeFileSync(manifestPath, manifestContent, "utf8");
  const errors = [];
  const bundled = [];
  try {
    const esbuildPath = "esbuild";
    const esbuild = await import(esbuildPath);
    let i = 0;
    while (i < islandList.length) {
      const islandInfo = islandList[i];
      const entryPath = entryPoints[i];
      try {
        const buildResult = await esbuild.build({ entryPoints: [entryPath], outfile: path.join(outDir, islandInfo.name + ".js"), bundle: true, format: "esm", platform: "browser", minify: minify, sourcemap: true, target: ["es2020"], logLevel: "silent" });
        if (buildResult.errors && buildResult.errors.length > 0) {
          errors.push({ island: islandInfo.name, errors: buildResult.errors });
        } else {
          const outFile = path.join(outDir, islandInfo.name + ".js");
          const size = (() => { if (fs.existsSync(outFile)) { return fs.statSync(outFile).size; } else { return 0; } })();
          bundled.push({ name: islandInfo.name, path: outFile, size: size });
        }
      } catch (buildErr) {
        errors.push({ island: islandInfo.name, error: buildErr.message });
      }
      i++;
    }
  } catch (e) {
    for (const islandInfo of islandList) {
      const entryContent = generateIslandEntry(islandInfo);
      const outFile = path.join(outDir, islandInfo.name + ".js");
      fs.writeFileSync(outFile, entryContent, "utf8");
      bundled.push({ name: islandInfo.name, path: outFile, size: entryContent.length, unbundled: true });
    }
  }
  try {
    fs.rmSync(tmpDir, { recursive: true });
  } catch (e) {

  }
  return { islands: bundled, manifest: manifestPath, errors: errors };
}
async function bundleIsland(islandInfo, opts) {
  return bundleIslands({ srcDir: path.dirname(islandInfo.filePath), outDir: opts.outDir, minify: opts.minify, islands: [islandInfo] });
}
function walkDir(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const sub = walkDir(full);
      for (const s of sub) {
        results.push(s);
      }
    } else {
      results.push(full);
    }
  }
  return results;
}
export { scanForIslands, generateIslandEntry, generateManifest, bundleIslands, bundleIsland };