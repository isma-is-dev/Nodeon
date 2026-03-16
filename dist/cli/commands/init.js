import { GREEN, DIM, RESET } from "../utils/colors.js";
const fs = require("fs");
const path = require("path");
const MAIN_TEMPLATE = `// Entry point
fn main() {
  print("Hello from Nodeon!")
}

main()
`;
function configTemplate(name) {
  return JSON.stringify({ name: name, version: "0.1.0", entry: "src/main.no", outDir: "dist", strict: false }, null, 2) + "\n";
}
const GITIGNORE_TEMPLATE = `node_modules/
dist/
.nodeon-cache/
`;
export function runInit(args) {
  const dir = process.cwd();
  const projectName = args[0] || path.basename(dir);
  const files = [["src/main.no", MAIN_TEMPLATE], ["nodeon.json", configTemplate(projectName)], [".gitignore", GITIGNORE_TEMPLATE]];
  let created = 0;
  let skipped = 0;
  for (const entry of files) {
    const rel = entry[0];
    const content = entry[1];
    const full = path.join(dir, rel);
    if (fs.existsSync(full)) {
      console.log("  " + DIM + "skip" + RESET + " " + rel + " (already exists)");
      skipped = skipped + 1;
      continue;
    }
    const parent = path.join(dir, rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(full, content, "utf8");
    console.log("  " + GREEN + "+" + RESET + " " + rel);
    created = created + 1;
  }
  console.log("\n" + GREEN + "project initialized" + RESET + " (" + created + " created, " + skipped + " skipped)");
  console.log(DIM + "run: nodeon run src/main.no" + RESET);
}