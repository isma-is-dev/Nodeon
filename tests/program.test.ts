// The end-to-end check: a real Nodeon program, run through the JS backend and
// compared against a hand-written JavaScript reference.
//
// `examples/life.no` is Conway's Life on an 8×8 grid — a record holding a
// grid, a flat array of cells, nested loops, a conditional inside a loop and a
// call per cell. Feature-level tests all passed while this did not run at all:
// five defects surfaced only when a program had to work.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, compileToAST } from "@compiler/compile";
import { lowerToIR, lowerToWasmIR, emitIR, compileIRToWasmBinary } from "@compiler/ir";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "..", "examples", "life.no"), "utf8");

/**
 * Compile a Nodeon snippet to JavaScript through the IR and RUN it.
 *
 * The harness evaluates the result as JavaScript, so the expectation goes in as a
 * **value** and the answer comes back through a binding. Writing `run(src, "1 == '1'")`
 * would be nonsense — that would be JS syntax, not Nodeon.
 */
function runJs(body: string): any {
  const ast = compileToAST("fn f() {\n" + body + "\n}");
  expect(ast.errors ?? []).toHaveLength(0);
  const js = emitIR(lowerToIR(ast));
  return new Function(js + "\nreturn f();")();
}

// ── What `${n}` MEANS, as an executable fact rather than a preference ──────────────
//
// A number written into a string sat on the open-questions list for turns, and the
// answer is not a choice anyone has to make: **the JavaScript backend has been saying
// `String(n)` since the beginning**, this file's programs run on it, and the corpus is
// written against it. A template literal IS a `+` chain, so `` `x${n}` `` and `"x" + n`
// have to agree, and the only answer consistent with the rest of the language is the
// one this backend already gives.
//
// **These cases decide the format**, so they live where a change to them is a failing
// test rather than a slow change of meaning. `0.1 + 0.2` is here ON PURPOSE: it is the
// one number where a "prettier" format would differ, and it is a fact about the language
// now rather than an accident of a rounding choice.
describe("What a number in a string means", () => {
  it("a template and a `+` agree, which is what makes the answer forced", () => {
    expect(runJs("let age = 30\n return `Age invalid: ${age}`")).toBe("Age invalid: 30");
    expect(runJs("let age = 30\n return `Age invalid: ${age}`"))
      .toBe(runJs('let age = 30\n return "Age invalid: " + age'));
  });

  it("the format edges, where a rounding choice would have shown", () => {
    expect(runJs("let x = 0.5\n return `x is ${x}`")).toBe("x is 0.5");
    expect(runJs("let a = 0.1\n let b = 0.2\n return `sum ${a + b}`")).toBe("sum 0.30000000000000004");
    expect(runJs("let n = -5\n return `n is ${n}`")).toBe("n is -5");
    expect(runJs("let n = 0\n return `n is ${n}`")).toBe("n is 0");
    expect(runJs("let n = 1000000\n return `n is ${n}`")).toBe("n is 1000000");
    expect(runJs("let b = true\n return `b is ${b}`")).toBe("b is true");
    expect(runJs("let n = null\n return `n is ${n}`")).toBe("n is null");
  });

  // **The two backends AGREE** — the invariant the comment above this `describe` has been
  // claiming since the format was fixed, and never asserting.
  //
  // This test used to say the WebAssembly backend REFUSES a template with a hole, by name.
  // It stopped refusing when BUG-WASM-86 landed. It is written this way rather than deleted
  // because "it stopped refusing" is not a fact about the language: the fact is that a
  // number reaches the SAME text on both, and a test that only checked the refusal would
  // have passed on a backend that answered `"Age invalid: "`.
  //
  // The number is an INTEGER on purpose. `numToStr` answers the empty string for a
  // fraction — pinned under BUG-WASM-85 — because how many decimals is the one format
  // question this project has not answered, and THIS FILE is where the answer goes when
  // somebody decides it.
  it("the WASM backend renders the same text this backend does", () => {
    const source = 'fn f() { let age = 30\n return `Age invalid: ${age}` }';
    const ast = compileToAST(source);
    expect(ast.errors ?? []).toHaveLength(0);
    const mod = lowerToWasmIR(ast);
    expect(mod.diagnostics ?? []).toHaveLength(0);

    // Read out of the module's own memory, through its header — the same way every
    // other string read in this project goes through it.
    const bytes = compileIRToWasmBinary(mod);
    expect(WebAssembly.validate(bytes)).toBe(true);
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    const addr = (inst.exports.f as () => number)();
    const mem = inst.exports.memory as WebAssembly.Memory;
    const len = new DataView(mem.buffer).getUint32(addr, true);
    const text = new TextDecoder().decode(new Uint8Array(mem.buffer).subarray(addr + 8, addr + 8 + len));

    expect(text).toBe("Age invalid: 30");
    expect(text).toBe(runJs("let age = 30\n return `Age invalid: ${age}`"));
  });
});

