import { basename, resolve, dirname } from "path";
import { watch, existsSync } from "fs";
import { compileFile } from "../utils/compile";
import { CYAN, RESET } from "../utils/colors";

export function runBuild(args: string[]) {
  const flags = args;
  const minify = flags.includes("-min") || flags.includes("--minify");
  const sourceMap = flags.includes("--map");
  const watchMode = flags.includes("-w") || flags.includes("--watch");
  const positional = flags.filter((f) => !f.startsWith("-"));

  if (positional.length === 0) {
    console.error("build requires an input .no file");
    process.exit(1);
  }

  const input = positional[0];
  const output = positional[1];

  // Initial build
  buildOnce(input, output, { minify, sourceMap });

  if (watchMode) {
    console.log(`${CYAN}👀${RESET} Watching ${basename(input)} for changes...`);
    watchFile(input, output, { minify, sourceMap });
  }
}

interface BuildOptions {
  minify: boolean;
  sourceMap: boolean;
}

function buildOnce(input: string, output: string | undefined, opts: BuildOptions): boolean {
  try {
    const { out } = compileFile(input, output, { minify: opts.minify, write: true, sourceMap: opts.sourceMap });
    const extra = [opts.minify ? "minified" : "", opts.sourceMap ? "+map" : ""].filter(Boolean).join(", ");
    console.log(`${CYAN}✓${RESET} ${basename(input)} → ${basename(out!)}${extra ? ` (${extra})` : ""}`);
    return true;
  } catch (err: any) {
    console.error(`${CYAN}✗${RESET} Build failed: ${err.message}`);
    return false;
  }
}

function watchFile(input: string, output: string | undefined, opts: BuildOptions): void {
  const absInput = resolve(input);
  const dir = dirname(absInput);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  if (!existsSync(absInput)) {
    console.error(`File not found: ${absInput}`);
    process.exit(1);
  }

  const watcher = watch(dir, (eventType, filename) => {
    if (!filename || !filename.endsWith(".no")) return;

    // Debounce rapid file changes (editors often trigger multiple events)
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`\n${CYAN}↻${RESET} Change detected: ${filename}`);
      buildOnce(input, output, opts);
    }, 150);
  });

  // Handle clean shutdown
  process.on("SIGINT", () => {
    watcher.close();
    console.log(`\n${CYAN}✓${RESET} Watch stopped.`);
    process.exit(0);
  });
}
