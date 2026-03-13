import { existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { GREEN, DIM, RESET } from "../utils/colors";

const MAIN_TEMPLATE = `// Entry point
fn main() {
  print("Hello from Nodeon!")
}

main()
`;

const CONFIG_TEMPLATE = (name: string) => JSON.stringify({
  name,
  version: "0.1.0",
  entry: "src/main.no",
  outDir: "dist",
  strict: false,
}, null, 2) + "\n";

const GITIGNORE_TEMPLATE = `node_modules/
dist/
.nodeon-cache/
`;

export function runInit(args: string[]) {
  const dir = process.cwd();
  const projectName = args[0] || basename(dir);

  const files: [string, string][] = [
    ["src/main.no", MAIN_TEMPLATE],
    ["nodeon.json", CONFIG_TEMPLATE(projectName)],
    [".gitignore", GITIGNORE_TEMPLATE],
  ];

  let created = 0;
  let skipped = 0;

  for (const [rel, content] of files) {
    const full = join(dir, rel);
    if (existsSync(full)) {
      console.log(`  ${DIM}skip${RESET} ${rel} (already exists)`);
      skipped++;
      continue;
    }
    // Ensure parent dir exists
    const parent = join(dir, rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    writeFileSync(full, content, "utf8");
    console.log(`  ${GREEN}+${RESET} ${rel}`);
    created++;
  }

  console.log(`\n${GREEN}project initialized${RESET} (${created} created, ${skipped} skipped)`);
  console.log(`${DIM}run: nodeon run src/main.no${RESET}`);
}