/** The same computation, written by hand in JavaScript. */
function reference(ticks: number): number {
  const rows = 8, cols = 8;
  let cells = new Array(rows * cols).fill(0);
  cells[1 * cols + 2] = 1;
  cells[2 * cols + 3] = 1;
  cells[3 * cols + 1] = 1;
  cells[3 * cols + 2] = 1;
  cells[3 * cols + 3] = 1;
  let total = 0;
  for (let t = 0; t <= ticks - 1; t++) {
    const next = new Array(rows * cols).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let n = 0;
        if (r > 0) n += cells[(r - 1) * cols + c];
        if (r + 1 < rows) n += cells[(r + 1) * cols + c];
        if (c > 0) n += cells[r * cols + c - 1];
        if (c + 1 < cols) n += cells[r * cols + c + 1];
        next[r * cols + c] = (cells[r * cols + c] === 1 ? n === 2 || n === 3 : n === 3) ? 1 : 0;
      }
    }
    cells = next;
    total += cells.reduce((a, b) => a + b, 0);
  }
  return total;
}

describe("End to end: examples/life.no compiles and runs", () => {
  it("parses without diagnostics", () => {
    const { diagnostics } = compile(SOURCE);
    expect(diagnostics ?? []).toHaveLength(0);
  });

  it("matches a hand-written JavaScript reference on the whole program", () => {
    const { js, diagnostics } = compile(SOURCE);
    expect(diagnostics ?? []).toHaveLength(0);
    const api = new Function(`${js}\nreturn { simulate };`)() as { simulate: (n: number) => number };
    for (const ticks of [1, 2, 3, 4, 8]) {
      expect(api.simulate(ticks)).toBe(reference(ticks));
    }
  });

  it("compiles every function the program defines", () => {
    const { js } = compile(SOURCE);
    for (const name of [
      "makeGrid", "idxOf", "place", "countNeighbours",
      "step", "totalAlive", "seedGlider", "simulate",
    ]) {
      expect(js).toContain(name);
    }
  });
});

describe("End to end: the same program through the WASM backend", () => {
  // The JS backend alone proved nothing about WASM: every feature test passed
  // while this program did not even compile there. Six defects only appeared
  // once a real program had to run — an `if` whose arms ran at the wrong times,
  // a list literal shared by every evaluation, a `push` that dropped past the
  // first capacity, a record field that stored an address as a double, and the
  // record-ness of a value not travelling across a function boundary.
  it("produces a valid module", () => {
    const ast = compileToAST(SOURCE);
    expect(ast.errors ?? []).toHaveLength(0);
    const bytes = compileIRToWasmBinary(lowerToIR(ast));
    // The engine is the judge of validity, not our own encoder.
    expect(WebAssembly.validate(bytes)).toBe(true);
  });

  it("gives the same answers as the JS backend and the reference", () => {
    const { js, diagnostics } = compile(SOURCE);
    expect(diagnostics ?? []).toHaveLength(0);
    const api = new Function(`${js}\nreturn { simulate };`)() as { simulate: (n: number) => number };

    const ast = compileToAST(SOURCE);
    const inst = new WebAssembly.Instance(
      new WebAssembly.Module(compileIRToWasmBinary(lowerToIR(ast))),
      {},
    );
    const simulate = inst.exports.simulate as (n: number) => number;

    for (const ticks of [1, 2, 3, 4, 8, 16]) {
      expect({ ticks, wasm: simulate(ticks) }).toEqual({ ticks, wasm: reference(ticks) });
      expect({ ticks, js: api.simulate(ticks) }).toEqual({ ticks, js: reference(ticks) });
    }
  });
});
