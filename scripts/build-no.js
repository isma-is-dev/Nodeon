#!/usr/bin/env node
// Thin wrapper to reuse the unified build script. This avoids duplicating
// bootstrap logic and prevents OOM by letting scripts/build.js decide the best
// compiler (self-hosted if available, bootstrap otherwise).

const path = require("path");
const childProcess = require("child_process");

const buildScript = path.resolve(__dirname, "./build.js");
const result = childProcess.spawnSync(process.execPath, ["--max-old-space-size=4096", buildScript, "--bootstrap"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
