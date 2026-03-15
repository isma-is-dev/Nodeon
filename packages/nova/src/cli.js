// Nova CLI
// Commands: dev, build, init

const path = require("path");

function main(args) {
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    console.log("\x1b[36m\x1b[1mnova v0.1.0\x1b[0m");
    return;
  }

  const projectDir = process.cwd();

  if (cmd === "dev") {
    const port = getFlag(args, "--port", "3000");
    const { createDevServer } = require("./server");
    createDevServer(projectDir, { port: parseInt(port, 10) });
    return;
  }

  if (cmd === "build") {
    const outDir = getFlag(args, "--out", "dist");
    const { buildSite } = require("./builder");
    buildSite(projectDir, { outDir: outDir });
    return;
  }

  if (cmd === "init") {
    const name = args[1] || "my-nova-app";
    initProject(name);
    return;
  }

  console.error("Unknown command: " + cmd);
  console.error("Run 'nova help' for usage.");
  process.exit(1);
}

function getFlag(args, flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultVal;
}

function initProject(name) {
  const fs = require("fs");
  const dir = path.resolve(process.cwd(), name);

  if (fs.existsSync(dir)) {
    console.error("Directory '" + name + "' already exists.");
    process.exit(1);
  }

  console.log("");
  console.log("  \x1b[36m\x1b[1m⚡ Creating Nova project: " + name + "\x1b[0m");
  console.log("");

  // Create directory structure
  fs.mkdirSync(path.join(dir, "src", "pages"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "components"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "layouts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "public"), { recursive: true });

  // Create index page
  fs.writeFileSync(path.join(dir, "src", "pages", "index.js"), [
    '// Home page',
    'class HomePage {',
    '  template() {',
    '    return `',
    '      <h1>Welcome to Nova ⚡</h1>',
    '      <p>Zero-JS by default. Full power when you need it.</p>',
    '      <nav>',
    '        <a href="/about">About</a>',
    '      </nav>',
    '    `;',
    '  }',
    '}',
    '',
    'module.exports = { default: HomePage };',
    '',
  ].join("\n"));

  // Create about page
  fs.writeFileSync(path.join(dir, "src", "pages", "about.js"), [
    '// About page',
    'class AboutPage {',
    '  template() {',
    '    return `',
    '      <h1>About</h1>',
    '      <p>This is a Nova project.</p>',
    '      <a href="/">← Home</a>',
    '    `;',
    '  }',
    '}',
    '',
    'module.exports = { default: AboutPage };',
    '',
  ].join("\n"));

  // Create package.json
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: name,
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "nova dev",
      build: "nova build",
    },
  }, null, 2) + "\n");

  console.log("  \x1b[32m✓\x1b[0m Created " + name + "/src/pages/index.js");
  console.log("  \x1b[32m✓\x1b[0m Created " + name + "/src/pages/about.js");
  console.log("  \x1b[32m✓\x1b[0m Created " + name + "/package.json");
  console.log("");
  console.log("  Next steps:");
  console.log("    cd " + name);
  console.log("    nova dev");
  console.log("");
}

function printHelp() {
  console.log([
    "",
    "  \x1b[36m\x1b[1mnova v0.1.0\x1b[0m — Zero-JS web framework for Nodeon",
    "",
    "  Usage: nova <command> [options]",
    "",
    "  Commands:",
    "    dev              Start development server",
    "    build            Build static site",
    "    init [name]      Create new Nova project",
    "    help             Show this help",
    "    version          Show version",
    "",
    "  Dev Options:",
    "    --port <number>  Port (default: 3000)",
    "",
    "  Build Options:",
    "    --out <dir>      Output directory (default: dist)",
    "",
  ].join("\n"));
}

module.exports = { main };
