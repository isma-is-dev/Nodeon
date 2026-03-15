import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { scanForIslands, generateIslandEntry, generateManifest, bundleIslands } = require("../packages/nova/src/island-bundler");

// Helper: create a temp directory for test fixtures
function createTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nova-island-test-"));
}

function cleanTmpDir(dir: string) {
  try { fs.rmSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}

describe("Nova Island Bundler: scanForIslands", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("finds island() registrations in JS files", () => {
    fs.writeFileSync(path.join(tmpDir, "counter.js"), `
      const { island } = require("nova");
      class Counter { template() { return "<button>0</button>"; } }
      island(Counter, { strategy: "load" });
      module.exports = Counter;
    `, "utf8");

    const islands = scanForIslands(tmpDir);
    expect(islands.length).toBe(1);
    expect(islands[0].name).toBe("Counter");
  });

  it("finds multiple islands across files", () => {
    fs.writeFileSync(path.join(tmpDir, "a.js"), 'island(Toggle);', "utf8");
    fs.writeFileSync(path.join(tmpDir, "b.js"), 'island(Slider);', "utf8");

    const islands = scanForIslands(tmpDir);
    expect(islands.length).toBe(2);
    const names = islands.map((i: any) => i.name).sort();
    expect(names).toEqual(["Slider", "Toggle"]);
  });

  it("returns empty array for empty directory", () => {
    expect(scanForIslands(tmpDir)).toEqual([]);
  });

  it("returns empty array for non-existent directory", () => {
    expect(scanForIslands("/non/existent/path")).toEqual([]);
  });

  it("skips node_modules", () => {
    const nmDir = path.join(tmpDir, "node_modules");
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, "dep.js"), 'island(Dep);', "utf8");

    expect(scanForIslands(tmpDir)).toEqual([]);
  });
});

describe("Nova Island Bundler: generateIslandEntry", () => {
  it("generates import and export for an island", () => {
    const entry = generateIslandEntry({
      name: "Counter",
      filePath: "/app/src/islands/counter.js",
      exportName: "Counter",
    });
    expect(entry).toContain('import { Counter }');
    expect(entry).toContain('export default Counter');
    expect(entry).toContain("/app/src/islands/counter.js");
  });

  it("normalizes backslashes in paths", () => {
    const entry = generateIslandEntry({
      name: "Toggle",
      filePath: "C:\\app\\src\\toggle.js",
      exportName: "Toggle",
    });
    expect(entry).toContain("C:/app/src/toggle.js");
    expect(entry).not.toContain("\\");
  });
});

describe("Nova Island Bundler: generateManifest", () => {
  it("generates manifest with lazy imports", () => {
    const manifest = generateManifest(
      [{ name: "Counter" }, { name: "Toggle" }],
      "/_nova/islands/"
    );
    expect(manifest).toContain("islandModules");
    expect(manifest).toContain('"Counter"');
    expect(manifest).toContain('"Toggle"');
    expect(manifest).toContain('import("/_nova/islands/Counter.js")');
    expect(manifest).toContain('import("/_nova/islands/Toggle.js")');
  });

  it("uses custom base URL", () => {
    const manifest = generateManifest(
      [{ name: "Foo" }],
      "/assets/islands/"
    );
    expect(manifest).toContain('import("/assets/islands/Foo.js")');
  });
});

describe("Nova Island Bundler: bundleIslands", () => {
  let tmpDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    outDir = path.join(tmpDir, "dist", "_nova", "islands");
  });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("returns empty result when no islands found", async () => {
    const result = await bundleIslands({ srcDir: tmpDir, outDir });
    expect(result.islands).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("generates manifest file", async () => {
    const islands = [{ name: "Counter", filePath: path.join(tmpDir, "counter.js"), exportName: "Counter" }];
    fs.writeFileSync(path.join(tmpDir, "counter.js"), 'class Counter {}; module.exports = Counter;', "utf8");

    const result = await bundleIslands({ srcDir: tmpDir, outDir, islands });
    expect(result.manifest).toBeTruthy();
    expect(fs.existsSync(result.manifest)).toBe(true);

    const manifestContent = fs.readFileSync(result.manifest, "utf8");
    expect(manifestContent).toContain("Counter");
  });

  it("creates output files for each island", async () => {
    const islands = [
      { name: "Counter", filePath: path.join(tmpDir, "counter.js"), exportName: "Counter" },
      { name: "Toggle", filePath: path.join(tmpDir, "toggle.js"), exportName: "Toggle" },
    ];
    fs.writeFileSync(path.join(tmpDir, "counter.js"), 'class Counter {}; module.exports = Counter;', "utf8");
    fs.writeFileSync(path.join(tmpDir, "toggle.js"), 'class Toggle {}; module.exports = Toggle;', "utf8");

    const result = await bundleIslands({ srcDir: tmpDir, outDir, islands });
    expect(result.islands.length).toBe(2);

    for (const island of result.islands) {
      expect(fs.existsSync(island.path)).toBe(true);
      expect(island.size).toBeGreaterThan(0);
    }
  });

  it("uses custom base URL in manifest", async () => {
    const islands = [{ name: "Widget", filePath: path.join(tmpDir, "widget.js"), exportName: "Widget" }];
    fs.writeFileSync(path.join(tmpDir, "widget.js"), 'class Widget {}', "utf8");

    const result = await bundleIslands({ srcDir: tmpDir, outDir, islands, baseUrl: "/static/islands/" });
    const manifestContent = fs.readFileSync(result.manifest, "utf8");
    expect(manifestContent).toContain("/static/islands/Widget.js");
  });
});
