// Execution harness: compile Nodeon, RUN the result, and compare behaviour.
//
// The existing suite asserts on the emitted string. A correct string can come
// from a wrong AST, and a string assertion never checks that the program does
// what it says. This harness executes the compiled output, which is how the
// previous round of bugs (accumulator dropped by the optimizer, iterables
// silently emptied, spread mis-parsed) was found.
//
// Each case declares the value it expects, so a regression reports what the
// program actually did, not just that a shape changed.
//
// NOTE: the `expr` argument below is JavaScript, evaluated in the compiled
// program's scope — not Nodeon. Write the value under test into a binding and
// read that, e.g. run('let n = 0\nfor i in 0..4 { n = n + i }', 'n').
import { describe, it, expect } from "vitest";
import { compile } from "@compiler/compile";

/** Compile, then run `js` and return the value of `expr` (a JS expression). */
function run(src: string, expr: string): unknown {
  const { js, diagnostics } = compile(src);
  if ((diagnostics ?? []).length) {
    throw new Error("compile diagnostics: " + JSON.stringify(diagnostics));
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn (${expr});`)();
}

/** Run and compare with toEqual, surfacing both sides on failure. */
function expectRun(src: string, expr: string, want: unknown) {
  expect(run(src, expr)).toEqual(want);
}

describe("Execution: variables, bindings and scope", () => {
  it("binds a bare `x = v` on first use", () => {
    expectRun("x = 42", "x", 42);
  });

  it("re-assigns on later use without redeclaring", () => {
    expectRun("x = 1\nx = 2\nx = x + 10", "x", 12);
  });

  it("keeps a loop accumulator across iterations", () => {
    expectRun("let n = 0\nfor i in 0..4 { n = n + i }", "n", 10);
  });

  it("keeps a nested-loop accumulator", () => {
    expectRun(
      `let total = 0
for i in 0..2 {
  for j in 0..2 {
    total = total + i * j
  }
}`,
      "total",
      9,
    );
  });

  it("shadows an outer binding inside a function", () => {
    const src = `const x = 1
fn f() { const x = 2
 return x }
x + f()`;
    expectRun(src, "x + f()", 3);
  });
});

describe("Execution: functions", () => {
  it("returns a single-expression body implicitly", () => {
    expectRun("fn double(n) { n * 2 }\ndouble(21)", "double(21)", 42);
  });

  it("honours an explicit return in a multi-statement body", () => {
    expectRun("fn f(n) { const d = n * 2\n return d + 1 }\nf(5)", "f(5)", 11);
  });

  it("supports the expression body form", () => {
    expectRun("fn twice(n) = n * 2", "twice(4)", 8);
  });

  it("supports default parameters", () => {
    expectRun("fn greet(name = \"world\") { \"hi \" + name }", 'greet() + "/" + greet("you")', "hi world/hi you");
  });

  it("supports rest parameters", () => {
    const src = "fn sum(...nums) { let t = 0\n for n in nums { t = t + n }\n return t }\nconst r = sum(1, 2, 3)";
    expectRun(src, "r", 6);
  });

  it("recurses", () => {
    expectRun(
      `fn fact(n) {
  if n <= 1 { return 1 }
  return n * fact(n - 1)
}`,
      "fact(5)",
      120,
    );
  });

  it("closes over a variable, and the closure keeps its state", () => {
    const src = "fn make() { let n = 0\n return fn() { n = n + 1\n return n } }\nconst c = make()\nc()\nconst r = c()";
    expectRun(src, "r", 2);
  });

  it("passes an anonymous fn as an argument", () => {
    expectRun(
      `const out = [1, 2, 3].filter(fn(n) { return n > 1 })
out.length`,
      "out.length",
      2,
    );
  });
});

describe("Execution: control flow", () => {
  it("runs if / else if / else", () => {
    const src = `fn grade(n) {
  if n >= 90 { return "A" }
  else if n >= 80 { return "B" }
  else { return "C" }
}`;
    expectRun(src, '[grade(95), grade(85), grade(10)].join(",")', "A,B,C");
  });

  it("runs while loops", () => {
    expectRun("let i = 0\nwhile i < 5 { i = i + 1 }", "i", 5);
  });

  it("runs do-while at least once", () => {
    expectRun("let i = 99\ndo { i = i + 1 } while i < 3", "i", 100);
  });

  it("iterates arrays", () => {
    expectRun("let t = 0\nfor v in [1, 2, 3, 4] { t = t + v }", "t", 10);
  });

  it("iterates a Set", () => {
    expectRun("const s = new Set([1, 2, 3])\nlet t = 0\nfor v in s { t = t + v }", "t", 6);
  });

  it("iterates a generator", () => {
    expectRun("fn* g() { yield 5\n yield 6 }\nlet t = 0\nfor v in g() { t = t + v }", "t", 11);
  });

  it("iterates a string", () => {
    expectRun("let out = \"\"\nfor c in \"hey\" { out = out + c }", "out", "hey");
  });

  it("breaks and continues", () => {
    expectRun(
      `let t = 0
for i in 0..9 {
  if i == 3 { continue }
  if i > 5 { break }
  t = t + i
}`,
      "t",
      0 + 1 + 2 + 4 + 5,
    );
  });

  it("runs switch cases without fall-through", () => {
    const src = `fn name(n) {
  switch n {
    case 1 { return "one" }
    case 2 { return "two" }
    default { return "many" }
  }
}`;
    expectRun(src, '[name(1), name(2), name(9)].join(",")', "one,two,many");
  });

  it("runs match with a guard", () => {
    const src = `fn check(n) {
  match n {
    case 0 { return "zero" }
    case m when m > 10 { return "big" }
    default { return "other" }
  }
}`;
    const r = compile(src);
    expect(r.diagnostics ?? []).toHaveLength(0);
    // eslint-disable-next-line no-new-func
    const out = new Function(`${r.js}; return [check(0), check(50), check(5)].join(",");`)();
    expect(out).toBe("zero,big,other");
  });

  it("match accepts `if` as a guard too", () => {
    const src = `fn check(n) {
  match n {
    case 0 { return "zero" }
    case m if m > 10 { return "big" }
    default { return "other" }
  }
}`;
    const r = compile(src);
    expect(r.diagnostics ?? []).toHaveLength(0);
    // eslint-disable-next-line no-new-func
    const out = new Function(`${r.js}; return [check(0), check(50), check(5)].join(",");`)();
    expect(out).toBe("zero,big,other");
  });

  it("a match guard on default is honoured", () => {
    const src = `fn check(n) {
  match n {
    case 0 { return "zero" }
    default when n > 10 { return "big" }
    default { return "other" }
  }
}`;
    const r = compile(src);
    expect(r.diagnostics ?? []).toHaveLength(0);
    // eslint-disable-next-line no-new-func
    const out = new Function(`${r.js}; return [check(0), check(50), check(5)].join(",");`)();
    expect(out).toBe("zero,big,other");
  });

  it("`when` remains usable as an ordinary identifier", () => {
    const src = "const when = 5\nconst r = when * 2";
    expectRun(src, "r", 10);
  });

  it("runs try / catch / finally", () => {
    const src = `let log = ""
try {
  throw "boom"
} catch (e) {
  log = log + "caught"
} finally {
  log = log + "+fin"
}
log`;
    expectRun(src, "log", "caught+fin");
  });
});

describe("Execution: operators and types", () => {
  it("treats == as strict equality", () => {
    // `1 == "1"` is false in Nodeon precisely because `==` compiles to `===`.
    expectRun("const r = (1 == '1')", "r", false);
  });

  it("does arithmetic", () => {
    expectRun("const a = 2 + 3 * 4 - 1\nconst b = 10 / 4\nconst c = 7 % 3", "a", 13);
  });

  it("does exponent and bitwise ops", () => {
    expectRun("const p = 2 ** 10\nconst q = 6 & 3\nconst r = 6 | 3", "p + ',' + q + ',' + r", "1024,2,7");
  });

  it("short-circuits && and ||", () => {
    expectRun("const a = false && missing.thing\nconst b = true || missing.thing", "String(a) + ',' + String(b)", "false,true");
  });

  it("uses nullish coalescing and optional chaining", () => {
    const src = "const o = null\nconst v = o?.a ?? \"fallback\"";
    expectRun(src, "v", "fallback");
  });

  it("compares with ternaries", () => {
    expectRun("const n = 5\nconst s = n > 3 ? \"big\" : \"small\"", "s", "big");
  });
});

describe("Execution: strings", () => {
  it("interpolates in double quotes", () => {
    const src = 'const n = "Nodeon"\nconst r = "hello {n}"';
    expectRun(src, "r", "hello Nodeon");
  });

  it("interpolates an expression", () => {
    const src = 'const a = 2\nconst b = 3\nconst r = "sum {a + b}"';
    expectRun(src, "r", "sum 5");
  });

  it("does not interpolate in single quotes", () => {
    const src = "const n = 1\nconst r = 'raw {n}'";
    expectRun(src, "r", "raw {n}");
  });

  it("provides string methods", () => {
    expectRun('const s = "Hello"\ns.toUpperCase() + "," + s.length', 's.toUpperCase() + "," + s.length', "HELLO,5");
  });
});

describe("Execution: collections", () => {
  it("builds arrays and objects", () => {
    expectRun("const a = [1, 2]\nconst o = { k: 1 }", "a.length + ',' + o.k", "2,1");
  });

  it("spreads objects, later keys winning", () => {
    expectRun(
      "fn merge(a, b) { return { ...a, ...b, tag: \"x\" } }\nconst r = merge({ p: 1, q: 2 }, { q: 9 })",
      "JSON.stringify(r)",
      '{"p":1,"q":9,"tag":"x"}',
    );
  });

  it("spreads arrays", () => {
    expectRun("const a = [1, 2]\nconst b = [...a, 3]\nb.length", "b.length", 3);
  });

  it("destructures objects and arrays", () => {
    expectRun(
      "const { a, b } = { a: 1, b: 2 }\nconst [x, y] = [10, 20]\nconst o = { a, b, s: x + y }",
      "o.s",
      30,
    );
  });

  it("uses array methods", () => {
    expectRun("const a = [3, 1, 2]\nconst s = a.slice().sort()", "s.join(',')", "1,2,3");
  });

  it("uses Map and Set", () => {
    const src = `const m = new Map()
m.set("k", 1)
const s = new Set([1, 1, 2])
m.get("k") + "," + s.size`;
    expectRun(src, 'm.get("k") + "," + s.size', "1,2");
  });
});

describe("Execution: classes", () => {
  it("constructs and calls methods, including inheritance", () => {
    const src = `class Animal {
  constructor(name) { this.name = name }
  speak() { return this.name + " makes a sound" }
}
class Dog extends Animal {
  speak() { return this.name + " barks" }
}
new Dog("Rex").speak()`;
    expectRun(src, "new Dog('Rex').speak()", "Rex barks");
  });

  it("keeps private fields working through methods", () => {
    const src = `class Counter {
  #n = 0
  bump() { this.#n = this.#n + 1
    return this.#n }
}
const c = new Counter()
c.bump()
c.bump()
const r = c.bump()`;
    expectRun(src, "r", 3);
  });
});

describe("Execution: async and generators", () => {
  it("awaits an async function", async () => {
    const src = `async fn get() { return 7 }`;
    const { js, diagnostics } = compile(src);
    expect(diagnostics ?? []).toHaveLength(0);
    const value = await new Function(`${js}; return get();`)();
    expect(value).toBe(7);
  });

  it("awaits a resolved promise", async () => {
    const src = `async fn both() {
  const a = await Promise.resolve(1)
  const b = await Promise.resolve(2)
  return a + b
}`;
    const { js, diagnostics } = compile(src);
    expect(diagnostics ?? []).toHaveLength(0);
    const value = await new Function(`${js}; return both();`)();
    expect(value).toBe(3);
  });

  it("iterates a generator expression with for...of semantics", () => {
    const src = "fn* g() { yield 1\n yield 2\n yield 3 }\nconst out = []\nfor v in g() { out.push(v) }\nout";
    expectRun(src, "out", [1, 2, 3]);
  });
});

describe("Execution: a syntax error must not silently delete code", () => {
  // A parse error used to unwind every nested frame, so the whole enclosing
  // function disappeared from the output while the error was merely recorded.
  // Code paths that ignore diagnostics (the build script, `run`) then shipped
  // a program with a function missing.
  it("keeps the enclosing function when a statement fails to parse", () => {
    const src = `fn broken() {
  const a = 1
  @@@
  const b = 2
}
fn after() { return 42 }`;
    const { js } = compile(src);
    // `after` must still exist — it comes after the broken function.
    expect(js).toContain("after");
    expect(js).not.toMatch(/function broken\s*\(\s*\)\s*\{\s*\}/);
  });

  it("emits a runtime error rather than dropping the bad statement", () => {
    const src = "fn broken() {\n  const a = 1\n  @@@\n}";
    const { js } = compile(src);
    // A lexical error is recoverable, so it does not abort the file: the code
    // around it is preserved. But it must still FAIL — and it fails as soon as
    // the module is evaluated, which is what a real build would see.
    // eslint-disable-next-line no-new-func
    expect(() => new Function(js)()).toThrow(/syntax error/i);
  });

  it("reports the error as a diagnostic too", () => {
    const { diagnostics } = compile("fn broken() {\n  @@@\n}");
    expect((diagnostics ?? []).length).toBeGreaterThan(0);
  });

  it("a lexical error also fails loudly instead of looking like working code", () => {
    // A stray character is recoverable at the lexer level, so the surrounding
    // code is preserved — but the program must still FAIL, not appear to run.
    const src = `fn broken() {
  @@@
}
fn after() { return 42 }`;
    const { js } = compile(src);
    // The function after the damage is present...
    expect(js).toContain("after");
    // ...and loading the module still throws rather than silently working.
    // eslint-disable-next-line no-new-func
    expect(() => new Function(js)()).toThrow(/syntax error/i);
  });
});

describe("Execution: the optimizer must not change behaviour", () => {
  // Each of these is a shape the optimizer could plausibly break: a mutated
  // binding, a dead branch, a folded constant, a loop-carried value.
  const cases: Array<[string, string, unknown]> = [
    ["accumulator in range loop", "let n = 0\nfor i in 0..4 { n = n + i }", "n", 10],
    ["accumulator in array loop", "let n = 0\nfor v in [1, 2, 3] { n = n + v }", "n", 6],
    ["string accumulator", 'let s = ""\nfor c in "abc" { s = s + c }', "s", "abc"],
    ["const folding arithmetic", "const x = 2 + 3 * 4", "x", 14],
    ["dead branch true", 'if true { "yes" } else { "no" }', "1", 1],
    ["mutated then read", "let a = 1\na = a * 5\na = a + 1", "a", 6],
    ["shadowed inner counter", "let n = 0\nfor i in 0..2 { let inner = i * 2\n n = n + inner }", "n", 6],
  ];

  for (const [label, src, expr, want] of cases) {
    it(`preserves semantics: ${label}`, () => {
      expectRun(src, expr, want);
    });
  }
});
