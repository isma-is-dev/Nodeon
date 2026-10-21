#!/usr/bin/env node
// Verify all @nodeon/core and @nodeon/test .no files compile correctly
// Run: node scripts/test-stdlib.js

const fs = require("fs");
const path = require("path");
const compiler = require("../dist/nodeon-compiler.cjs");

let passed = 0;
let failed = 0;

function test(label, filePath, checks) {
  try {
    const source = fs.readFileSync(filePath, "utf8");
    const { js } = compiler.compile(source);
    for (const check of checks) {
      if (!js.includes(check)) {
        throw new Error(`Expected output to contain "${check}"`);
      }
    }
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${label}: ${err.message}`);
    failed++;
  }
}

const coreDir = path.resolve(__dirname, "../packages/core/src");
const testDir = path.resolve(__dirname, "../packages/test/src");

console.log("\n  @nodeon/core");
test("result.no", path.join(coreDir, "result.no"), [
  "function Ok(value)", "function Err(error)", "function isOk(",
  "function isErr(", "function unwrap(", "function unwrapOr(",
  "function mapResult(", "function flatMapResult(",
]);
test("option.no", path.join(coreDir, "option.no"), [
  "function Some(value)", "function None()", "function isSome(",
  "function isNone(", "function unwrapOption(", "function mapOption(",
]);
test("itertools.no", path.join(coreDir, "itertools.no"), [
  "function range(", "function enumerate(", "function zip(",
  "function chunk(", "function unique(", "function groupBy(",
  "function partition(", "function flatten(",
]);
test("utils.no", path.join(coreDir, "utils.no"), [
  "function pipe(", "function compose(", "function identity(",
  "function memoize(", "function deepClone(", "function deepEqual(",
  "function deepMerge(",
]);
test("assert.no", path.join(coreDir, "assert.no"), [
  "function assert(", "function assertEq(", "function assertNe(",
  "function assertThrows(",
]);
test("collections/hashmap.no", path.join(coreDir, "collections", "hashmap.no"), [
  "class HashMap", "remove(key)",
]);
test("collections/linked-list.no", path.join(coreDir, "collections", "linked-list.no"), [
  "class LinkedList",
]);
test("collections/stack.no", path.join(coreDir, "collections", "stack.no"), [
  "class Stack",
]);
test("collections/queue.no", path.join(coreDir, "collections", "queue.no"), [
  "class Queue",
]);
test("index.no (barrel)", path.join(coreDir, "index.no"), [
  "result.js", "option.js", "itertools.js", "utils.js", "assert.js",
]);

console.log("\n  @nodeon/test");
test("expect.no", path.join(testDir, "expect.no"), [
  "function expect(actual)", "matchers.toBe", "matchers.toEqual",
  "matchers.toThrow", "matchers.toContain", "matchers.toHaveLength",
  "matchers.toHaveProperty", "function buildMatchers(",
]);
test("runner.no", path.join(testDir, "runner.no"), [
  "function describe(", "function it(", "function beforeEach(",
  "function afterEach(", "async function run(",
]);
test("mock.no", path.join(testDir, "mock.no"), [
  "function spy(", "function stub(", "function mock(",
]);
test("index.no (barrel)", path.join(testDir, "index.no"), [
  "runner.js", "expect.js", "mock.js",
]);

// Tier 2 stdlib
const httpDir = path.resolve(__dirname, "../packages/http/src");
const stringDir = path.resolve(__dirname, "../packages/string/src");
const jsonDir = path.resolve(__dirname, "../packages/json/src");
const dbDir = path.resolve(__dirname, "../packages/db/src");

console.log("\n  @nodeon/http");
test("client.no", path.join(httpDir, "client.no"), [
  "function request(", "function get(", "function post(",
  "function put(", "function patch(", "function del(",
  "function createJsonResponse(", "function parseBody(",
]);
test("server.no", path.join(httpDir, "server.no"), [
  "class Router", "function createServer(",
]);

console.log("\n  @nodeon/string");
test("index.no", path.join(stringDir, "index.no"), [
  "function capitalize(", "function camelCase(", "function snakeCase(",
  "function kebabCase(", "function slugify(", "function truncate(",
  "function escapeHtml(", "function wordWrap(",
]);

console.log("\n  @nodeon/json");
test("index.no", path.join(jsonDir, "index.no"), [
  "function safeParse(", "function pretty(", "function get(",
  "function set(", "function validate(", "function diff(",
  "function pick(", "function omit(", "function flatten(",
]);

console.log("\n  @nodeon/db");
test("database.no", path.join(dbDir, "database.no"), [
  "class Database", "function connect(",
]);
test("query-builder.no", path.join(dbDir, "query-builder.no"), [
  "class QueryBuilder", "function table(",
]);
test("schema.no", path.join(dbDir, "schema.no"), [
  "class Schema",
]);
test("migrations.no", path.join(dbDir, "migrations.no"), [
  "class MigrationRunner",
]);

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
