#!/usr/bin/env node
// Bootstrap shim: registers path aliases from root tsconfig, then starts the server via ts-node.
const path = require("path");
const rootTsconfig = path.resolve(__dirname, "../../tsconfig.json");
require("ts-node").register({ project: rootTsconfig, transpileOnly: true });
require("tsconfig-paths").register({ project: rootTsconfig });
require("./src/server");
