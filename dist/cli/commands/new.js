import { GREEN, RED, DIM, YELLOW, CYAN, BOLD, RESET } from "../utils/colors.js";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
function ask(rl, question) {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
}
function askChoice(rl, question, options) {
  return new Promise(resolve => {
    console.log(question);
    let i = 0;
    while (i < options.length) {
      console.log("  " + CYAN + i + 1 + RESET + ") " + options[i].label + options[i].default ? " " + DIM + "(default)" + RESET : "");
      i = i + 1;
    }
    rl.question("  > ", answer => {
      const idx = parseInt(answer) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx].value);
      } else {
        const def = options.find(o => o.default);
        resolve(def ? def.value : options[0].value);
      }
    });
  });
}
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}
function generateNodeonJson(name, projectType, dbChoice) {
  const config = { name: name, version: "0.1.0", type: "workspace" };
  if (projectType === "fullstack" || projectType === "api") {
    config.workspace = { apps: ["apps/*"], packages: ["packages/*"] };
  }
  config.compiler = { strict: true, sourceMap: true, target: "node20" };
  if (projectType === "fullstack" || projectType === "api") {
    config.paths = { "@shared/*": ["packages/shared/src/*"], "@db/*": ["packages/db/src/*"] };
    if (dbChoice !== "none") {
      config.db = { driver: dbChoice, url: "${DATABASE_URL}", migrations: "packages/db/src/migrations", models: "packages/db/src/models", seeds: "packages/db/src/seeds" };
    }
    config.dev = { web: { port: 3000 }, api: { port: 3001 } };
  }
  config.test = { include: ["tests/**/*.test.no"] };
  return JSON.stringify(config, null, 2);
}
function generatePackageJson(name) {
  return JSON.stringify({ name: name, version: "0.1.0", private: true, workspaces: ["apps/*", "packages/*"] }, null, 2);
}
function generateGitignore() {
  return "node_modules/\ndist/\n.env\n.env.local\n.nodeon-cache/\n*.js.map\n";
}
function generateEnvExample(dbChoice) {
  let env = "NODE_ENV=development\nPORT=3000\nAPI_PORT=3001\n";
  if (dbChoice === "postgresql") {
    env = env + "\nDATABASE_URL=postgresql://nodeon:nodeon@localhost:5432/" + "myapp\nDB_NAME=myapp\nDB_USER=nodeon\nDB_PASSWORD=nodeon\n";
  }
  if (dbChoice === "sqlite") {
    env = env + "\nDATABASE_URL=./data/app.db\n";
  }
  env = env + "\nSESSION_SECRET=change-me-in-production\n";
  return env;
}
function generateReadme(name) {
  return "# " + name + "\n\nBuilt with [Nodeon](https://github.com/isma-is-dev/Nodeon) + Nova framework.\n\n## Getting Started\n\n```bash\nnodeon dev\n```\n\n## Commands\n\n| Command | Description |\n|---------|-------------|\n| `nodeon dev` | Start development server |\n| `nodeon build` | Production build |\n| `nodeon test` | Run tests |\n| `nodeon generate entity <name>` | Generate a new entity |\n| `nodeon generate page <path>` | Generate a new page |\n";
}
function scaffoldFullstack(projectDir, name, dbChoice) {
  writeFile(path.join(projectDir, "nodeon.json"), generateNodeonJson(name, "fullstack", dbChoice));
  writeFile(path.join(projectDir, "package.json"), generatePackageJson(name));
  writeFile(path.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path.join(projectDir, ".env.example"), generateEnvExample(dbChoice));
  writeFile(path.join(projectDir, "README.md"), generateReadme(name));
  writeFile(path.join(projectDir, "apps", "web", "src", "pages", "index.no"), "export fn load() {\n  return { title: \"Welcome to " + name + "\" }\n}\n\nexport fn template(data) {\n  return \"<h1>\" + data.title + \"</h1>\\n<p>Edit apps/web/src/pages/index.no to get started.</p>\"\n}\n");
  writeFile(path.join(projectDir, "apps", "web", "src", "pages", "about.no"), "export fn template() {\n  return \"<h1>About</h1>\\n<p>Built with Nodeon + Nova.</p>\"\n}\n");
  writeFile(path.join(projectDir, "apps", "web", "src", "components", "Header.no"), "export fn template(props) {\n  return \"<header><nav><a href=\\\"/\\\">Home</a> | <a href=\\\"/about\\\">About</a></nav></header>\"\n}\n");
  writeFile(path.join(projectDir, "apps", "web", "src", "layouts", "Main.no"), "import { Header } from \"../components/Header.no\"\n\nexport fn template(props) {\n  return \"<html><head><title>\" + (props.title ?? \"" + name + "\") + \"</title></head><body>\" + Header.template() + \"<main>\" + props.content + \"</main></body></html>\"\n}\n");
  writeFile(path.join(projectDir, "apps", "api", "src", "main.no"), "const http = require(\"http\")\n\nconst PORT = process.env.API_PORT ?? 3001\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { \"Content-Type\": \"application/json\" })\n  res.end(JSON.stringify({ status: \"ok\", message: \"" + name + " API running\" }))\n})\n\nserver.listen(PORT, () => {\n  print(\"API server running on http://localhost:\" + PORT)\n})\n");
  writeFile(path.join(projectDir, "apps", "api", "src", "routes", "health.no"), "export fn handler(req, res) {\n  return { status: \"ok\", timestamp: new Date().toISOString() }\n}\n");
  writeFile(path.join(projectDir, "packages", "shared", "src", "index.no"), "// Shared types and validation\nexport { AppConfig } from \"./types/config.no\"\n");
  writeFile(path.join(projectDir, "packages", "shared", "src", "types", "config.no"), "// Application configuration type\nexport const AppConfig = {\n  name: \"" + name + "\",\n  version: \"0.1.0\"\n}\n");
  if (dbChoice !== "none") {
    writeFile(path.join(projectDir, "packages", "db", "src", "index.no"), "// Database client\nconst dbUrl = process.env.DATABASE_URL ?? \"\"\n\nexport fn getDatabase() {\n  print(\"Database URL: \" + dbUrl)\n  return { url: dbUrl }\n}\n");
    writeFile(path.join(projectDir, "packages", "db", "src", "migrations", ".gitkeep"), "");
    writeFile(path.join(projectDir, "packages", "db", "src", "models", ".gitkeep"), "");
    writeFile(path.join(projectDir, "packages", "db", "src", "seeds", ".gitkeep"), "");
  }
  writeFile(path.join(projectDir, "tests", "example.test.no"), "import { describe, it, expect } from \"@nodeon/test\"\n\ndescribe(\"Example\", fn() {\n  it(\"should pass a basic assertion\", fn() {\n    expect(1 + 1).toBe(2)\n  })\n\n  it(\"should check strings\", fn() {\n    expect(\"hello\").toContain(\"ell\")\n  })\n\n  it(\"should check arrays\", fn() {\n    expect([1, 2, 3]).toHaveLength(3)\n  })\n})\n");
  if (dbChoice === "postgresql") {
    writeFile(path.join(projectDir, "infra", "docker", "docker-compose.yml"), "services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_DB: ${DB_NAME:-myapp}\n      POSTGRES_USER: ${DB_USER:-nodeon}\n      POSTGRES_PASSWORD: ${DB_PASSWORD:-nodeon}\n    ports:\n      - \"5432:5432\"\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n\nvolumes:\n  pgdata:\n");
  }
}
function scaffoldApi(projectDir, name, dbChoice) {
  writeFile(path.join(projectDir, "nodeon.json"), generateNodeonJson(name, "api", dbChoice));
  writeFile(path.join(projectDir, "package.json"), generatePackageJson(name));
  writeFile(path.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path.join(projectDir, ".env.example"), generateEnvExample(dbChoice));
  writeFile(path.join(projectDir, "README.md"), generateReadme(name));
  writeFile(path.join(projectDir, "src", "main.no"), "const http = require(\"http\")\n\nconst PORT = process.env.PORT ?? 3000\n\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { \"Content-Type\": \"application/json\" })\n  res.end(JSON.stringify({ status: \"ok\", message: \"" + name + " API running\" }))\n})\n\nserver.listen(PORT, () => {\n  print(\"Server running on http://localhost:\" + PORT)\n})\n");
  writeFile(path.join(projectDir, "tests", "example.test.no"), "import { describe, it, expect } from \"@nodeon/test\"\n\ndescribe(\"Example\", fn() {\n  it(\"should work\", fn() {\n    expect(true).toBeTruthy()\n  })\n})\n");
}
function scaffoldLibrary(projectDir, name) {
  const config = { name: name, version: "0.1.0", type: "library", compiler: { strict: true, sourceMap: true }, test: { include: ["tests/**/*.test.no"] } };
  writeFile(path.join(projectDir, "nodeon.json"), JSON.stringify(config, null, 2));
  writeFile(path.join(projectDir, "package.json"), JSON.stringify({ name: name, version: "0.1.0", main: "dist/index.js", files: ["dist/**/*"] }, null, 2));
  writeFile(path.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path.join(projectDir, "README.md"), "# " + name + "\n\nA Nodeon library.\n");
  writeFile(path.join(projectDir, "src", "index.no"), "// " + name + " — main entry point\n\nexport fn hello(name) {\n  return \"Hello, \" + name + \"!\"\n}\n");
  writeFile(path.join(projectDir, "tests", "index.test.no"), "import { describe, it, expect } from \"@nodeon/test\"\nimport { hello } from \"../src/index.no\"\n\ndescribe(\"" + name + "\", fn() {\n  it(\"greets by name\", fn() {\n    expect(hello(\"World\")).toBe(\"Hello, World!\")\n  })\n})\n");
}
function scaffoldCli(projectDir, name) {
  const config = { name: name, version: "0.1.0", type: "cli", entry: "src/main.no", compiler: { strict: true, sourceMap: true } };
  writeFile(path.join(projectDir, "nodeon.json"), JSON.stringify(config, null, 2));
  writeFile(path.join(projectDir, "package.json"), JSON.stringify({ name: name, version: "0.1.0", bin: { [name]: "./dist/main.js" }, files: ["dist/**/*"] }, null, 2));
  writeFile(path.join(projectDir, ".gitignore"), generateGitignore());
  writeFile(path.join(projectDir, "README.md"), "# " + name + "\n\nA CLI tool built with Nodeon.\n");
  writeFile(path.join(projectDir, "src", "main.no"), "const args = process.argv.slice(2)\nconst cmd = args[0]\n\nif !cmd || cmd == \"help\" {\n  print(\"Usage: " + name + " <command>\")\n  print(\"Commands: greet, version, help\")\n} else {\n  if cmd == \"version\" {\n    print(\"" + name + " v0.1.0\")\n  } else {\n    if cmd == \"greet\" {\n      const name = args[1] ?? \"World\"\n      print(\"Hello, \" + name + \"!\")\n    } else {\n      print(\"Unknown command: \" + cmd)\n      process.exit(1)\n    }\n  }\n}\n");
}
export async function runNew(args) {
  const nameArg = args.filter(a => !a.startsWith("-"))[0];
  const nonInteractive = args.includes("--yes") || args.includes("-y");
  console.log("");
  console.log(BOLD + "  Nodeon" + RESET + " — Create New Project");
  console.log("");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let name = nameArg;
  if (!name) {
    name = await ask(rl, "  Project name: ");
  }
  if (!name) {
    console.error(RED + "  Project name is required." + RESET);
    rl.close();
    process.exit(1);
  }
  if (!/^[a-zA-Z][\w-]*$/.test(name)) {
    console.error(RED + "  Invalid project name. Use letters, numbers, hyphens only." + RESET);
    rl.close();
    process.exit(1);
  }
  let projectType = "fullstack";
  let dbChoice = "postgresql";
  if (!nonInteractive) {
    console.log("");
    projectType = await askChoice(rl, "  What kind of project?", [{ label: "Full-stack web app (Nova)", value: "fullstack", default: true }, { label: "API only (backend)", value: "api" }, { label: "Library (npm package)", value: "library" }, { label: "CLI tool", value: "cli" }]);
    if (projectType === "fullstack" || projectType === "api") {
      console.log("");
      dbChoice = await askChoice(rl, "  Database?", [{ label: "PostgreSQL", value: "postgresql", default: true }, { label: "SQLite", value: "sqlite" }, { label: "None", value: "none" }]);
    }
  }
  rl.close();
  const projectDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(projectDir)) {
    console.error(RED + "  Directory '" + name + "' already exists." + RESET);
    process.exit(1);
  }
  console.log("");
  console.log(DIM + "  Creating project..." + RESET);
  if (projectType === "fullstack") {
    scaffoldFullstack(projectDir, name, dbChoice);
  } else if (projectType === "api") {
    scaffoldApi(projectDir, name, dbChoice);
  } else if (projectType === "library") {
    scaffoldLibrary(projectDir, name);
  } else {
    scaffoldCli(projectDir, name);
  }
  console.log("");
  console.log(GREEN + "  ✓" + RESET + " Project " + BOLD + name + RESET + " created!");
  console.log("");
  function listDir(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
    let idx = 0;
    while (idx < entries.length) {
      const entry = entries[idx];
      const isLast = idx === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";
      if (entry.isDirectory()) {
        console.log(DIM + "  " + prefix + connector + RESET + CYAN + entry.name + "/" + RESET);
        listDir(path.join(dir, entry.name), prefix + childPrefix);
      } else {
        console.log(DIM + "  " + prefix + connector + RESET + entry.name);
      }
      idx = idx + 1;
    }
  }
  listDir(projectDir, "");
  console.log("");
  console.log("  Next steps:");
  console.log("    " + CYAN + "cd " + name + RESET);
  if (projectType === "fullstack" || projectType === "api") {
    console.log("    " + CYAN + "nodeon dev" + RESET);
  } else {
    console.log("    " + CYAN + "nodeon run src/" + projectType === "cli" ? "main" : "index" + ".no" + RESET);
  }
  console.log("");
}