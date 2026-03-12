#!/usr/bin/env node
const path = require("path");
require("ts-node").register({
  project: path.resolve(__dirname, "../tsconfig.json"),
  transpileOnly: true,
});
require("tsconfig-paths").register({
  project: path.resolve(__dirname, "../tsconfig.json"),
});
const { main } = require("./nodeon");
main();
