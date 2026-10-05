// A program's files, linked into ONE WebAssembly module.
//
// A wasm module has no module system, so a program of thirty files becomes one
// module with every file's names made unique. This is the piece the corpus said
// the backend needed: 76 of its 79 imports point at another `.no` file.
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { linkProgram } from "@compiler/ir/ir-modules";
import { compileIRToWasmBinary } from "@compiler/ir";

/** Build a program from in-memory sources, keyed the way the linker keys them. */
function link(sources: Record<string, string>, entry = "/p/main.no") {
  const root = path.resolve("/p");
  const keyed: Record<string, string> = {};
  for (const [k, v] of Object.entries(sources)) keyed[path.resolve(root, k)] = v;
  const read = (file: string) => keyed[file];
  const resolvePath = (spec: string, from: string) => {
    const base = path.resolve(path.dirname(from), spec);
    const cand = base.endsWith(".no") ? base : `${base}.no`;
    return cand in keyed ? cand : null;
  };
  return linkProgram(path.resolve(root, entry), { read, resolvePath, root });
}

function run(linked: ReturnType<typeof link>, name: string, ...args: number[]): number {
  const bytes = compileIRToWasmBinary(linked.module);
  expect(WebAssembly.validate(bytes)).toBe(true);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  const fn = inst.exports[name] as (...a: number[]) => number;
  expect(typeof fn).toBe("function");
  return fn(...args);
}

describe("WASM backend: a program of several files", () => {
  it("calls a function imported from another file", () => {
    const linked = link({
      "lib.no": `export fn twice(v) {
  return v * 2
}
`,
      "main.no": `import { twice } from "./lib.no"

export fn run(n) {
  return twice(n)
}
`,
    });
    expect(linked.problems).toEqual([]);
    expect(run(linked, "main::run", 21)).toBe(42);
  });

  it("reads a constant exported by another file", () => {
    const linked = link({
      "lib.no": `export const K = 7
`,
      "main.no": `import { K } from "./lib.no"

export fn run() {
  return K
}
`,
    });
    expect(linked.problems).toEqual([]);
    expect(run(linked, "main::run")).toBe(7);
  });

  // Two files may both declare `compile`. The emitter resolves a callee by NAME
  // through one flat list, so a prefix is the only thing that keeps that list
  // unambiguous.
  it("keeps two files' same-named functions apart", () => {
    const linked = link({
      "a.no": `export fn n() {
  return 1
}
`,
      "b.no": `export fn n() {
  return 2
}
`,
      "main.no": `import { n as na } from "./a.no"
import { n as nb } from "./b.no"

export fn run() {
  return na() * 10 + nb()
}
`,
    });
    expect(linked.problems).toEqual([]);
    expect(run(linked, "main::run")).toBe(12);
  });

  // The lowering decides "direct" by whether the callee names a function of the
  // SAME file, and it runs before the imports are resolved — so the linker is
  // the first place that can say a call to an imported function is direct.
  it("resolves a chain of three files", () => {
    const linked = link({
      "lib.no": `export const K = 7
export fn twice(v) {
  return v * 2
}
`,
      "deep.no": `import { twice } from "./lib.no"
export fn quad(v) {
  return twice(twice(v))
}
`,
      "main.no": `import { K, twice } from "./lib.no"
import { quad } from "./deep.no"

export fn run(n) {
  return twice(n) + quad(n) + K
}
`,
    });
    expect(linked.problems).toEqual([]);
    expect(run(linked, "main::run", 10)).toBe(20 + 40 + 7);
  });

  it("reports an import nothing exports, rather than dropping the call", () => {
    const linked = link({
      "lib.no": `export fn twice(v) {
  return v * 2
}
`,
      "main.no": `import { missing } from "./lib.no"

export fn run() {
  return 1
}
`,
    });
    expect(linked.problems.join(" ")).toMatch(/missing/);
  });

  it("reports an import that is not a .no file", () => {
    const linked = link({
      "main.no": `import { thing } from "some-package"

export fn run() {
  return 1
}
`,
    });
    expect(linked.problems.join(" ")).toMatch(/some-package/);
  });

  // A file OWNS more than it declares: lowering a `.map` LIFTS a helper into the
  // module, and that helper needed the same prefix as a declared function. It did
  // not get one, and the two halves of the rename disagreed about it — the
  // FUNCTION was renamed, the CALL kept the bare name:
  //
  //     function:  main::__map_number_number
  //     call site: __map_number_number
  //
  // The emitter emitted the call as an index of -1 and a zero, and the module
  // still VALIDATED, so four corpus programs — including the one that formats the
  // compiler itself — were compiling to a module that answered 0. It only became
  // visible when the emitter's refusal for an undefined callee started binding.
  //
  // The test asserts the AGREEMENT, not a prefix: a test that only checked the
  // name would have passed with the call site still bare.
  it("gives a lifted list-method helper the same name as its call site", () => {
    const linked = link({
      "main.no": `export fn run() {
  const xs = [1, 2, 3]
  const ys = xs.map(fn(x) { return x + 1 })
  return ys[0]
}
`,
    });
    expect(linked.problems).toEqual([]);
    const names = (linked.module as any).functions.map((f: any) => f.name);
    const helper = names.find((n: string) => n.includes("__map"));
    expect(helper, `no map helper in ${JSON.stringify(names)}`).toBeTruthy();

    // Every call to it must name it the way it was named.
    for (const fn of (linked.module as any).functions) {
      for (const block of fn.blocks) {
        for (const inst of block.instructions) {
          if (inst.op !== "call") continue;
          const callee = inst.callee?.kind === "ref" ? inst.callee.name : "";
          if (callee.includes("__map")) {
            expect(callee, "call site kept the bare name").toBe(helper);
          }
        }
      }
    }
  });

  // The linked program works. What looked like a compiler defect for a turn was a
  // PROBE of mine calling `inst.exports.run` — and a linked module exports
  // `main::run`, because linking prefixes every name. Calling the wrong name gives
  // "fn is not a function", which reads exactly like an indirect call landing on a
  // table slot that is not a function, and it is not.
  //
  // So: the module is called by the name the linker actually published, which is
  // what a real host does.
  it("a linked program that uses map and filter runs", () => {
    const linked = link({
      "main.no": `export fn run(n) {
  const xs = [1, 2, 3, 4]
  const ys = xs.map(fn(x) { return x + n })
  const zs = ys.filter(fn(x) { return x > 3 })
  return zs[0]
}
`,
    });
    // xs = [1,2,3,4] → map +1 → [2,3,4,5] → filter >3 → [4,5] → zs[0] = 4
    expect(run(linked, "main::run", 1)).toBe(4);
  });

  // One list method through the linker, which is the shape the corpus's
  // `__map_number_number` refusals were: this is the test that fails if a lambda
  // stops being renamed, because the module validates either way.
  it("a linked program that uses one list method runs", () => {
    const linked = link({
      "main.no": `export fn run() {
  const xs = [1, 2, 3]
  const ys = xs.map(fn(x) { return x + 1 })
  return ys[0]
}
`,
    });
    expect(run(linked, "main::run")).toBe(2);
  });
});
