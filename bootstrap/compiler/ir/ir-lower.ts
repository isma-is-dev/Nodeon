// ── AST → IR Lowering ───────────────────────────────────────────────
// Converts AST nodes into IR instructions within basic blocks.

import { Program, Statement, Expression } from "@ast/nodes";
import {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
  IRDeclare, IRAssign, IRBinOp, IRUnaryOp, IRCall, IRLiteral, IRExprStmt,
  IRReturn, IRBranch, IRJump,
} from "./ir-nodes";

let tempCounter = 0;
let lambdaCounter = 0;
// STRING-SEED-75: the names a CALLER knows are strings, per function. Module-level
// and NOT a local of `lowerToIR`, because `lowerFunction` — a different function —
// is what records into it. `lowerToIR` resets it, for the reason `tempCounter` is
// reset: both are facts about the module being built right now (BUG-WASM-40).
let stringSeeds: Record<string, string[]> = {};
// BUG-WASM-77. Whether the module is being lowered FOR THE WASM BACKEND.
//
// **The lowering is shared, and that is why a backend-specific refusal had nowhere to
// live.** A rule about what the WebAssembly emitter can type — a number written into a
// string is a formatting decision that was never made — was pushed as a `b.diagnostics`
// from the SHARED pass, and the JavaScript backend lost a capability it has always had:
//
//     "Age invalid: " + age      →  _t1 + age      ← JavaScript's own `+`, correct, and
//                                                          it ran for the whole project
//     …after the refusal         →  DIAG, refused, on BOTH backends
//
// **1001 tests stayed green**, because no test covered `"string" + <variable>` on the JS
// backend at all. A capability can be removed in silence when the only suite that exists
// measures the other one.
//
// So the boundary is named rather than assumed: a refusal that exists because the WASM
// emitter cannot type something says so, and the shared pass stops claiming it for
// everyone. Module-level and reset per module, beside `tempCounter` and `stringSeeds`.
let forWasm = false;

/**
 * The names the file BEING LOWERED imports, spelled the way the file spells them.
 *
 * BUG-WASM-82. An import is a declaration the LINKER resolves, and the linker runs
 * after every file has been lowered. So while `f(1)` is being lowered, a name that
 * came in through `import` is in no function table and in no slot, and the refusal
 * for an unbound callee named three functions that exist.
 *
 * Module-level because it is a fact about the FILE, not about one function — every
 * builder this lowering builds needs it. Reset per module, beside `tempCounter` and
 * `stringSeeds`.
 */
let importedNames: Set<string> = new Set();

/**
 * BUG-WASM-86. The functions of this file that return a STRING.
 *
 * The emitter carries this as `returnsString` and calls it "the mirror of
 * `returnsAddress`"; what it had no way to do was say it to the lowering, which is where the
 * decision to concatenate or refuse is made. Module-level and reset per module for the same
 * reason `importedNames` is.
 *
 * **One pass, and that is a real limit**: a function whose stringness is proved only by one
 * declared LATER is not seen, because when its body is lowered the answer is not there yet.
 * The emitter's `returnsString` is a fixed point over the module and covers that at emit
 * time; where the two disagree the lowering still refuses, by name.
 */
let stringFns: Set<string> = new Set();

/**
 * BUG-WASM-88. The EXPRESSIONS this lowering has proved to hold a string.
 *
 * `b.stringNames` records the answer against a NAME and `b.stringNames` is what a parent
 * `+` would need — except a parent asks about an AST NODE, and a node has no name. A
 * nested `+` is the one case where the node is the right place: it exists before its
 * parent is lowered, so a chain is proved from the inside out and each link hands its
 * answer to the next. Without this, `"a" + 1 + "b" + 2` answers its innermost link and
 * then refuses the next one about an expression it had just proved.
 *
 * A `WeakSet` and not a `Set`: identity-keyed, so it cannot go stale, and it does not keep
 * an AST alive once the module has been lowered.
 */
let provedStringNodes: WeakSet<object> = new WeakSet();

/**
 * BUG-WASM-90. The types this file DECLARES by name — an `interface` or a `type` — so a
 * parameter can be annotated with a name and still be read through.
 *
 * Module-level and reset per module, like the other three facts this lowering carries
 * (`importedNames`, `stringFns`, `provedStringNodes`), and for the same reason: the answer to
 * "what is this type" is a fact about the FILE, not about one function.
 */
let namedTypes = new Map<string, any>();

/**
 * BUG-WASM-90. The annotated FIELDS of the parameters of the function being lowered, as
 * `parameter name → field name → its type annotation`.
 *
 * Per function and reset by `lowerFunction`, because a name in one body says nothing about a
 * name in another — the same reason `slots` is per builder and the same lesson as
 * `stringFns` needing a pre-scan (BUG-WASM-89): the fact must be true at the moment it is
 * asked, and a stale one is worse than none.
 */
let paramFields = new Map<string, Map<string, any>>();

/**
 * The members of a type annotation, resolving a named one against the file's declarations.
 * `null` when the type is not an object this lowering can read — a union, a generic, an
 * array — and `null` means "no answer", never "yes".
 */
function membersOfType(ann: any): Map<string, any> | null {
  if (!ann || typeof ann !== "object") return null;
  if (ann.kind === "object" && Array.isArray(ann.properties)) {
    const m = new Map<string, any>();
    for (const p of ann.properties) m.set(String(p.name), p.type ?? p.valueType);
    return m;
  }
  if (ann.kind === "named") {
    const decl = namedTypes.get(ann.name);
    if (!decl) return null;
    if (Array.isArray(decl.properties)) {
      const m = new Map<string, any>();
      // **`p.name` is an Identifier NODE here** — `{ type: "Identifier", name: "sp" }` —
      // while an inline `{ sp: string }` carries a plain string. So this reads the name out
      // of the node when it is one, and the same mistake as BUG-WASM-89's
      // `ReturnStatement.value` is what made a named type resolve to an object with no fields,
      // which reads exactly like "the annotation says nothing".
      for (const p of decl.properties) {
        const n = p?.name?.name ?? p?.name;
        if (typeof n === "string") m.set(n, p.valueType);
      }
      return m;
    }
    if (decl.value) return membersOfType(decl.value);
  }
  return null;
}

/**
 * BUG-WASM-90. **Is `x.f` the annotated type `want`?** `x` has to be a PARAMETER of this
 * function and `f` has to be one of the fields its annotation declares — an unannotated
 * parameter, a field the annotation does not mention, and a computed member all answer false,
 * because the house contract is that a hole is refused by NAME and never guessed.
 */
function annotatedFieldIs(node: any, want: "string" | "number"): boolean {
  if (node?.type !== "MemberExpression" || node.computed) return false;
  if (node.object?.type !== "Identifier") return false;
  const fields = paramFields.get(node.object.name);
  if (!fields) return false;
  const t = fields.get(String(node.property?.name));
  if (!t || t.kind !== "named") return false;
  return t.name === want;
}




/**
 * The names a lambda body reads that it neither declares nor takes as a
 * parameter — the ones a closure would have to carry.
 *
 * A name the body declares is its own, and a name that is a function in the
 * module is a call rather than a capture, so both are excluded. A nested
 * lambda's names are not this lambda's free variables, so the walk stops at one.
 */
function freeVariablesOf(lambda: any, moduleFunctions: Set<string>): Set<string> {
  const bound = new Set<string>((lambda.params ?? []).map((p: any) => p.name ?? p.value));
  const declared = new Set<string>();
  const body = lambda.body ?? [];

  const collectDeclarations = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(collectDeclarations); return; }
    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations ?? []) {
        const n = d.id?.name ?? d.id?.value;
        if (n) declared.add(n);
      }
    }
    // A nested `fn` BINDS its name in the body it is written in. Visiting it as
    // a reference made it look like a free variable of the enclosing scope, so
    // `fn outer { fn inner { ... k ... } }` gave `outer` the capture `["inner"]`
    // instead of `["k"]`:
    //
    //     captures: {"outer":["inner"], "inner":["k"]}
    //
    // `k` was then never handed to `outer`, and the call to `inner` inside it read
    // a name `outer` does not have — the emitter fell back to a zero and the
    // answer came out WRONG rather than refused. Same treatment a
    // `VariableDeclaration` already gets, and the same reason.
    if (node.type === "FunctionDeclaration") {
      const n = node.name?.name;
      if (n) declared.add(n);
    }
    for (const value of Object.values(node)) collectDeclarations(value);
  };
  collectDeclarations(body);

  const free = new Set<string>();
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    // BUG-WASM-60: an arrow is a scope boundary for the same reason a `fn` is.
    // Enabling arrows without this would have put a nested `x => …` back in the
    // list of names the enclosing lambda captures.
    if (
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration" ||
      node.type === "ArrowFunction"
    ) return;
    if (node.type === "Identifier" && node.name) {
      if (!bound.has(node.name) && !declared.has(node.name) && !moduleFunctions.has(node.name)) {
        free.add(node.name);
      }
    }
    // `o.v` NAMES a field; the property is not a variable the body reads, and
    // counting it reported every field access as a capture.
    if (node.type === "MemberExpression" && !node.computed) {
      visit(node.object);
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(body);
  return free;
}
/**
 * The names a file IMPORTS, as that file spells them.
 *
 * **Read from the linker's own shapes** (`ir-modules.ts`, the import loop):
 * `namedImports[].alias ?? .name` and `defaultImport`. Two lists of the same fact
 * drift, and this one exists only to stop a refusal from firing on a working
 * program — so it is read, not restated.
 *
 * `namespaceImport` is deliberately absent. The linker already reports
 * `"import * as ns" todavía no está soportado`, and a name here would not resolve to
 * anything anyway; adding it would move that message without answering it.
 *
 * An import that names something the other file does not publish is NOT this
 * function's hole to find: the linker validates every import against the file's own
 * exports, and says so by name. A name in this set means "the linker will decide",
 * not "it is fine".
 */
function importedLocalNamesOf(ast: Program): Set<string> {
  const names = new Set<string>();
  for (const stmt of (ast?.body ?? []) as any[]) {
    if (stmt?.type !== "ImportDeclaration") continue;
    for (const spec of stmt.namedImports ?? []) {
      const local = spec.alias ?? spec.name;
      if (local) names.add(String(local));
    }
    if (stmt.defaultImport) names.add(String(stmt.defaultImport));
  }
  return names;
}

/**
 * BUG-WASM-89. Which of this file's functions return a STRING — answered BEFORE anything
 * is lowered.
 *
 * `lowerToIR` walks a file's statements in source order, so a function that calls a helper
 * declared three lines below it is lowered before the answer exists, and the `+` is refused
 * with "the decision has not been taken" about a value the file itself defines. In the
 * corpus that is the COMMON case, not an edge case: `pad` is used 112 times and declared
 * after its callers.
 *
 * **A fixed point over the file's own functions, and it must answer no as readily as
 * yes** — or it removes the refusals it was built to complete. A function returning a
 * number literal returns a number, and a function with no return returns nothing. Both
 * have tests next to the ones that go green.
 *
 * Deliberately narrow: a string literal, a template, a call to a name already known, and a
 * `+` of two of those, gathered from every `return` in the body. Not a parameter, not a
 * field, not a `let` bound to one — those are facts about values, and this is a fact about
 * source.
 */
function prescanStringFns(ast: Program, known: Set<string>): void {
  const decls: { name: string; body: any }[] = [];
  for (const stmt of (ast?.body ?? []) as any[]) {
    if (stmt?.type === "FunctionDeclaration" && stmt.name) {
      decls.push({ name: String((stmt.name as any).name ?? stmt.name), body: stmt.body });
    }
  }
  if (decls.length === 0) return;


  /** Does this EXPRESSION produce a text, given what is already known? */
  const isText = (e: any): boolean => {
    if (!e || typeof e !== "object") return false;
    if (e.type === "Literal") {
      const t = e.literalType ?? (typeof e.value);
      return t === "string" || t === "char";
    }
    if (e.type === "TemplateLiteral") return true;
    if (e.type === "CallExpression" && e.callee?.type === "Identifier") return known.has(e.callee.name);
    if (e.type === "BinaryExpression" && e.operator === "+") return isText(e.left) && isText(e.right);
    return false;
  };

  let grew = true;
  let guard = decls.length + 2;
  while (grew && guard-- > 0) {
    grew = false;
    for (const d of decls) {
      if (known.has(d.name)) continue;
      // A `return` ANYWHERE in the body is a return, because a `+` that only sometimes
      // concatenates is still a function that gives a text back on the other path — and
      // the emitter already insists on every path agreeing (BUG-WASM-84).
      let found = false;
      const look = (n: any): void => {
        if (found || !n || typeof n !== "object") return;
        if (n.type === "ReturnStatement") {
          // BUG-WASM-89. **The payload is `value`.** This asked `n.argument`, which does not
          // exist, so `isText(undefined)` was false for every return in the file and the
          // fixed point never grew. `Object.keys(n)` in a diagnostic found it: a dump of the
          // object's own shape is the cheapest way to learn a field you assumed, and it is
          // why the instrument went next to the mechanism and not next to a theory of it.
          // `lowerStatement`'s own `return` case reads `stmt.value`, which is why only the
          // new code was ever wrong about this.
          if (n.value && isText(n.value)) { found = true; return; }
          return;
        }

        for (const k of Object.keys(n)) {
          const v = n[k];
          if (Array.isArray(v)) v.forEach(look);
          else look(v);
        }
      };
      look(d.body);

      if (found) {
        known.add(d.name);
        grew = true;
      }

    }
  }
}

function freshTemp(): string {
  return `_t${tempCounter++}`;
}

export function lowerToIR(ast: Program, opts?: { wasm?: boolean }): IRModule {
  tempCounter = 0;
  stringSeeds = {};
  forWasm = opts?.wasm === true;
  importedNames = importedLocalNamesOf(ast);
  stringFns = new Set();
  provedStringNodes = new WeakSet();
  // BUG-WASM-89. Before the first statement is lowered, so the first `+` already has the
  // whole file's answer instead of the part of it that happened to come first.
  prescanStringFns(ast, stringFns);
  // BUG-WASM-90. The types this file declares, so `fn f(x: Spec)` can be read through.
  namedTypes = new Map();
  for (const stmt of (ast?.body ?? []) as any[]) {
    if (stmt?.type === "InterfaceDeclaration" && stmt.name) {
      // Same shape note as above: a declaration's `name` is a node, and `String(node)` would
      // file the type under "[object Object]" — so the name is read out when there is one.
      const n = (stmt.name as any)?.name ?? stmt.name;
      if (typeof n === "string") namedTypes.set(n, stmt);
    } else if (stmt?.type === "TypeAliasDeclaration" && stmt.name) {
      const n = (stmt.name as any)?.name ?? stmt.name;
      if (typeof n === "string") namedTypes.set(n, stmt);
    }
  }



  const globals: IRInstruction[] = [];
  const functions: IRFunction[] = [];
  // Merged from every BlockBuilder so the emitter can tell an f64 slot from an
  // i32 address without guessing.
  const arrayKinds: Record<string, "number" | "address"> = {};
  const loopVarKinds: Record<string, "number" | "address"> = {};
  const lifted: IRFunction[] = [];
  const diagnostics: string[] = [];
  const captures: Record<string, string[]> = {};
  const helpers: Set<string> = new Set();
  // One registry for the WHOLE module, for the reason on the field.
  const classes = new Map<string, LoweredClass>();

  // The names every function may be referred to by. Collected BEFORE anything is
  // lowered, because a function used as a VALUE has to be recognised in
  // expression position — and that is only decidable by knowing the whole set of
  // declarations, not the ones seen so far. A first pass over the body was the
  // alternative and it silently mistook a call for a value when the declaration
  // came later in the file.
  /** What a top-level statement really declares, looking through an `export`. */
  const innerOf = (stmt: any): any =>
    stmt?.type === "ExportDeclaration" && stmt.declaration ? stmt.declaration : stmt;

  const functionNames = new Set<string>();
  for (const stmt of ast.body) {
    const inner = innerOf(stmt);
    if (inner?.type === "FunctionDeclaration" && inner.name?.name) {
      functionNames.add(inner.name.name);
    }
  }

  for (const stmt of ast.body) {
    // `export fn f() { … }` is an ExportDeclaration WRAPPING a function, and
    // `export fn` is how the whole corpus declares one. Looking only for a
    // top-level FunctionDeclaration meant every exported function was
    // SKIPPED — the module compiled, validated, and contained nothing.
    const inner = innerOf(stmt);
    if (inner?.type === "FunctionDeclaration") {
      // The registry goes in LAST, past the two class-binding parameters.
      // Without it every function body got a fresh EMPTY map, and `new C(…)`
      // reported that C — declared two statements above — was not a class of
      // this module. The `extends` case had already been fixed by the shared
      // map; this is the same fact reaching a second consumer.
      functions.push(
        lowerFunction(
          inner,
          arrayKinds,
          loopVarKinds,
          functionNames,
          lifted,
          diagnostics,
          {},
          captures,
          helpers,
          false,
          null,
          null,
          classes,
        ),
      );
      functionNames.add(inner.name.name);
      continue;
    }
    if (inner === stmt && stmt.type === "ImportDeclaration") continue;
    if (inner === stmt && stmt.type === "ExportDeclaration" && !stmt.declaration) {
      // `export { x }` / `export default …` name what is already there.
      if (stmt.isDefault && stmt.declaration === undefined) continue;
      if (stmt.namedExports?.length) continue;
      continue;
    }
    // Top-level statements are globals: they lower into a single flat list
    // of instructions, not into a basic block.
    const b = new BlockBuilder(
      functionNames,
      lifted,
      diagnostics,
      arrayKinds,
      loopVarKinds,
      captures,
      helpers,
      classes,
    );
    lowerStatement(inner, b);
    Object.assign(arrayKinds, Object.fromEntries(b.arrays));
    Object.assign(loopVarKinds, Object.fromEntries(b.loopVars));
    globals.push(...b.blocks[0].instructions);
  }

  // A lambda inside a lambda keeps lifting while the lowering runs, so the list
  // is drained until it stops growing. They go at the END, after every declared
  // function, so a lifted one can never shift the index of a real one.
  for (let i = 0; i < lifted.length; i++) {
    functions.push(lifted[i]);
    functionNames.add(lifted[i].name);
  }

  // A module-level constant is hoisted by the CONSUMER that needs a slot for
  // it — the WebAssembly backend, which has nowhere to put a module-level
  // binding. It is NOT done here: `lowerToIR` also feeds a back-to-JS emitter,
  // and hoisting rewrites `const x = 1` into a function called `__const_x`, which
  // is a different program for that consumer. An IR is a contract with every
  // consumer, not a private scratchpad of one of them.
  return { type: "IRModule", functions, globals, arrayKinds, loopVarKinds, stringSeeds, diagnostics, captures };
}

/**
 * Turn a module-level `const` into a function, and call it where it is named.
 *
 * A top-level binding is a MODULE-LEVEL slot, not a local, and the emitter had
 * nowhere to put it: `mod.globals` is a flat instruction list that nothing
 * executes, so `const K = 7` read back as its default and `run()` answered 0.
 * A function is a slot that already exists — it has a name, a signature and a
 * place in the module — and it works ACROSS files, which is what the program
 * linker needs and what a per-file list of globals can never do.
 *
 * Only a `const` whose value is a LITERAL is hoisted. A `let`, or a `const`
 * initialised by a call, stays put and is reported: hoisting it would move when
 * it runs, and a module-level binding that runs at its first use is not the same
 * binding.
 */
export function hoistModuleConstants(mod: IRModule, functionNames: Set<string>): void {
  // One pass over the module's top-level instructions. A `const` is recognised by
  // the `literal` immediately before it, so the literal's TARGET is remembered
  // and the `declare` that consumes it is dropped along with it.
  const getters = new Map<string, unknown>();
  const literalTargets = new Map<string, unknown>();
  /** Module-level constants that were left in a list nothing executes. */
  const unhoisted: string[] = [];
  /** Which instruction produced each temp in the globals, so a constant can be
   *  recognised as bound to a PURE value rather than to a call. */
  const tempProducers = new Map<string, string>();
  // A pure getter was tried and reverted: see BUG-WASM-45.
  for (const inst of mod.globals) {
    const t = (inst as any).target;
    if (t) tempProducers.set(t, inst.op);
  }
  const kept: IRInstruction[] = [];

  for (const inst of mod.globals) {
    if (inst.op === "literal") {
      const target = (inst as any).target;
      literalTargets.set(target, (inst as any).value);
      kept.push(inst);
      continue;
    }
    if (inst.op === "declare" && (inst as any).kind === "const") {
      const value = (inst as any).value;
      if (value?.kind === "temp" && literalTargets.has(value.id)) {
        getters.set((inst as any).name, literalTargets.get(value.id));
        continue;
      }
      // **A module-level `const` that is not a LITERAL is not hoisted, and it was
      // then read as zero with nothing reported.** Measured:
      //
      //     const C = { Red: 0, Green: 1, Blue: 2 }     C.Blue  → 0
      //     const K = new Set(["fn", "if", …])         K.has(…) → a null page
      //
      // The declaration stays in `mod.globals`, which this function calls *a flat
      // instruction list that nothing executes* — so the binding is never
      // materialised, and every read of it answers 0. `src/language/symbols.no` is one
      // of these and was counted VALID, which made the gate count a program exporting
      // a Set whose contents are zero.
      //
      // **It is named now, which costs a green program and buys the truth.** Hoisting
      // a PURE value is the real fix and it is open — see BUG-WASM-45. Until then this
      // is a refusal rather than a module that answers 0.
      // **Only a PURE value, and the narrowing is the measurement.** Reported as
      // `temp` or `ref` this caught nineteen programs, and twelve of them were
      // `const fs = require("fs")` — a HOST IMPORT, which the emitter already
      // refuses with a better name ("no hay host al que preguntar"). Pointing at a host
      // import as "a constant that is not a literal" sends a reader to the wrong
      // place.
      //
      // What is left is a constant bound to something HOISTABLE — a record, a list, a
      // Set built from a list. Those are the four language files that were counted
      // VALID while exporting a collection that reads as 0:
      //
      //     keywords.no   KEYWORDS          new Set([…])
      //     symbols.no    DELIMITERS        new Set([…])
      //     lexer.no      CONTROL_KEYWORDS
      //     formatter.no  PRECEDENCE
      //
      // A CALL is not hoistable and not this either: hoisting it would move when it
      // runs, which is a different program.
      const producer = value?.kind === "temp" ? (tempProducers.get(value.id) as string | undefined) : undefined;
      if (producer === "objlit" || producer === "arraylit") {
        // **Named rather than hoisted, and the reason is measured.** A getter whose
        // body is the construction was written and it is CORRECT — the body is a
        // byte-for-byte copy of the globals that produced the value: the `arraylit`,
        // then a literal and a `storeelement` per member, then the return.
        //
        //     new Set(["a"])        has("a")  → 1   ✓
        //     new Set(["a","b"])    has("b")  → 0   ✗
        //     new Set(["a","b"])    has("a")  → 0   ✗
        //
        // With a second `storeelement` NEITHER element is findable, and the body is
        // identical in shape. `KEYWORDS` has about forty members.
        //
        // The open question, written rather than guessed: why does a `storeelement`
        // work at index 0 and not at index 1 inside a lifted function whose body is a
        // correct copy of the instructions it replaced. See BUG-WASM-45.
        unhoisted.push(String((inst as any).name));
      }
    }
    kept.push(inst);
  }
  // Reported whatever else the module does. The early return below is for a module
  // with nothing to hoist at all, and it must not swallow these.
  for (const name of unhoisted) {
    mod.diagnostics.push(
      `la constante de módulo "${name}" no es un literal y por tanto no se eleva: ` +
        `se leería como 0. Elevar un valor puro es lo que falta; ver buglist.md.`,
    );
  }
  if (getters.size === 0) return;

  // Drop the literals that fed a hoisted constant, and the `exprstmt`s the
  // lowering emits for their declarations.
  const hoisted = new Set<string>();
  for (const [name] of getters) hoisted.add(name);
  mod.globals = kept.filter((inst) => {
    // A pure getter is not built, so nothing is dropped for one.
    if (inst.op === "literal") {
      for (const value of getters.values()) if ((inst as any).value === value) return false;
    }
    if (inst.op === "exprstmt") {
      const v = (inst as any).value;
      if (v?.kind === "ref" && hoisted.has(v.name)) return false;
    }
    return true;
  });

  for (const [name, value] of getters) {
    const t = freshTemp();
    const instructions = [{ op: "literal", target: t, value, kind: typeof value } as any];
    const returned = { kind: "temp", id: t };
    mod.functions.push({
      type: "IRFunction",
      name: `__const_${name}`,
      params: [],
      blocks: [
        {
          type: "IRBlock",
          label: "entry",
          instructions,
          terminator: { op: "return", value: returned } as any,
        },
      ],
    });
    functionNames.add(`__const_${name}`);
  }

  // Every mention of the name becomes a call, wherever it appears.
  //
  // The TERMINATOR counts: `fn a() { return K }` keeps its `K` there and not in
  // the instruction list, so rewriting only the instructions left the one
  // reference that mattered.
  for (const fn of mod.functions) {
    if (fn.name.startsWith("__const_")) continue;
    for (const block of fn.blocks) {
      const rewritten: IRInstruction[] = [];
      const emitCallFor = (host: any, name: string) => {
        if (!getters.has(name)) return;
        const t = freshTemp();
        rewritten.push({
          op: "call",
          target: t,
          callee: { kind: "ref", name: `__const_${name}` },
          args: [],
        } as any);
        replaceRefs(host, name, { kind: "temp", id: t });
      };
      for (const inst of block.instructions) {
        for (const name of namesReferenced(inst)) emitCallFor(inst, name);
        rewritten.push(inst);
      }
      if (block.terminator) {
        for (const name of namesReferenced(block.terminator as any)) {
          emitCallFor(block.terminator, name);
        }
      }
      block.instructions = rewritten;
    }
  }
}

/** The distinct `ref` names an instruction mentions, terminator excluded. */
function namesReferenced(inst: IRInstruction): string[] {
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (seen.has(node)) return;
    seen.add(node);
    if (node.kind === "ref" && node.name) names.add(node.name);
    for (const value of Object.values(node)) walk(value);
  };
  walk(inst);
  return [...names];
}

/** Replace, in place, every `{kind:"ref", name}` with `replacement`. */
function replaceRefs(node: any, name: string, replacement: IRValue): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n) => replaceRefs(n, name, replacement)); return; }
  if (node.kind === "ref" && node.name === name) {
    node.kind = replacement.kind;
    if (replacement.kind === "temp") {
      node.id = replacement.id;
      delete node.name;
    } else {
      node.name = replacement.name;
      delete node.id;
    }
    return;
  }
  for (const value of Object.values(node)) replaceRefs(value, name, replacement);
}

// ── Block Builder ───────────────────────────────────────────────────
//
// The lowering needs a mutable "current block" that a `branch`/`loop` moves.
// It used to be threaded through optional parameters, and `lowerFunction`
// passed the *entry* block for every statement — so anything after an `if`
// was appended to the entry block and the `if` arms were emitted
// unconditionally. Control flow was structurally wrong, not merely missing.

class BlockBuilder {
  blocks: IRBlock[] = [];
  /**
   * BUG-WASM-69. The names this builder has seen hold a STRING, so a method name that
   * is in two tables can be told apart by the receiver.
   *
   * **The list side of this has existed all along** — `arrays` says a name is a list —
   * and the string side did not, which is why a `.indexOf` on a string ran the LIST
   * helper over a string block and answered -1 with no diagnostic, and why adding
   * `indexOf` to the string table then broke six list tests by taking the name away
   * from them. Both are the same defect: the dispatch is by NAME and the receiver's
   * KIND decides nothing.
   *
   * Only a name bound to a string **literal** lands here, on purpose. The rule is
   * "positive evidence", so a receiver the lowering cannot prove is a string keeps
   * today's behaviour — a list returned by a call and then indexed is not broken by
   * this, and would have been had the rule been "unless it is a list".
   */
  stringNames = new Set<string>();
  current: IRBlock;
  /**
   * How each array's elements must be read: "number" (an f64 slot) or
   * "address" (an i32 slot holding a record). The lowering is the only place
   * that knows, and reading an f64 slot as an i32 turns every value into its
   * raw bit pattern.
   */
  arrays = new Map<string, "number" | "address">();

  /** Names bound as `for` variables, and the kind of value they receive. */
  loopVars = new Map<string, "number" | "address">();

  /**
   * For each BINDING, the class whose instance it holds.
   *
   * The same shape as `arrays` and for the same reason: a method call is
   * resolved from the class of its receiver, and a class is only knowable from
   * the binding that received the `new`. `let c = new Counter()` says it once;
   * every later `c.add(…)` reads it.
   *
   * **Deliberately NOT the only way to know a class.** `this.m(…)` resolves
   * lexically and never consults this, and a receiver that is neither — a call
   * through a returned value, say — is still unresolved and is named by the
   * emitter. This map is what widens the set of programs that work, not what
   * makes the set correct.
   */
  classOf = new Map<string, string>();
  /**
   * Every function name in the module, so an identifier that names one can be
   * recognised in expression position and turned into a function VALUE. Empty
   * for a builder created before the declarations were collected.
   */
  functionNames: Set<string>;
  /**
   * Functions LIFTED out of a lambda's body, appended to the module once every
   * declared function has been lowered. A function value has to name something
   * the emitter can find an index for, and an index only exists for a function
   * in the module.
   */
  lifted: IRFunction[];
  /** Problems found while lowering, for the caller to report. */
  diagnostics: string[];
  /**
   * For each lifted function, the names it CAPTURED from the scope around it.
   *
   * They become leading parameters of the lifted function, and the emitter
   * builds a closure record for them. A lambda that captures is the whole reason
   * a function value carries an environment at all.
   */
  captures: Record<string, string[]>;
  /**
   * The list-method helpers already included in THIS module.
   *
   * A helper is built once and shared by every module that uses it, so a second
   * use in the SAME module found it in the cache and pushed it again — two
   * functions with one name, and the engine said "duplicate export name
   * '__map_number_number'". Sharing is across modules; inclusion is per module.
   */
  helpers: Set<string>;
  /**
   * Innermost last: where a `break` and a `continue` in the statement being
   * lowered go. `continueLabel` is null for a construct with no header to jump
   * back to, which is a `switch`.
   */
  /**
   * The name of the function THIS builder is lowering, and whether it was LIFTED.
   *
   * A lifted function shares no scope with the one around it — that is what
   * lifting means — so a name it reads from outside has to be captured AND passed
   * in. Whether THIS function is lifted decides whether a nested function's
   * captures have anywhere to be threaded to.
   */
  currentFunctionName: string | null = null;
  isLifted = false;

  /**
   * The classes this module has lowered, by name. Both `new` and a method
   * call have to reach the lifted function behind the class, and the class
   * NAME is all either of them has to go on.
   *
   * **Shared, and it has to be.** `lowerToIR` builds a fresh builder for every
   * top-level statement, so a map created here would be discarded before the
   * next statement was lowered — and `class B extends A` would report that A,
   * two lines above it in the same file, is not a class of this module.
   */
  classes: Map<string, LoweredClass>;

  /**
   * The parameter a method body reads `this` from, or null outside a class.
   *
   * The receiver is the method's FIRST WRITTEN parameter, after the captures —
   * which the emitter pushes by itself. Putting it there rather than in the
   * capture list is what lets a method call go through the ordinary call path
   * with no new instruction anywhere.
   */
  thisBinding: string | null = null;

  /** The class whose body is being lowered — what `this.m(…)` resolves against. */
  currentClass: LoweredClass | null = null;

  /**
   * A nested function's free variables join the ENCLOSING LIFTED function's list.
   *
   * Not threadable by scanning: the scan deliberately does not look inside a
   * nested declaration, because a nested body's internals must not leak into the
   * enclosing captures. So `outer` cannot discover `k` by looking, and has to be
   * told by `inner`.
   */
  threadCapturesUp(captures: string[]): void {
    if (captures.length === 0) return;
    if (!this.isLifted || !this.currentFunctionName) return;
    const mine = new Set(this.captures[this.currentFunctionName] ?? []);
    for (const c of captures) mine.add(c);
    this.captures[this.currentFunctionName] = [...mine].sort();
  }

  scopes: { breakLabel: string; continueLabel: string | null }[] = [];
  /**
   * How many `try` bodies the statement being lowered is inside. A call at any
   * depth must not propagate a pending exception, or it would leave the function
   * past the `catch` waiting for it.
   */
  tryAfters: { after: string; value: IRValue | null }[] = [];
  /**
   * Where a `return` inside a `try` body has to go, and what it carries.
   *
   * `try { return boom(n) } catch (e) { … }` cannot return straight from the
   * body: `boom(n)` is exactly what may throw, and leaving the function before
   * the slot is checked skips the `catch` that exists for it. So a `return`
   * jumps to `check` — a trampoline holding the slot test — and the merge block
   * returns the value from there.
   */
  tryAfters: { after: string; check: string; value: IRValue | null }[] = [];
  /**
   * The module-wide element-kind tables, so a function lowered from a list
   * METHOD SOURCE merges its arrays into the same records as the user's code.
   * A helper that kept its own would look like a numeric list to the emitter.
   */
  arrayKinds: Record<string, "number" | "address">;
  loopVarKinds: Record<string, "number" | "address">;

  constructor(
    functionNames: Set<string> = new Set(),
    lifted: IRFunction[] = [],
    diagnostics: string[] = [],
    arrayKinds: Record<string, "number" | "address"> = {},
    loopVarKinds: Record<string, "number" | "address"> = {},
    captures: Record<string, string[]> = {},
    helpers: Set<string> = new Set(),
    classes: Map<string, LoweredClass> = new Map(),
  ) {
    this.classes = classes;
    this.current = { type: "IRBlock", label: "entry", instructions: [], terminator: null };
    this.blocks.push(this.current);
    this.functionNames = functionNames;
    this.lifted = lifted;
    this.diagnostics = diagnostics;
    this.arrayKinds = arrayKinds;
    this.loopVarKinds = loopVarKinds;
    this.captures = captures;
    this.helpers = helpers;
  }

  /** Record that `name` is a loop variable over an array of the given kind. */
  declareLoopVar(name: string, kind: "number" | "address"): void {
    this.loopVars.set(name, kind);
  }

  newBlock(label: string): IRBlock {
    const b: IRBlock = { type: "IRBlock", label, instructions: [], terminator: null };
    this.blocks.push(b);
    return b;
  }

  /** Start a fresh block and continue lowering into it. */
  startBlock(label: string): IRBlock {
    this.current = this.newBlock(label);
    return this.current;
  }

  /**
   * Every name this function has a SLOT for: its parameters, and everything the
   * body declared or assigned.
   *
   * BUG-WASM-82. A call whose callee is a bare NAME lowers to a load of that
   * local — and when nothing ever gave the name a slot, the load read a slot that
   * means something else. The module validated, and the trap at run time said
   * `null function or function signature mismatch`, which is what the engine says
   * for calling a function that does not exist. The program WAS doing that, and the
   * message pointed at a TYPE.
   *
   * **The question is "does the slot exist", not "is it a function".** The census
   * (`.mavis-probe/callee.txt`: 386 bare-name callees over 96 files) put 11 names
   * in more than one bucket — `resolve` is a binding in one file and unknown in
   * another, `walk` and `compile` likewise — so the name alone cannot decide what a
   * call means. A rule keyed on "is not a function" would have refused all eleven
   * of their legal uses.
   *
   * `assign` counts, deliberately and in the PERMISSIVE direction: `f = (v) => …`
   * binds `f` with an `assign` and not a `declare`. A name wrongly IN this set is
   * the old behaviour; a name wrongly MISSING is a working program refused. The
   * seven legal shapes, each with the answer it gave before this change, are
   * asserted in `tests/wasm.test.ts` so the cost of being wrong is visible.
   */
  slots: Set<string> = new Set();

  /** Record that `name` has a slot in this function. */
  noteSlot(name: string): void {
    if (name) this.slots.add(name);
  }

  /** Does `name` name a slot here — a parameter, or a declared or assigned value? */
  hasSlot(name: string): boolean {
    return this.slots.has(name);
  }

  /**
   * Fill the registry from an emitted instruction.
   *
   * In `emit` rather than at each declaration site on purpose: a variable, a
   * destructured name, a `for` counter, a loop variable and a `catch` parameter all
   * reach the module as a `declare`, and there are five of them. Hooking the funnel
   * means a sixth cannot be forgotten.
   */
  private noteSlotFrom(inst: IRInstruction): void {
    const anyInst = inst as any;
    if (anyInst.op === "declare" && typeof anyInst.name === "string") this.noteSlot(anyInst.name);
    if (anyInst.op === "assign" && typeof anyInst.target === "string") this.noteSlot(anyInst.target);
  }

  emit(inst: IRInstruction): void {
    this.noteSlotFrom(inst);
    this.current.instructions.push(inst);
  }

  terminate(term: IRTerminator): void {
    this.current.terminator = term;
  }

  isTerminated(): boolean {
    return this.current.terminator !== null;
  }

  finish(): IRBlock[] {
    // A function that falls off the end returns undefined.
    const last = this.blocks[this.blocks.length - 1];
    if (last && !last.terminator) {
      last.terminator = { op: "return", value: null };
    }
    return this.blocks;
  }
}

// ── List methods, written in the language itself ──────────────────────
//
// `a.map(fn(v) { … })` has to become something the emitter can compile, and
// this backend links no runtime. So each method is a module function written
// in Nodeon, parsed and lowered through exactly the same path as the user's own
// code.
//
// That is the point of writing them here rather than emitting their bytecode:
// a method written in the language is fixed by the same fixes as everything
// else, and it reads as the method it implements. The one thing it relies on is
// that the callback arrives as a function VALUE, which is what `f(list[i])`
// below needs — a plain call would not compile.
const LIST_METHODS: Record<string, string> = {
  map: `fn %NAME%(list, f) {
    const out = []
    for i in 0..(list.length - 1) { out.push(f(list[i])) }
    return out
  }`,
  filter: `fn %NAME%(list, f) {
    const out = []
    for i in 0..(list.length - 1) { if f(list[i]) == 1 { out.push(list[i]) } }
    return out
  }`,
  foreach: `fn %NAME%(list, f) {
    for i in 0..(list.length - 1) {
      f(list[i])
    }
    return list
  }`,
  sum: `fn %NAME%(list) {
    let t = 0
    for v in list { t = t + v }
    return t
  }`,
  count: `fn %NAME%(list) {
    let t = 0
    for v in list { t = t + 1 }
    return t
  }`,
  // A scan. The list already carries a LENGTH header, so this is a walk and
  // not a search — and 4 corpus programs call it, which makes it the cheapest of
  // the collection methods.
  //
  // An explicit `while` and not a `for` over a range, because the index has to
  // be the RESULT; and `0 - 1` and not `-1`, because a leading minus in a
  // literal is the one thing here not to assume.
  indexOf: `fn %NAME%(list, v) {
  let i = 0
  let n = list.length
  while i < n {
    if list[i] == v { return i }
    i = i + 1
  }
  return 0 - 1
}`,
};

/**
 * A method is built ONCE PER PAIR OF KINDS: what the source list holds, and
 * what the result list holds.
 *
 * `map` over a list of numbers and `map` over a list of records write different
 * things: the first stores an f64 slot, the second an i32 address. One shared
 * helper had to pick one, and the mismatch was not a wrong answer but an
 * INVALID MODULE — `local.set[0] expected type f64, found i32.sub`. A few
 * compiled versions of a five-line function is a far smaller price than boxing
 * every element.
 */
function helperNameFor(
  method: string,
  elementKind: "number" | "address",
  resultKind: "number" | "address",
): string {
  return `__${method}_${elementKind}_${resultKind}`;
}

/** The methods that hand back a LIST, so the call's result is known to be one. */
const METHODS_RETURNING_LIST = new Set(["map", "filter", "foreach"]);

/** The module functions a list method lowers to, built once and shared. */
const listMethodFunctions = new Map<string, { fn: IRFunction; index: number }>();
let listMethodParser: ((src: string) => any) | null = null;

/**
 * The parser, wired in by `index.ts`.
 *
 * Injected rather than imported so the lowering does not depend on the parser
 * directly: the list methods are the only thing here that needs to read source.
 */
export function setListMethodParser(parse: (src: string) => any): void {
  listMethodParser = parse;
  listMethodFunctions.clear();
}

/**
 * The methods `LIST_METHODS` covers, looked up as OWN properties.
 *
 * `method in LIST_METHODS` also answers true for anything on the prototype
 * chain, so `code.toString(16)` matched — `toString` is on `Object.prototype` —
 * and the lowering tried to call `.replace` on a FUNCTION. Half the corpus that
 * formats a number reached that line and the compiler threw instead of
 * reporting a gap.
 */
function isListMethod(method: string): method is keyof typeof LIST_METHODS {
  return Object.prototype.hasOwnProperty.call(LIST_METHODS, method);
}

function ensureListMethod(
  b: BlockBuilder,
  method: string,
  elementKind: "number" | "address",
  resultKind: "number" | "address",
  functionNames: Set<string>,
): string | null {
  const template = LIST_METHODS[method];
  if (!template) return null;
  const name = helperNameFor(method, elementKind, resultKind);
  // A helper is a function OF THIS MODULE, so it has to be included — once. The
  // cache is shared across modules, so the second use here found it and pushed a
  // SECOND copy under the same name.
  if (b.helpers.has(name)) return name;
  b.helpers.add(name);
  // **No cross-module cache, and there WAS one.**
  //
  // `lowerFunction` merges the helper builder's `arrays` into the `arrayKinds` of
  // the module that BUILT it, so a module that reused a cached helper received its
  // INSTRUCTIONS and not the table saying which of its temporaries hold a list.
  // `list.length` and `list[i]` then lowered at the wrong width and the scan missed:
  //
  //     vitest run tests/wasm.test.ts -t "…"   1 passed
  //     vitest run tests/wasm.test.ts          1 failed
  //
  // Same program. Copying the IR per module was tried FIRST and did not fix it, and
  // that is what pointed here: the shared object was not the cause, the missing
  // TABLE was. `b.helpers` above already dedupes within a module.
  if (!listMethodParser) {
    b.diagnostics.push(
      `el método de lista "${method}" necesita el parser, que no está conectado a este backend`,
    );
    return null;
  }
  const ast = listMethodParser(template.replace("%NAME%", name));
  if ((ast.errors ?? []).length) {
    b.diagnostics.push(
      `el método de lista "${method}" no se pudo analizar: ${(ast.errors ?? []).map((e: any) => e.message ?? String(e)).join("; ")}`,
    );
    return null;
  }
  const fn = lowerFunction(
    (ast.body as any[])[0],
    b.arrayKinds,
    b.loopVarKinds,
    functionNames,
    b.lifted,
    b.diagnostics,
    // The result list holds whatever the source held.
    { out: resultKind, list: elementKind },
    b.captures,
  );
  b.lifted.push(fn);
  functionNames.add(fn.name);
  // Nothing is cached: see above. A module builds the helper it uses.
  return fn.name;
}

/**
 * Build a string method's helper: parse the Nodeon source, lower it once, and hand
 * back the name. The same shape as `ensureListMethod` and `ensureSetMethod`.
 *
 * **The seed is the part that makes the body work.** `s: "address"` and
 * `p: "address"` tell the lowering that both parameters are BLOCKS, so `.length`
 * becomes the header read at offset 0 and `s[i]` becomes the one-byte element read.
 * Without it the helper reads its own parameters as numbers and compares garbage —
 * which is what an unseeded list method does.
 */
function ensureStringMethod(b: BlockBuilder, method: string): string | null {
  const template = STRING_METHODS[method];
  if (!template) return null;
  const name = `__str_${method}`;
  if (b.helpers.has(name)) return name;
  b.helpers.add(name);
  if (!listMethodParser) {
    b.diagnostics.push(
      `el método de cadena "${method}" necesita el parser, que no está conectado a este backend`,
    );
    return null;
  }
  const ast = listMethodParser(template.replace(/%NAME%/g, name));
  if ((ast.errors ?? []).length) {
    b.diagnostics.push(
      `el método de cadena "${method}" no se pudo analizar: ${(ast.errors ?? []).map((e: any) => e.message ?? String(e)).join("; ")}`,
    );
    return null;
  }
  const functionNames = b.functionNames;
  const lowered = lowerFunction(
    (ast.body as any[])[0],
    b.arrayKinds,
    b.loopVarKinds,
    functionNames,
    b.lifted,
    b.diagnostics,
    // STRING-SEED-75: these two are STRINGS. The table they used to be seeded into
    // said "a list of addresses", which is an eight-byte element, and every method
    // answered 0 on a module the engine accepted.
    { s: "string", p: "string" },
    b.captures,
  );
  b.lifted.push(lowered);
  functionNames.add(lowered.name);
  // Nothing is cached across modules: a module builds the helper it uses.
  return lowered.name;
}

/**
 * BUG-WASM-85. Build a function the LANGUAGE provides, on first use.
 *
 * **`null` for a name that is not one of them, and no diagnostic.** The caller is a
 * call site, and almost every call in a program is not one of these: a name that does
 * not exist here is a name the BUG-WASM-82 refusal has to hear about, and pushing two
 * diagnostics for one hole would make a count of holes a count of nothing.
 *
 * `ensureStringMethod` is the sibling and the reason this is short: parse the source,
 * lower it with the module's own tables, push it, and put its name in `functionNames` so
 * that the call about to be emitted is an ordinary direct call. There is nothing else
 * here that a call needs.
 *
 * **`seedLists` is empty, and that is the difference from a string method.** `s` and `p`
 * there are BLOCKS and the emitter has to be told; `n` is a number, which is the default
 * width of a parameter, and saying so would be a second rule about the same thing.
 */
function ensureGlobalFunction(b: BlockBuilder, name: string): string | null {
  const template = GLOBAL_FUNCTIONS[name];
  if (!template) return null;
  // **The helper is named what the program writes, with no prefix.** The registry is read
  // by NAME at the call site — `isDirect` asks for `numToStr`, not for a private spelling
  // of it — and this version registered `__g_numToStr`, so the call was still a callee the
  // module did not have and BUG-WASM-82 refused it, correctly, by name.
  //
  // A prefix would also be unnecessary rather than merely inelegant: the caller builds
  // this only when the module has NO such name, so a collision is impossible by
  // construction. And a helper whose name nobody in the program can write is not a
  // library entry — it is a private function built eagerly.
  const helper = name;
  if (b.helpers.has(helper)) return helper;
  b.helpers.add(helper);
  if (!listMethodParser) {
    b.diagnostics.push(
      `la función \`${name}\` necesita el parser, que no está conectado a este backend`,
    );
    return null;
  }
  const ast = listMethodParser(template.replace(/%NAME%/g, helper));
  if ((ast.errors ?? []).length) {
    b.diagnostics.push(
      `la función \`${name}\` no se pudo analizar: ${(ast.errors ?? []).map((e: any) => e.message ?? String(e)).join("; ")}`,
    );
    return null;
  }
  const functionNames = b.functionNames;
  const lowered = lowerFunction(
    (ast.body as any[])[0],
    b.arrayKinds,
    b.loopVarKinds,
    functionNames,
    b.lifted,
    b.diagnostics,
    {},
    b.captures,
  );
  b.lifted.push(lowered);
  functionNames.add(lowered.name);
  return lowered.name;
}

/**
 * `Math` methods, written in the language itself, the same way the list methods
 * are. They are NOT list methods: there is no receiver in front of the arguments,
 * so they get their own table and their own build step rather than being bent
 * into `ensureListMethod`.
 *
 * They are here because the corpus asks for them and they are the cheapest thing
 * on the list: **3 programs**, and neither needs a decision from anyone. Every
 * string method wants a decision about what a character is; these do not.
 */
/**
 * Set methods, written in the language itself, the way the list methods are.
 *
 * **A Set IS a list of addresses in this backend.** That is not a shortcut, it
 * is the whole design: `has` is a scan comparing addresses and `add` is a scan
 * followed by a push. Neither ever looks at what is inside a string, so the
 * byte-or-character question does not change one instruction here — which is
 * why these can be built while that decision is still open.
 *
 * Resolved BY NAME, like the list methods, not by the type of the receiver: a
 * Set is often a module-level `const` that another FILE holds a reference to,
 * and a per-file type fact does not survive the linker.
 */
/**
 * String methods, written in the language itself, the way the list methods are.
 *
 * `startsWith`, `endsWith` and `includes` are all the SAME comparison — n bytes of one
 * block against n bytes of the other — and the comparison can be written in Nodeon
 * rather than in bytecode:
 *
 *     while i < n { if s[i] != p[i] { return 0 } i = i + 1 }
 *
 * and every part of that already lowers. `while` becomes blocks, `s[i]` is the
 * ONE-BYTE load of BUG-WASM-51, `.length` is the header at offset 0, and the
 * comparison is an ordinary number comparison. **So none of this is new emitter
 * bytecode, and the loop that `slice` needs and does not have is not needed here** —
 * the lowering writes loops, and the emitter's job starts after that.
 *
 * `trim` and `toLowerCase`/`toUpperCase` are NOT here: they need a character set and
 * a case table, which is where the byte-or-character question actually bites, and
 * guessing would be worse than refusing.
 *
 * **The receiver's KIND is not known here**, and no per-function fact can know it
 * across a call boundary. A `.startsWith` on something that is not a string would
 * compile and misbehave. The list methods have always had exactly that property; the
 * alternative is a rejection that cannot say what it should have asked.
 */
/**
 * BUG-WASM-85. **Functions the language provides, written in the language.**
 *
 * `STRING_METHODS` below is the same idea with a receiver in front, and it is the
 * mechanism this reuses rather than a new one: a table of Nodeon source, parsed and
 * lowered on FIRST USE, with the result added to `functionNames`. A second path for
 * "a call that is really something else" is how a language ends up with two meanings
 * for one thing, so `numToStr` is reached the way a method is and not through a
 * special case of its own.
 *
 * **What it does not decide is how a number is written.** The integer case is exact
 * and needs no decision from anyone. The fractional case is the open question — the
 * project's own `tests/program.test.ts` fixes JavaScript's rule for the JS backend
 * (`"sum 0.30000000000000004"`), and matching it faithfully is a decimal expansion,
 * which is a piece of work of its own. So the two cases that cannot be rendered answer
 * the EMPTY STRING, and a test pins that, because a wrong number is worse than an
 * empty one and an untested empty one becomes a wrong number.
 */
const GLOBAL_FUNCTIONS: Record<string, string> = {
  // The program that `tests/wasm.test.ts` already runs under BUG-WASM-83, moved here
  // whole. The two guards are the addition.
  numToStr: `fn %NAME%(n) {
  if n < 0 { return "" }
  if n != Math.floor(n) { return "" }
  if n == 0 { return "0" }
  let k = 1
  let m = n
  while m >= 10 {
    m = Math.floor(m / 10)
    k = k + 1
  }
  const b = allocblock(k)
  let i = k
  let q = n
  while q > 0 {
    i = i - 1
    storebyte(b, i, 48 + q % 10)
    q = Math.floor(q / 10)
  }
  return b
}`,
};

const STRING_METHODS: Record<string, string> = {
  startsWith: `fn %NAME%(s, p) {
  let i = 0
  let n = p.length
  if s.length < n { return 0 }
  while i < n {
    if s[i] != p[i] { return 0 }
    i = i + 1
  }
  return 1
}`,
  endsWith: `fn %NAME%(s, p) {
  let n = p.length
  if s.length < n { return 0 }
  let i = 0
  let k = s.length - n
  while i < n {
    if s[k + i] != p[i] { return 0 }
    i = i + 1
  }
  return 1
}`,
  includes: `fn %NAME%(s, p) {
  let n = p.length
  let last = s.length - n
  if last < 0 { return 0 }
  let start = 0
  while start <= last {
    let i = 0
    let same = 1
    while i < n {
      if s[start + i] != p[i] { same = 0 }
      i = i + 1
    }
    if same == 1 { return 1 }
    start = start + 1
  }
  return 0
}`,
  // BUG-WASM-68. The three that return a NUMBER, and so build nothing.
  //
  // `split` and `trim` are NOT here and it is worth saying why in the file people reach
  // for next: both return a value the language cannot build yet. A substring is a NEW
  // block on the heap, and a helper written in Nodeon has no way to allocate one —
  // `emitStringConcat` allocates in the emitter, and there is no `new string` in the
  // language to lean on. These three return a number, so the same byte comparison and
  // the same loop are the whole of it.
  //
  // **The bodies were written out and run on LOCALS first**, because a failure with a
  // seeded parameter in the picture cannot be told apart from a failure of the body —
  // that is how BUG-WASM-57 and 59 were separated from the seed that everybody blamed:
  //
  //     the indexOf body, out, on locals   →  5      PASS
  //     the same body, needle absent       →  -1     PASS
  //
  // `indexOf` takes no `from` parameter on purpose. A default would need a wasm
  // parameter the call site does not push, and a stack short by one is an invalid
  // module — so this is the arity that works, and `indexOf(haystack, needle, from)` is
  // a named gap rather than a silently wrong answer.
  indexOf: `fn %NAME%(s, p) {
  let n = p.length
  let last = s.length - n
  let start = 0
  while start <= last {
    let i = 0
    let same = 1
    while i < n {
      if s[start + i] != p[i] { same = 0 }
      i = i + 1
    }
    if same == 1 { return start }
    start = start + 1
  }
  return -1
}`,
  // The same scan from the other end. `start` walks DOWN and the condition is `>= 0`,
  // which is why the answer can be -1 and why an empty needle lands on the length —
  // both of which are what JavaScript does, and both of which fall out of the loop
  // rather than needing a branch.
  lastIndexOf: `fn %NAME%(s, p) {
  let n = p.length
  let start = s.length - n
  while start >= 0 {
    let i = 0
    let same = 1
    while i < n {
      if s[start + i] != p[i] { same = 0 }
      i = i + 1
    }
    if same == 1 { return start }
    start = start - 1
  }
  return -1
}`,
  // A byte, or -1. Two guards and the one-byte read that BUG-WASM-51 made one byte wide.
  charCodeAt: `fn %NAME%(s, i) {
  if i < 0 { return -1 }
  if i >= s.length { return -1 }
  return s[i]
}`,
};

const SET_METHODS: Record<string, string> = {
  has: `fn %NAME%(list, v) {
  let i = 0
  let n = list.length
  while i < n {
    if list[i] == v { return 1 }
    i = i + 1
  }
  return 0
}`,
  add: `fn %NAME%(list, v) {
  let i = 0
  let n = list.length
  while i < n {
    if list[i] == v { return list }
    i = i + 1
  }
  list.push(v)
  return list
}`,
};

/** The lifted function for a set method, built once and shared, like the list ones. */
const setMethodFunctions = new Map<string, IRFunction>();

function ensureSetMethod(b: BlockBuilder, method: string, functionNames: Set<string>): string | null {
  const template = SET_METHODS[method];
  if (!template) return null;
  const name = `__set_${method}_address`;
  if (b.helpers.has(name)) return name;
  b.helpers.add(name);
  const existing = setMethodFunctions.get(name);
  if (existing) {
    b.lifted.push(existing);
    functionNames.add(existing.name);
    return existing.name;
  }
  if (!listMethodParser) {
    b.diagnostics.push(
      `el método de conjunto "${method}" necesita el parser, que no está conectado a este backend`,
    );
    return null;
  }
  const ast = listMethodParser(template.replace(/%NAME%/g, name));
  if ((ast.errors ?? []).length) {
    b.diagnostics.push(
      `el método de conjunto "${method}" no se pudo analizar: ${(ast.errors ?? []).map((e: any) => e.message ?? String(e)).join("; ")}`,
    );
    return null;
  }
  // The receiver is a list of ADDRESSES, and that is what the seed says — read
  // as a number every element would come back as its raw bit pattern.
  const fn = lowerFunction(
    (ast.body as any[])[0],
    b.arrayKinds,
    b.loopVarKinds,
    functionNames,
    b.lifted,
    b.diagnostics,
    { list: "address" },
    b.captures,
  );
  b.lifted.push(fn);
  functionNames.add(fn.name);
  setMethodFunctions.set(name, fn);
  return fn.name;
}

const MATH_METHODS: Record<string, string> = {
  // BUG-WASM-80. These two need no emitter work at all, because a comparison and a
  // negation are programs the lowering already has: `if x < 0 { return 0 - x }` is a
  // method written in the language, exactly like `min` and `max` beside them.
  abs: `fn %NAME%(x) {
  if x < 0 { return 0 - x }
  return x
}`,
  sign: `fn %NAME%(x) {
  if x < 0 { return 0 - 1 }
  if x > 0 { return 1 }
  return 0
}`,
  min: `fn %NAME%(a, b) {
  if a < b { return a }
  return b
}`,
  max: `fn %NAME%(a, b) {
  if a > b { return a }
  return b
}`,
};

/** The `Math` helpers already built, by name. One per module, as with the lists. */
const mathMethodFunctions = new Map<string, { fn: IRFunction; index: number }>();

/**
 * BUG-WASM-80. The `Math` methods that are one wasm opcode each, so they cannot be
 * written in the language and are not in `MATH_METHODS`.
 */
const MATH_UNARY_OPS = new Set(["floor", "trunc", "round", "sqrt"]);

function isMathMethod(method: string): method is keyof typeof MATH_METHODS {
  return Object.prototype.hasOwnProperty.call(MATH_METHODS, method);
}

function ensureMathMethod(
  b: BlockBuilder,
  method: string,
  functionNames: Set<string>,
): string | null {
  const name = `__math_${method}`;
  // No cross-module cache, for the same reason as the list helpers.
  if (!listMethodParser) {
    b.diagnostics.push(
      `el método Math."${method}" necesita el parser, que no está conectado a este backend`,
    );
    return null;
  }
  const ast = listMethodParser(MATH_METHODS[method].replace("%NAME%", name));
  if ((ast.errors ?? []).length) {
    b.diagnostics.push(
      `el método Math."${method}" no se pudo analizar: ${(ast.errors ?? []).map((e: any) => e.message ?? String(e)).join("; ")}`,
    );
    return null;
  }
  const fn = lowerFunction(
    (ast.body as any[])[0],
    b.arrayKinds,
    b.loopVarKinds,
    functionNames,
    b.lifted,
    b.diagnostics,
    {},
    b.captures,
  );
  b.lifted.push(fn);
  functionNames.add(fn.name);
  // Nothing is cached: see above. A module builds the helper it uses.
  return fn.name;
}

/**
 * The names a function body treats as LISTS.
 *
 * The lowering decides whether `xs.length` is a length header or a field read
 * from whether it has already seen the name declared from a list literal. A
 * PARAMETER never has been, so `fn lenOf(list) { return list.length }` read a
 * field of a record and answered a denormal double where a count belongs — and
 * every range loop over that list then ran zero times.
 *
 * The body says which names are lists, by how it uses them: as the iterable of
 * a `for`, as the object of `.length`, of an index, or of a `.push`. That is a
 * fact about the function, available before anything is lowered.
 */
function listNamesOf(body: any[]): Set<string> {
  const lists = new Set<string>();
  // This runs on the AST, before anything is lowered, so a name arrives as
  // `{ type: "Identifier", name }` and not as an IR reference.
  const note = (node: any): void => {
    if (node?.type === "Identifier" && node.name) lists.add(node.name);
  };
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === "ForStatement" || node.type === "ForOfStatement") {
      note(node.iterable ?? node.right ?? node.object);
    }
    if (node.type === "MemberExpression" && node.object) {
      // `.length` is evidence: only a list has one. A COMPUTED member is not.
      //
      // `o[kind]` on a record used to mark `o` as a list, which is what made the
      // whole thing silently wrong rather than loudly unsupported: the emitter
      // asks whether a value is a list before it emits an index, was told yes, and
      // read `base + key*8` — with `key` a string ADDRESS. Measured on a record
      // literal `{ go: 42 }`:
      //
      //     o.go        → the field          a named read, correct
      //     o["go"]     → 0                  the same field, computed
      //     o[kind]     → 0                  ditto, with a variable key
      //     h = o[kind] → a garbage funcref, and calling it traps
      //
      // The corpus's own visitor does `handler = sv[stmt.type]`, so this is not a
      // rare spelling.
      //
      // A list that is ONLY ever indexed loses this inference, and that is the
      // right way round: an indexed parameter with no `push`, no `for` and no
      // `.length` is genuinely ambiguous here, and a name wrongly believed to be a
      // list is read at the wrong width and with the wrong offset. Saying "I do
      // not know" is the honest answer, and the emitter's computed-record guard
      // turns it into a sentence rather than a wrong number.
      const property = node.computed ? null : (node.property as any)?.name;
      if (property === "length") note(node.object);
    }
    // ANY list method, not just `push`. `xs.indexOf(v)` says as much about `xs`
    // as `xs.push(v)` does, and only `push` counted — so a parameter that was
    // only ever passed to a list method was typed as a NUMBER. A list is an
    // ADDRESS, so the call pushed an f64 where an i32 belonged and the callee read
    // garbage: `indexOf` answered -1 for an element that was in the list.
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      isListMethod(String((node.callee.property as any)?.name ?? ""))
    ) {
      note(node.callee.object);
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(body);
  return lists;
}

/**
 * What a call's result list holds, when it can be told.
 *
 * It is NOT the receiver's kind: `records.map(fn(o) { return o.v })` turns
 * records into numbers, and a helper built for the input read the result as
 * addresses. A LAMBDA's body is right here, so it decides: an object literal
 * means records, and anything else means numbers — which is what a binary
 * expression, an index or a call to a numeric function all are.
 *
 * The boundary is a lambda that returns a record it did not build, such as
 * `fn(o) { return o }`. A named function's result is not visible at the call
 * site either, and both fall back to numbers. Declaring the result type, or
 * tagging every element, would close it; guessing is the cheap half and the
 * wrong half is a list that reads as zeros.
 */
function resultElementKind(callback: Expression): "number" | "address" {
  if (callback?.type !== "FunctionExpression") return "number";
  const returnsRecord = (callback.body ?? []).some(
    (s: any) =>
      s?.type === "ReturnStatement" && s.value?.type === "ObjectExpression",
  );
  return returnsRecord ? "address" : "number";
}

function lowerFunction(
  fn: any,
  arrayKinds: Record<string, "number" | "address">,
  loopVarKinds: Record<string, "number" | "address">,
  functionNames: Set<string>,
  lifted: IRFunction[] = [],
  diagnostics: string[] = [],
  // STRING-SEED-75: "string" is the third value. A string is an indexable block
  // with a length header, so the LOWERING treats it as a list; it is not one, and
  // saying so in `arrayKinds` is what made the emitter read eight bytes per byte.
  seedLists: Record<string, "number" | "address" | "string"> = {},
  captures: Record<string, string[]> = {},
  helpers: Set<string> = new Set(),
  isLifted = false,
  thisBinding: string | null = null,
  currentClass: LoweredClass | null = null,
  classes: Map<string, LoweredClass> = new Map(),
): IRFunction {
  const params = fn.params.map((p: any) => p.name ?? p.value ?? String(p));
  // BUG-WASM-61. `fn(x) = expr`, and a block body whose LAST statement is a bare
  // expression, RETURN it. The generator has always applied that rule and this
  // lowering did not, so the function compiled to a VOID and every call answered 0:
  //
  //     let g = fn(x) = x + 1          →  g(1) = 0     want 2
  //     let g = (x) => x + 1           →  g(1) = 2     PASS  (BUG-WASM-60)
  //     let g = fn(x) { return x + 1 } →  g(1) = 2     PASS
  //
  // **Done here rather than at each call site** because every shape goes through
  // this function: named, anonymous, nested, and a class method. The NAMED one was
  // broken too and lowers through a different case than a lambda —
  // `fn twice(x) = x * 2` calling `fn double(x) = twice(x)` answered 0.
  //
  // `slice()` because the node belongs to the AST, and a lowering pass that
  // rewrote the tree it was handed would edit the caller's program.
  const body = (((fn.body ?? []) as any[]).slice()) as any[];
  const lastIsBareExpression =
    body.length > 0 && body[body.length - 1]?.type === "ExpressionStatement";
  // BUG-WASM-61c. **Two rules, because the JS generator has two.** A DECLARATION
  // returns when its body is EXACTLY one bare expression, and `emitFunction`
  // derives that from the SHAPE — `parseFunctionDeclaration` never set the flag,
  // because nothing reading a declaration ever asked for it. An EXPRESSION returns
  // when the parser's `implicitReturn` says so, which is the `fn(x) = e` form and a
  // block whose LAST statement is bare.
  //
  // Keyed on the node type, so the WASM backend and the JS backend answer the same
  // question the same way. Inventing a third rule here is how a language ends up
  // with two meanings.
  const returns =
    fn.type === "FunctionDeclaration"
      ? !fn.generator && body.length === 1 && lastIsBareExpression
      : !!fn.implicitReturn && lastIsBareExpression;
  if (returns) {
    const last = body[body.length - 1];
    body[body.length - 1] = { type: "ReturnStatement", value: last.expression };
  }
  // A parameter that shadows a function name is an ordinary value, so the
  // shadowed names come out of the set the body sees.
  const visible = new Set(functionNames);
  for (const p of params) visible.delete(p);
  const b = new BlockBuilder(
    visible,
    lifted,
    diagnostics,
    arrayKinds,
    loopVarKinds,
    captures,
    helpers,
    classes,
  );
  b.currentFunctionName = fn.name.name;
  b.isLifted = isLifted;
  // BUG-WASM-82. A parameter is the other way a name gets a slot, and it is the one
  // the emitter never sees an instruction for. `apply(f, v) { return f(v) }` is a
  // call to a name that is not a function, and it is legal — measured at 42, in the
  // table next to the four traps it is being told apart from.
  for (const p of params) b.noteSlot(p);

  // BUG-WASM-90. **Read the parameters' annotations, once, before the body is lowered.** The
  // census is 304 refusals that are all this fact, from 20 distinct parameters — and `ctx`
  // alone is 225 of them with two fields. So the shape of the work is a fact per PARAMETER, not
  // a patch per site.
  //
  // Reset first, always: a name in one body says nothing about the same name in another, and a
  // stale answer here would make a refusal disappear.
  // BUG-WASM-90. **A SCOPE, not a reset.** The enclosing function's annotated fields are
  // saved and put back, because a lambda inside a body re-enters this function: without
  // the restore, `f.params.map((p) => …).join("," + ctx.sp)` read the annotation, then threw
  // it away a line before needing it, and 76 corpus annotations bought nothing — the refusal
  // count went UP, from 1554 to 1557.
  //
  // The same shape as `slots` being the builder's own set, and the same mistake as
  // `stringFns` needing a pre-scan (BUG-WASM-89): a module-level fact that a nested scope
  // overwrites is a fact that is wrong exactly where the nesting is deepest, and the real
  // generator is full of arrows.
  const outerParamFields = paramFields;
  paramFields = new Map();
  for (const p of (fn.params ?? []) as any[]) {
    if (!p?.name || !p.typeAnnotation) continue;
    const members = membersOfType(p.typeAnnotation);
    if (members) paramFields.set(String(p.name), members);
  }

  // And the file's imports: the same fact for the same reason. A call to one of
  // these is a call to a name the LINKER will provide, so refusing it here would be
  // refusing a program that works.
  for (const n of importedNames) b.noteSlot(n);
  // The receiver has to travel INTO the builder `lowerFunction` makes for
  // itself. Setting it on the caller's builder reaches a different object and
  // the method body sees no `this` at all — which looks exactly like a fix
  // that does not fire.
  b.thisBinding = thisBinding;
  b.currentClass = currentClass;
  // The names the body treats as lists, so `.length` on a PARAMETER lowers to
  // the length header rather than to a field of a record. `seedLists` says so
  // for a function built from source, whose result list the caller knows the
  // element kind of.
  for (const name of listNamesOf(body)) {
    if (!b.arrays.has(name)) b.arrays.set(name, "number");
  }
  for (const [name, kind] of Object.entries(seedLists)) {
    if (kind === "string") {
      // The builder gets it — the body has to lower `.length` as a header read and
      // `s[i]` as an element read. `arrayKinds` does NOT: that table means "a list
      // of eight-byte elements", and it is the one that decides the width.
      b.arrays.set(name, "address");
      continue;
    }
    b.arrays.set(name, kind);
    arrayKinds[name] = kind;
  }
  // STRING-SEED-75: and the fact the emitter is missing goes here, where it can be.
  {
    const seeded = Object.entries(seedLists)
      .filter(([, k]) => k === "string")
      .map(([n]) => n);
    if (seeded.length) (stringSeeds[fn.name.name] ??= []).push(...seeded);
  }

  for (const stmt of body) {
    lowerStatement(stmt, b);
    Object.assign(arrayKinds, Object.fromEntries(b.arrays));
    Object.assign(loopVarKinds, Object.fromEntries(b.loopVars));
  }
  // BUG-WASM-90. The enclosing function's fields again — the counterpart of the save.
  paramFields = outerParamFields;

  // BUG-WASM-86. **A `return` of something this function proved to be a string makes this
  // function return a string**, and that is the whole rule. Asked AFTER the body, because the
  // mark lives on the value's temporary and the temporary does not exist until `lowerExpr`
  // has run.
  //
  // `numToStr` needs no special case: it returns a block, the `allocblock` branch marks that
  // temporary, and these lines do the rest. So does a program — a function whose body returns
  // a text becomes something a caller may concatenate.
  for (const blk of b.blocks) {
    const t = blk.terminator;
    if (t?.op !== "return" || !t.value) continue;
    if (isProvedStringValue(t.value, b) && fn.name?.name) stringFns.add(fn.name.name);
  }

  // **The seed is what the CALLER knows, and the body cannot recover it.**
  //
  // It is not out of order: it is applied correctly, and then the body's own scan
  // overwrites it — `listNamesOf` records `"number"` for a name it cannot prove is a
  // list of RECORDS — and the merge above carries that back into the module's table.
  // Measured: the seed asked for `{ s: "address", p: "address" }` and the module
  // reported `{ p: "number" }`, with `s` absent.
  //
  // `p[i]` and `p.length` look the same whether `p` is a list of numbers or a list of
  // addresses, and the scan has no way to tell. **The caller does**, which is why the
  // seed is re-applied here rather than left to the body.
  for (const [name, kind] of Object.entries(seedLists)) {
    if (kind === "string") {
      // The builder gets it — the body has to lower `.length` as a header read and
      // `s[i]` as an element read. `arrayKinds` does NOT: that table means "a list
      // of eight-byte elements", and it is the one that decides the width.
      b.arrays.set(name, "address");
      continue;
    }
    b.arrays.set(name, kind);
    arrayKinds[name] = kind;
  }
  // STRING-SEED-75: and the fact the emitter is missing goes here, where it can be.
  {
    const seeded = Object.entries(seedLists)
      .filter(([, k]) => k === "string")
      .map(([n]) => n);
    if (seeded.length) (stringSeeds[fn.name.name] ??= []).push(...seeded);
  }

  return {
    type: "IRFunction",
    name: fn.name.name,
    params,
    blocks: b.finish(),
    async: fn.async ?? false,
    generator: fn.generator ?? false,
  };
}

/** A class as this backend builds it: a record, plus a name for each function. */
interface LoweredClass {
  name: string;
  /** Method name -> the lifted function that implements it. */
  methods: Map<string, string>;
  /** The lifted constructor. Its first written parameter is the receiver. */
  ctor: string;
  /** The parent class's constructor, for `super(…)`. */
  parentCtor: string | null;
  /** Every field this class or a parent writes through `this`, sorted. */
  fields: string[];
}

/**
 * Every field a class writes through `this`, taken off the SOURCE rather than
 * off the IR.
 *
 * The record is allocated at `new`, and the allocation is what fixes its size,
 * so the field list has to be known before any body is lowered. Scanning the
 * methods is the only place it can come from. A field only ever *read* and
 * never written is still allocated, which is right: the record has a shape and
 * the shape is a property of the class, not of one method.
 */
function classFieldsOf(methods: any[]): string[] {
  const fields = new Set<string>();
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (
      n.type === "MemberExpression" &&
      !n.computed &&
      n.object?.type === "Identifier" &&
      n.object.name === "this"
    ) {
      const p = n.property?.name ?? n.property?.value;
      if (p !== undefined && p !== null) fields.add(String(p));
    }
    for (const k of Object.keys(n)) walk(n[k]);
  };
  for (const m of methods) walk(m?.body ?? []);
  return [...fields].sort();
}

/**
 * Lift a class.
 *
 * A class is a RECORD plus a table of lifted functions, and the two halves
 * meet in one place: the receiver is the first written parameter of every
 * method, so `this.x` is a `loadfield` and `this.m(…)` is a `call`. There is no
 * class runtime at all — no vtable, no `call_indirect` on a method — which is
 * possible only because the method is resolved where the class is known
 * lexically. `obj.m(…)` on something that is not `this` is NOT resolved, and
 * the emitter names it rather than guessing.
 *
 * **Inheritance is a copied table, not a chain.** A subclass starts from its
 * parent's methods and overrides what it declares, so a call resolves the same
 * way a parent's would. The one thing left to do at run time is `super(…)`,
 * which runs the parent constructor on the same record — and the corpus has no
 * `super.m(…)` at all, so that is the whole of the remaining work.
 */
function lowerClass(node: any, b: BlockBuilder): void {
  const name = node.name?.name ?? node.id?.name;
  if (!name) {
    b.diagnostics.push(
      "una clase sin nombre todavía no está soportada por el backend de WebAssembly",
    );
    return;
  }
  const members: any[] = Array.isArray(node.body) ? node.body : (node.body?.body ?? []);
  const methods = members.filter((m) => m?.type === "ClassMethod");
  const parentName: string | null = node.superClass?.name ?? null;
  const parent = parentName ? b.classes.get(parentName) : undefined;
  if (parentName && !parent) {
    b.diagnostics.push(
      `la clase "${name}" extiende de "${parentName}", que no es una clase de este módulo`,
    );
    return;
  }

  const cls: LoweredClass = {
    name,
    methods: new Map(parent?.methods ?? []),
    ctor: `${name}__ctor`,
    parentCtor: parent ? parent.ctor : null,
    fields: [...new Set([...(parent?.fields ?? []), ...classFieldsOf(methods)])].sort(),
  };
  b.classes.set(name, cls);

  // A field with an initialiser runs before the constructor body, the way a
  // declaration before a constructor would. `this.#plugins` is a private field
  // and is stored under its own name: offsets are module-wide BY NAME, and a
  // second spelling of the same field would be a second slot.
  const fieldInits = members
    .filter((m) => m?.type === "ClassField")
    .map((m) => ({
      name: m.key?.name ?? m.key?.value ?? m.name?.name,
      value: m.value,
    }))
    .filter((f) => f.name !== undefined && f.name !== null);

  const receiver = `__this_${name}`;
  const withCtor = [
    ...methods.filter((m) => m.name?.name === "constructor"),
    ...(methods.some((m) => m.name?.name === "constructor")
      ? []
      : [{ name: { name: "constructor" }, params: [], body: [] }]),
  ];

  for (const m of [...withCtor, ...methods.filter((m) => m.name?.name !== "constructor")]) {
    const mName = m.name?.name;
    if (!mName) continue;
    const liftedName = mName === "constructor" ? cls.ctor : `${name}__${mName}`;
    if (mName === "constructor") cls.methods.set("constructor", cls.ctor);
    else cls.methods.set(mName, liftedName);

    // The class NAME is a type, not a value: without this the free-variable
    // scan takes it as a capture of every method that mentions it.
    const known = new Set(b.functionNames);
    known.add(name);
    const captures = [...freeVariablesOf(m, known)].filter((c) => c !== "this").sort();
    if (captures.length > 0) b.captures[liftedName] = captures;
    b.threadCapturesUp(captures);

    const captureParams = captures.map((c) => ({ type: "Param", name: c, rest: false }));
    const visible = new Set(b.functionNames);

    // **Class fields are seeded BEFORE the constructor body**, and only in the
    // constructor: every other method must not re-run them, or a field would be
    // reset by every call that happened to assign it.
    const seeded: any[] =
      mName === "constructor"
        ? fieldInits.map((f) => ({
            type: "ExpressionStatement",
            expression: {
              type: "AssignmentExpression",
              left: { type: "MemberExpression", computed: false, object: { type: "Identifier", name: "this" }, property: { type: "Identifier", name: String(f.name) } },
              right: f.value ?? { type: "Literal", value: 0, literalType: "number" },
            },
          }))
        : [];

    const lifted = lowerFunction(
      {
        name: { name: liftedName },
        params: [...captureParams, { type: "Param", name: receiver, rest: false }, ...(m.params ?? [])],
        body: [...seeded, ...(m.body ?? [])],
      },
      b.arrayKinds,
      b.loopVarKinds,
      visible,
      b.lifted,
      b.diagnostics,
      {},
      b.captures,
      b.helpers,
      true,
      receiver,
      cls,
      b.classes,
    );

    // The same rebuild a nested `fn` gets: lowering the body is what makes this
    // method's own captures knowable, and the receiver has to come AFTER them
    // because the emitter pushes the captures first.
    const finalCaptures = b.captures[liftedName] ?? [];
    const alreadyLeading = new Set(captureParams.map((c) => (c as any).name));
    const late = finalCaptures.filter((c) => !alreadyLeading.has(c));
    if (late.length > 0) {
      lifted.params = [
        ...late.map((c) => ({ type: "Param", name: c, rest: false })),
        ...lifted.params,
      ];
    }
    b.threadCapturesUp(finalCaptures);
    b.lifted.push(lifted);
    b.functionNames.add(liftedName);
  }
}

function lowerStatement(stmt: Statement, b: BlockBuilder): void {
  switch (stmt.type) {
    case "DestructuringDeclaration": {
      // BUG-WASM-75. `const { a, b } = cfg.db` and `const [x, y] = xs` are a `declare`
      // per name over ONE lowered value — and every read they need already exists. A
      // field read is a `loadfield` and an element read is the same instruction with a
      // computed index, so **there is no new emitter bytecode here at all** and no new
      // type. That is the whole reason this one is worth doing after a week of writing
      // primitives: it needs a fact the backend has, not a new fact.
      //
      // **The value is lowered ONCE** and every binding reads through that one IR value.
      // Lowering `stmt.value` per property would emit its instructions once per property,
      // which for `n.trim().split(...)` is a call a piece of the list.
      const source = lowerExpr(stmt.value, b);
      const pattern: any = (stmt as any).pattern;
      const kind = (stmt as any).kind as "const" | "let" | "var";
      const bind = (name: string, v: IRValue): void => {
        b.emit({ op: "declare", kind, name, value: v } as any);
      };
      const refuse = (why: string): void => {
        b.diagnostics.push(
          `la desestructuración "${why}" todavía no está soportada por el backend de WebAssembly`,
        );
        const t = freshTemp();
        b.emit({ op: "literal", target: t, value: 0, kind: "number" });
        bind("__desestructurado", { kind: "temp", id: t });
      };

      if (pattern?.type === "ObjectPattern") {
        if (pattern.rest) { refuse("con resto"); break; }
        for (const p of pattern.properties ?? []) {
          // `key` is a name, or a PATH: `const { host } = config.db` parses the key as
          // `config.db`, so the field to read is the LAST step and the receiver is
          // everything before it. The corpus uses exactly that shape.
          const key = p.key;
          const field =
            key?.type === "Identifier" ? key.name
            : key?.type === "MemberExpression" && !key.computed ? key.property?.name
            : null;
          if (!field) { refuse("con una clave que no es un nombre"); continue; }
          let receiver = source;
          if (key.type === "MemberExpression") {
            const head = freshTemp();
            b.emit({
              op: "loadfield", target: head, object: source,
              field: key.object?.name, computed: false,
            } as any);
            receiver = { kind: "temp", id: head };
          }
          const t = freshTemp();
          b.emit({ op: "loadfield", target: t, object: receiver, field, computed: false } as any);
          bind(p.shorthand ? key.name : p.value.name, { kind: "temp", id: t });
        }
        break;
      }

      if (pattern?.type === "ArrayPattern") {
        if (pattern.rest) { refuse("con resto"); break; }
        pattern.elements?.forEach((e: any, i: number) => {
          // `null` is an elision — `[a, , c]` — and it costs nothing to honour.
          if (!e) return;
          if (e.type !== "Identifier") { refuse("anidada"); return; }
          const idx = freshTemp();
          b.emit({ op: "literal", target: idx, value: i, kind: "number" });
          const t = freshTemp();
          b.emit({
            op: "loadfield", target: t, object: source,
            field: " index", computed: true, index: { kind: "temp", id: idx },
          } as any);
          bind(e.name, { kind: "temp", id: t });
        });
        break;
      }

      refuse("de una forma que no se reconoce");
      break;
    }
    case "VariableDeclaration": {
      const val = stmt.value ? lowerExpr(stmt.value, b) : null;
      b.emit({
        op: "declare",
        kind: stmt.kind as "const" | "let" | "var",
        name: stmt.name.name,
        value: val,
      });
      // A binding inherits the element kind of the array it names, so a `for`
      // over `xs` can read a numeric array as f64 and an array of records as
      // addresses. Without this the loop guessed "number" for both.
      if (val && val.kind === "temp" && b.arrays.has(val.id)) {
        b.arrays.set(stmt.name.name, b.arrays.get(val.id)!);
      }
      // BUG-WASM-69. And the same for a STRING, which the builder had no way to say.
      // `let s = "hola"` is the fact, and it is what tells a string method from a list
      // method when both tables have the same NAME — see the STRING branch.
      if (b.stringNames.has(val?.kind === "temp" ? val.id : "")) {
        b.stringNames.add(stmt.name.name);
      }
      // A binding that received an INSTANCE says which class, so a method call
      // on it resolves. `NewExpression` returns a temp of its own, so the class
      // is read off the source of the value, not off the value.
      const src = stmt.value as any;
      if (src?.type === "NewExpression" && src.callee?.name) {
        b.classOf.set(stmt.name.name, String(src.callee.name));
      }
      break;
    }
    case "ExpressionStatement": {
      const val = lowerExpr(stmt.expression, b);
      b.emit({ op: "exprstmt", value: val });
      break;
    }
    case "ReturnStatement": {
      const val = stmt.value ? lowerExpr(stmt.value, b) : null;
      // Inside a `try` the value is exactly what may throw, so the return goes
      // out THROUGH the merge block and the slot is checked on the way.
      const frame = b.tryAfters[b.tryAfters.length - 1];
      if (frame) {
        // Park the value and go through the slot check. Returning from here
        // would skip the `catch` that exists for the expression being returned.
        if (val) {
          const held = freshTemp();
          b.emit({ op: "assign", target: held, value: val } as any);
          frame.value = { kind: "temp", id: held };
        }
        b.terminate({ op: "jump", target: frame.check } as any);
        break;
      }
      b.terminate({ op: "return", value: val });
      break;
    }
    case "IfStatement": {
      const cond = lowerExpr(stmt.condition, b);
      const thenLabel = `then_${freshTemp()}`;
      const endLabel = `end_${freshTemp()}`;
      // An `if` with no `alternate` has no else arm, and saying so by naming the
      // merge is how the emitter is told to emit no `else` at all.
      const elseArmLabel = stmt.alternate ? `else_${freshTemp()}` : endLabel;

      b.terminate({ op: "branch", condition: cond, thenLabel, elseLabel: endLabel, elseArm: elseArmLabel });

      // then-arm
      b.startBlock(thenLabel);
      for (const s of stmt.consequent) lowerStatement(s, b);
      if (!b.isTerminated()) b.terminate({ op: "jump", target: endLabel });

      // else-arm (only when there is one)
      if (stmt.alternate) {
        b.startBlock(elseArmLabel);
        const altStmts = Array.isArray(stmt.alternate) ? stmt.alternate : [stmt.alternate];
        for (const s of altStmts) lowerStatement(s as Statement, b);
        if (!b.isTerminated()) b.terminate({ op: "jump", target: endLabel });
      }

      // merge point
      b.startBlock(endLabel);
      break;
    }
    case "FunctionDeclaration": {
      // A nested `fn` is a LAMBDA WITH A NAME, and the lambda case above is
      // already ninety percent of it: lift the body to a module-level function,
      // turn its free variables into leading parameters, record the captures.
      //
      // The part a lambda never has to answer is the NAME. Every function name in
      // a module has to be unique, and a name nested inside two files would
      // collide. Measured across the corpus before choosing a scheme:
      //
      //     159 nested declarations, and 0 of them share a name with a top-level
      //     function of the same file, and 0 share a name with each other
      //
      // so the plain name is safe. No qualification, no mangling, and no rewriting
      // of the call sites — which is also what a reader of the language expects.
      // **16 corpus programs are blocked on exactly this**, and they are the
      // self-hosted compiler: 39 in `lexer.no`, 28 in `parser-statements.no`, 19 in
      // `parser-base.no`.
      const decl: any = stmt;
      const name = decl?.name?.name;
      if (!name) break;
      // **The function's own name is not one of its free variables**, and saying so
      // here is what makes the 8 recursive ones in the corpus work.
      //
      // It is not: `freeVariablesOf` runs before the name is in the enclosing
      // builder's set, so the body's own `count(x - 1)` reads as free and
      // `count` captured ITSELF. The lifted function then took `count` as a
      // leading parameter, `lowerFunction` deleted that parameter from the visible
      // set, the recursive call stopped being direct, and the module validated
      // and trapped at run time with `null function or function signature
      // mismatch` — a thrown error for a function whose recursion is a feature
      // the language is supposed to have.
      const known = new Set(b.functionNames);
      known.add(name);
      const captures = [...freeVariablesOf(decl, known)].sort();
      if (captures.length > 0) b.captures[name] = captures;
      // …and up to the enclosing lifted function, if there is one.
      b.threadCapturesUp(captures);
      // The lifted body sees its OWN name, so the recursive ones — 8 of them in
      // the corpus — can call themselves.
      const visible = new Set(b.functionNames);
      visible.add(name);
      const captureParams = captures.map((c) => ({ type: "Param", name: c, rest: false }));
      const lifted = lowerFunction(
        {
          // BUG-WASM-61c: this node is rebuilt, so it arrived without a `type` — and
          // `type` is what tells `lowerFunction` which of the two implicit-return rules
          // applies. A nested `fn` is a declaration, and it is said so here.
          type: "FunctionDeclaration",
          name: { name },
          params: [...captureParams, ...(decl.params ?? [])],
          body: decl.body ?? [],
        },
        b.arrayKinds,
        b.loopVarKinds,
        visible,
        b.lifted,
        b.diagnostics,
        {},
        b.captures,
        undefined,
        true,
      );
      // **The signature, rebuilt.** Lowering the body was what made this
      // function's OWN captures knowable — its nested functions are lowered
      // inside this call and report theirs back up. So the leading parameters
      // are fixed here, after the fact, in the same sorted order the call site
      // reads them in. Without this the call site pushes one argument more than
      // the callee has parameters, and the engine says so in terms that name
      // neither the cause nor the construct.
      const finalCaptures = b.captures[name] ?? [];
      const alreadyLeading = new Set(captureParams.map((c) => (c as any).name));
      const late = finalCaptures.filter((c) => !alreadyLeading.has(c));
      if (late.length > 0) lifted.params = [...late.map((c) => c), ...lifted.params];
      b.lifted.push(lifted);
      // **And ONE LEVEL FURTHER UP, because a capture learned while the body was
      // being lowered never went up on its own.**
      //
      // The `threadCapturesUp` above fires when this function is DISCOVERED, and at
      // that moment its own captures are still whatever the free-variable scan could
      // see. The scan does not look inside a nested declaration — correctly, a
      // nested body's internals must not leak — so a function whose captures come
      // from ITS OWN nested function has none yet. The body is lowered on the call
      // above and only then does it know, and the rebuild just above reads those
      // final captures. So they are threaded up HERE, as the stack unwinds, and the
      // next level out gets them the same way.
      //
      // The chain therefore has to run on the way back UP as well as down, or it
      // only ever reaches one level.
      //
      // Without this, three levels answer a wrong number rather than refusing, and
      // the shape of the failure is what makes it worth writing down: `c` reports
      // `k` to `b`, `b` rebuilds its signature with it and says nothing further, so
      // `a` calls `b(k, x)` reading a local `k` that does not exist. Every call
      // site's pushed count still AGREES with what the callee declares, the module
      // validates, and the answer is 2 instead of 8. An argument-count check — the
      // obvious invariant here — would call this correct.
      b.threadCapturesUp(finalCaptures);
      // **And the ENCLOSING body sees it too**, which is what makes `inner(x)`
      // a DIRECT call. Leaving it out would make every one of the 159 sites a
      // thunk round-trip through a function value, which works and is far more
      // expensive than it looks.
      //
      // `b.functionNames` is this function's own copy — `lowerFunction` makes a
      // fresh `visible` for every one — so this does not leak the name to the
      // module. A leaked name would let an unrelated function call one it cannot
      // see, and the symptom would be a wrong answer three functions away.
      b.functionNames.add(name);
      // Nothing is emitted here: a declaration is not an expression. If the name
      // is also read as a VALUE later, `lowerExpr`'s `Identifier` case turns it
      // into a `fnvalue` on its own, because it is now in `functionNames`.
      break;
    }
    case "SwitchStatement": {
      // `switch x { case a { A } case b { B } default { C } }` lowers to a chain
      // of comparisons, and the chain is the whole of it: the `else` of one test
      // IS the next test, and the last one's `else` is the default's body.
      //
      // That is exact for this language's semantics, which the JS backend states
      // in one line: cases are block-scoped with NO fall-through. Every case body
      // therefore leaves, and a tail that is not already a `return`/`throw`/
      // `break` gets a jump to the shared exit. A `break` inside a case lowers to
      // that same jump, which is why the switch is pushed as a break SCOPE.
      const sw = stmt as any;
      const exit = `swend_${freshTemp()}`;

      // The discriminant is read ONCE. Re-reading it per case would run a call
      // N times, and a switch that calls a function has to see one value.
      const discT = freshTemp();
      b.emit({ op: "assign", target: discT, value: lowerExpr(sw.discriminant, b) } as any);

      const cases: any[] = sw.cases ?? [];
      // A `default` is located by its null test and emitted last, wherever it was
      // written. That is the same rule a reader applies — it runs only when
      // nothing matched — and it keeps the chain a chain.
      const tested = cases.filter((c) => c.test !== null && c.test !== undefined);
      const fallback = cases.find((c) => c.test === null || c.test === undefined) ?? null;

      b.scopes.push({ breakLabel: exit, continueLabel: null });

      let first = true;
      for (const c of tested) {
        const thenLabel = `swthen_${freshTemp()}`;
        const nextLabel = `swelse_${freshTemp()}`;
        const eq = freshTemp();
        b.emit({
          op: "binop",
          target: eq,
          operator: "==",
          left: { kind: "temp", id: discT },
          right: lowerExpr(c.test, b),
        } as any);
        const term: any = {
          op: "branch",
          condition: { kind: "temp", id: eq },
          thenLabel,
          // The MERGE, not the next test. The emitter reads `elseLabel` as the
          // merge and finds the else arm by POSITION, and pointing it at the
          // next test instead made the merge the `else` block's own entry: the
          // chain lost its else arm, and the default body was emitted after the
          // switch — so every case ran and then the default ran too.
          elseLabel: exit,
          // The next test — or the default, or the exit itself when this was the
          // last test — is the else arm of this one. That is what makes the chain
          // a chain, and the emitter needs the label because a case body holding
          // a nested `if` does not end where its last jump is.
          elseArm: nextLabel,
        };
        // Only the FIRST test carries the marker: it is the one that opens the
        // `block` the emitter wraps the whole chain in. Every later test is part
        // of that chain and must not open a second one.
        if (first) {
          term.switchExit = exit;
          first = false;
        }
        b.terminate(term);

        b.startBlock(thenLabel);
        for (const s of c.consequent) lowerStatement(s, b);
        if (!b.isTerminated()) b.terminate({ op: "jump", target: exit });

        // The next test, or the default, starts here.
        b.startBlock(nextLabel);
      }

      if (fallback) {
        for (const s of fallback.consequent) lowerStatement(s, b);
        if (!b.isTerminated()) b.terminate({ op: "jump", target: exit });
      } else {
        b.terminate({ op: "jump", target: exit });
      }
      b.scopes.pop();

      b.startBlock(exit);
      break;
    }
    case "WhileStatement": {
      const header = `loop_${freshTemp()}`;
      const body = `body_${freshTemp()}`;
      const after = `after_${freshTemp()}`;

      // Jump into the header.
      b.terminate({ op: "jump", target: header });

      b.startBlock(header);
      // Re-test the condition every iteration.
      const cond = lowerExpr((stmt as any).condition, b);
      b.terminate({ op: "branch", condition: cond, thenLabel: body, elseLabel: after });

      b.startBlock(body);
      // `break` leaves the loop and `continue` goes back to the header, which the
      // emitter reads as a `br` and a `br 0` respectively.
      b.scopes.push({ breakLabel: after, continueLabel: header });
      for (const s of stmt.body) lowerStatement(s, b);
      b.scopes.pop();
      // Back edge to the header — this is what makes it a loop.
      b.terminate({ op: "jump", target: header });

      b.startBlock(after);
      break;
    }
    case "BreakStatement": {
      const scope = b.scopes[b.scopes.length - 1];
      if (!scope) {
        b.diagnostics.push("`break` está fuera de un bucle o un switch");
        break;
      }
      b.terminate({ op: "jump", target: scope.breakLabel });
      break;
    }
    case "ContinueStatement": {
      const scope = [...b.scopes].reverse().find((s) => s.continueLabel);
      if (!scope) {
        b.diagnostics.push("`continue` está fuera de un bucle");
        break;
      }
      // A `continue` whose innermost scope is a `switch` lands on a point AFTER
      // the switch, and a wasm `br` can only reach an ENCLOSING construct. Every
      // construct between here and the loop's step is an `if` inside the switch's
      // own `block`, so the jump has no target: branching to the innermost one
      // lands at the end of that `if` and then falls THROUGH the rest of the
      // case, running the code after the `continue`. Named rather than emitted
      // wrong — and absent from the whole corpus, where no `continue` sits
      // inside a `switch`.
      const innermost = b.scopes[b.scopes.length - 1];
      if (innermost && innermost.continueLabel === null) {
        b.diagnostics.push(
          "`continue` dentro de un `switch` todavía no está soportado por el backend de WebAssembly",
        );
      }
      b.terminate({ op: "jump", target: scope.continueLabel! });
      break;
    }
    case "ForStatement": {
      // `for v in xs` is a loop over a range or an iterable. Ranges are the
      // common case and lower directly; an arbitrary iterable is not yet
      // representable in this IR, so it is compiled as a zero-trip loop
      // rather than emitting something that silently computes a wrong value.
      const loopVar = (stmt as any).variable;
      const iterable = (stmt as any).iterable;

      // Evaluate the bound once, before the loop.
      let start: IRValue | null = null;
      let end: IRValue | null = null;
      if (
        iterable &&
        iterable.type === "BinaryExpression" &&
        iterable.operator === ".."
      ) {
        start = lowerExpr(iterable.left, b);
        end = lowerExpr(iterable.right, b);
      }

      if (start && end && loopVar && loopVar.type === "Identifier") {
        const idx = freshTemp();
        b.emit({ op: "declare", kind: "let", name: loopVar.name, value: start });
        b.emit({ op: "assign", target: idx, value: { kind: "ref", name: loopVar.name } });

        const header = `for_${freshTemp()}`;
        const body = `forbody_${freshTemp()}`;
        const step = `forstep_${freshTemp()}`;
        const after = `forafter_${freshTemp()}`;

        b.terminate({ op: "jump", target: header });

        b.startBlock(header);
        // condition: idx <= end
        const cmpT = freshTemp();
        b.emit({
          op: "binop",
          target: cmpT,
          operator: "<=",
          left: { kind: "temp", id: idx },
          right: end,
        });
        b.terminate({ op: "branch", condition: { kind: "temp", id: cmpT }, thenLabel: body, elseLabel: after });

        b.startBlock(body);
        // A range loop's `continue` goes to the STEP, like an iterable's.
        b.scopes.push({ breakLabel: after, continueLabel: step });
        for (const s of stmt.body) lowerStatement(s, b);
        b.scopes.pop();
        if (!b.isTerminated()) b.terminate({ op: "jump", target: step });

        b.startBlock(step);
        // idx = idx + 1, and the visible loop variable tracks it.
        const one = freshTemp();
        b.emit({ op: "literal", target: one, value: 1, kind: "number" });
        const incT = freshTemp();
        b.emit({
          op: "binop",
          target: incT,
          operator: "+",
          left: { kind: "temp", id: idx },
          right: { kind: "temp", id: one },
        });
        b.emit({ op: "assign", target: idx, value: { kind: "temp", id: incT } });
        b.emit({ op: "assign", target: loopVar.name, value: { kind: "temp", id: idx } });
        b.terminate({ op: "jump", target: header });

        b.startBlock(after);
      } else {
        // Iterate an ARRAY. An array is an i32 address to a block laid out as
        // `[len: i32][pad: i32][elem0: f64]…`, so the loop reads the length
        // header and strides 8 bytes per element — the same shape the emitter
        // already encodes for `while`, so the block graph below is identical.
        const seq = lowerExpr(iterable, b);
        const counter = freshTemp();
        // How the elements of THIS array must be read. A numeric array holds
        // f64 slots; an array of records holds i32 addresses. The lowering is
        // the only place that knows, so it records it per array — under both
        // the temp it produced and the name it was bound to.
        const seqKey = seq.kind === "temp" ? seq.id : seq.kind === "ref" ? seq.name : "";
        const asAddress = b.arrays.get(seqKey) === "address";

        // counter = 0
        const zero = freshTemp();
        b.emit({ op: "literal", target: zero, value: 0, kind: "number" });
        b.emit({ op: "declare", kind: "let", name: counter, value: { kind: "temp", id: zero } });

        // len = i32.load(seq) — the length header at offset 0.
        const lenT = freshTemp();
        b.emit({ op: "arraylength", target: lenT, array: seq } as any);

        const header = `for_${freshTemp()}`;
        const body = `forbody_${freshTemp()}`;
        const step = `forstep_${freshTemp()}`;
        const after = `forafter_${freshTemp()}`;

        b.terminate({ op: "jump", target: header });

        b.startBlock(header);
        // condition: counter < len
        const cmpT = freshTemp();
        b.emit({
          op: "binop",
          target: cmpT,
          operator: "<",
          left: { kind: "ref", name: counter },
          right: { kind: "temp", id: lenT },
        });
        b.terminate({ op: "branch", condition: { kind: "temp", id: cmpT }, thenLabel: body, elseLabel: after });

        b.startBlock(body);
        // Bind the loop variable to the current element BEFORE the body runs,
        // so `t = t + v` sees this iteration's value.
        //
        // `elementref` reads the SLOT, not the value stored in it: an element
        // may itself be a record, and then the slot holds its ADDRESS. Reading
        // it as an f64 turned the address into a denormal double, so `o.v`
        // read garbage and the loop accumulated 15 instead of 3.
        if (loopVar && loopVar.type === "Identifier") {
          const elemT = freshTemp();
          // Bind the loop variable's slot BEFORE the element is read, so the
          // emitter types it as the element's kind (i32 for a record address)
          // rather than inferring a double from the temporary.
          b.declareLoopVar(loopVar.name, asAddress ? "address" : "number");
          b.emit({
            op: "elementref",
            target: elemT,
            array: seq,
            index: { kind: "ref", name: counter },
            asAddress,
          } as any);
          b.emit({ op: "assign", target: loopVar.name, value: { kind: "temp", id: elemT } });
        }
        // `continue` in a for-loop goes to the STEP, which the next iteration
        // re-enters through. Without publishing the scope a `continue` here was
        // reported as "outside a loop" while it plainly was not.
        b.scopes.push({ breakLabel: after, continueLabel: step });
        for (const s of stmt.body) lowerStatement(s, b);
        b.scopes.pop();
        if (!b.isTerminated()) b.terminate({ op: "jump", target: step });

        b.startBlock(step);
        const one = freshTemp();
        b.emit({ op: "literal", target: one, value: 1, kind: "number" });
        const incT = freshTemp();
        b.emit({
          op: "binop",
          target: incT,
          operator: "+",
          left: { kind: "ref", name: counter },
          right: { kind: "temp", id: one },
        });
        b.emit({ op: "assign", target: counter, value: { kind: "temp", id: incT } });
        b.terminate({ op: "jump", target: header });

        b.startBlock(after);
      }
      break;
    }
    case "BlockStatement":
    case "Program": {
      for (const s of (stmt as any).body) lowerStatement(s, b);
      break;
    }
    case "ThrowStatement": {
      // `throw` parks the value in the module's exception slot. Where it goes
      // next is the same question a `return` asks: inside a `try` body it is
      // the slot test just outside, and at the top of a function it leaves.
      const t = freshTemp();
      if ((stmt as any).value) {
        b.emit({ op: "excthrow", target: t, value: lowerExpr((stmt as any).value, b) } as any);
      } else {
        b.emit({ op: "excthrow", target: t } as any);
      }
      const frame = b.tryAfters[b.tryAfters.length - 1];
      b.terminate(
        frame ? ({ op: "jump", target: frame.check } as any) : ({ op: "return", value: null } as any),
      );
      break;
    }
    case "TryCatchStatement": {
      // `try { A } catch (e) { B }` lowers to: clear the slot, run A, and if it
      // came back set, bind `e` to it and run B. The slot is the only state
      // involved, because the failure may have happened in a CALLEE — which is
      // every `throw` in the corpus.
      const after = `tryafter_${freshTemp()}`;
      const handler = `trycatch_${freshTemp()}`;
      const check = `trycheck_${freshTemp()}`;

      b.emit({ op: "excclear" } as any);
      // Inside a `try` body a call must NOT propagate: leaving the function
      // would skip the very `catch` meant to handle it. The enclosing `try`
      // checks the slot itself.
      const frame = { after, check, value: null as IRValue | null };
      b.tryAfters.push(frame);
      // `tryBlock` and `catchBlock` are the STATEMENT ARRAYS themselves, not
      // objects with a `body`. Reading `tryBlock.body` gave `undefined`, so
      // `?? []` iterated nothing and both bodies vanished — a `try` whose
      // contents were never lowered, which read as "the return is unreachable"
      // rather than as a missing field.
      for (const s of ((stmt as any).tryBlock ?? []) as Statement[]) lowerStatement(s, b);
      b.tryAfters.pop();

      // The slot test, wherever the body left off — straight on, or through the
      // trampoline a `return` inside the body jumped to.
      if (b.isTerminated()) b.startBlock(check);
      {
        const testT = freshTemp();
        b.emit({ op: "exctest", target: testT } as any);
        b.terminate({
          op: "branch",
          condition: { kind: "temp", id: testT },
          thenLabel: handler,
          elseLabel: after,
          // No else arm: the false side IS the merge. Saying so explicitly keeps
          // the emitter from having to infer it.
          elseArm: after,
        } as any);
      }

      b.startBlock(handler);
      const param = (stmt as any).catchParam?.name ?? (stmt as any).catchParam;
      if (param) {
        const slotT = freshTemp();
        b.emit({ op: "excload", target: slotT } as any);
        b.emit({ op: "declare", kind: "const", name: param, value: { kind: "temp", id: slotT } } as any);
      }
      for (const s of ((stmt as any).catchBlock ?? []) as Statement[]) lowerStatement(s, b);
      if (!b.isTerminated()) b.terminate({ op: "jump", target: after });
      b.emit({ op: "excclear" } as any);

      b.startBlock(after);
      // A `return` inside the try body jumped here to go out THROUGH the slot
      // check, so the value it carried is returned from here.
      if (frame.value) b.terminate({ op: "return", value: frame.value } as any);
      // A `finally` runs on both paths, and this backend has no way to place a
      // block that is emitted on the way out of an `if` — so it is reported
      // rather than run on the happy path only, which would be a different
      // program from the one written.
      if ((stmt as any).finallyBlock) {
        b.diagnostics.push("`finally` todavía no está soportado por el backend de WebAssembly");
      }
      break;
    }
    case "ClassDeclaration":
    case "ClassExpression": {
      lowerClass(stmt, b);
      break;
    }
    case "InterfaceDeclaration":
    case "TypeAliasDeclaration":
    // A UNION is a third spelling of the same idea, and it is the one a guess
    // misses: `type Shape = Circle | Square` parses as an `ADTDeclaration`, not as
    // a type alias. Measured rather than assumed.
    case "ADTDeclaration": {
      // Nothing to lower, and nothing that COULD be lowered. An interface and a type
      // alias exist only for the type checker; neither has a run-time value, so
      // neither needs a binding.
      //
      // Measured on the corpus: four interfaces across two files, and not one of them
      // read as a value. `tokens.no` uses one inside another in a FIELD declaration —
      // a type position — and `features.no` says so in its own comment:
      //
      //     // ── Interfaces (type-only, stripped from JS) ──
      //
      // **The JavaScript backend already strips them, and this one did not.** Four
      // programs were refused for a declaration that emits no code, which is the same
      // mistake as refusing an `import`: a name only the type checker can see was
      // being asked for a run-time binding.
      break;
    }
    case "ImportDeclaration": {
      // Nothing to lower. An import binds NAMES, and the program linker puts
      // every function of every file in ONE wasm module and rewrites the callee
      // to the file that owns it. Without the linker an imported name resolves
      // to nothing, and the emitter says so rather than dropping the call.
      break;
    }
    case "ExportDeclaration": {
      // Nothing to lower. An import binds NAMES, and this backend puts every
      // function of every file of a program in ONE wasm module — so the name a
      // call uses is already there, and `ir-modules.ts` rewrites the callee to
      // the file that owns it. An export only says which of this file's
      // functions another file may name.
      //
      // Without the linker a call through an imported name resolves to nothing,
      // and the emitter now SAYS so rather than dropping the call.
      break;
    }
    default: {
      // Say what is missing. This used to emit a placeholder string and carry
      // on, so a function whose returns all sat inside an unsupported statement
      // compiled to a VOID function — and its callers used a value that was
      // never produced. `fmtExpression` in the real formatter was compiled
      // that way: 53 functions of a formatter, and the compiler reported
      // nothing at all. The construct is named, the file does not compile, and
      // the gap is a sentence instead of a mystery three functions away.
      b.diagnostics.push(
        `sentencia "${stmt.type}" todavía no está soportada por el backend de WebAssembly`,
      );
      b.emit({
        op: "exprstmt",
        value: { kind: "lit", value: `/* unsupported: ${stmt.type} */`, litType: "string" },
      });
      break;
    }
  }
}

/**
 * True when the lowering can PROVE the receiver of a method call holds a string.
 *
 * BUG-WASM-69. One case today — a name bound to a string literal — and that is the
 * point: the rule asks for evidence rather than for the absence of a contradiction, so
 * every receiver this cannot prove keeps the dispatch it had before. An `x` that is a
 * list, a record, or a value a called function returned all stay where they were.
 *
 * The other direction is already spoken for: `b.arrays` says a name is a list, and it
 * is asked in the LIST branch, which is unchanged.
 */
/**
 * The name an IR value answers to: a temp's id, or a binding's name. "" for a literal.
 *
 * BUG-WASM-69. A literal is not a name and carries no mark, which is correct — there is
 * nothing to look up.
 */
function nameOfValue(v: any): string {
  if (v?.kind === "temp") return String(v.id);
  if (v?.kind === "ref") return String(v.name);
  return "";
}

/** True when the value is a NAME, or a temp, that the builder proved holds a string. */
/**
 * BUG-WASM-86. **Say that `name` holds a string, in BOTH the places that decide.**
 *
 * Two, and they are not the same place. `b.stringNames` is what the LOWERING reads —
 * `isProvedStringValue` asks it, and it decides whether a `+` concatenates or is refused.
 * `stringSeeds` is what the EMITTER reads: its own fixed point claims every name in
 * `mod.stringSeeds[fn]` before it looks at an instruction, and `isStringValue` asks the set
 * that produces.
 *
 * Marking only the first produced a VALID block of length 1 holding the LAST piece: the
 * temporary was a string to the lowering and a number to the emitter, the `+` took the
 * one-side path, and nothing said so. `stringSeeds` is the channel the project already
 * opened for "the fact the emitter is missing" (STRING-SEED-75).
 *
 * The name is claimed under the builder's own function, because a seed belongs to the
 * function it is claimed in.
 */
function markString(name: string, b: BlockBuilder): void {
  b.stringNames.add(name);
  if (b.currentFunctionName) (stringSeeds[b.currentFunctionName] ??= []).push(name);
}

/** True when the value is a NAME, or a temp, the builder proved holds a string. */
function isProvedStringValue(v: any, b: BlockBuilder): boolean {

  const n = nameOfValue(v);
  return !!n && b.stringNames.has(n);
}

/**
 * BUG-WASM-88. **Is this a NUMBER the AST can prove?** A literal, a unary over one, and a
 * chain of the arithmetic operators over two of them — recursively, with no state and
 * nothing to converge, because there is nothing to remember.
 *
 * The census that asked for it is 636 chains and 309 of them a single `text + x`, so this
 * answers the biggest remaining question in the project for the one leaf whose type is
 * knowable at the point the `+` is lowered.
 *
 * **A POSITIVE proof, and that is the whole safety of it.** A variable, a list and a call
 * all answer false, and the list is why: JavaScript concatenates `[1,2]` as "1,2", while
 * `numToStr` answers the empty string, so wrapping it would replace a refusal with a wrong
 * answer. This has been refused on BUG-WASM-64, 85 and 87 and it is refused here too.
 */
function isProvedNumberExpr(node: any): boolean {
  if (!node) return false;
  if (node.type === "Literal") {
    const t = node.literalType ?? (typeof node.value);
    return t === "number";
  }
  // BUG-WASM-90. A field the parameter's annotation declares as a number, so `"x" + c.n`
  // is rendered instead of refused. Without this the annotation only settles HALF the
  // question: a string field is proved and a number field still stops the `+`.
  if (annotatedFieldIs(node, "number")) return true;
  if (node.type === "UnaryExpression") {
    if (node.operator === "-" || node.operator === "+") return isProvedNumberExpr(node.argument);
    return false;
  }
  if (node.type === "BinaryExpression") {
    if (node.operator === "+" || node.operator === "-" || node.operator === "*" || node.operator === "/" || node.operator === "%") {
      return isProvedNumberExpr(node.left) && isProvedNumberExpr(node.right);
    }
    return false;
  }
  return false;
}

/**
 * BUG-WASM-91. **A string where a TRUTH is asked for, refused by name.**
 *
 * A string is an i32 ADDRESS, and that address is never 0 — not even the empty string's,
 * which is a real block with a real header. So `? :`, `!`, `&&`, `||` and `??` are all
 * reading the ADDRESS and all answering "yes", and each of them is wrong:
 *
 *     "" ? "SI" : "NO"  ->  "SI"   want "NO"   (non-zero, so it branches true)
 *     !""                 ->  0      want 1       (i32.eqz of non-zero)
 *     "a" || "b"          ->  "b"    want "a"    (i32.or of two addresses)
 *     "a" ?? "b"          ->  ""     want "a"    (same)
 *
 * The addresses are the proof: a lone `"a"` is 12, `"a" || "b"` returned 28 and
 * `"a" ?? "b"` returned 40 — **neither is an operand's address.** All four compiled
 * with zero diagnostics and a valid module, and that is the part worth writing down:
 * nothing in the output says the answer is wrong.
 *
 * This is a REFUSAL, not an implementation. Doing it properly means loading the u32
 * length at the head of a string block and comparing it against 0, which is real work in
 * the emitter and is not this change's. Until that exists, the refusal is the honest
 * answer, and it is what the house contract asks for: a hole is refused by NAME.
 *
 * **WASM ONLY, for BUG-WASM-77's reason** — the lowering is shared and in JavaScript `""`
 * really is falsy. The gate is HERE, inside the helper, because the three call sites are
 * exactly where one of the three would forget the target and stop a working backend from
 * compiling something it was about to get right.
 *
 * Returns true when it refused, so a caller reports at most one message per operator
 * instead of one per operand.
 */
const TRUTHY_OPS = new Set(["&&", "||", "??"]);

function refuseStringTruthiness(b: BlockBuilder, where: string, v: any): boolean {
  if (!forWasm) return false;
  if (!isProvedStringValue(v, b)) return false;
  b.diagnostics.push(
    "una cadena no puede ocupar la posicion de verdad (`" + where + "`): su verdad es " +
      "«no esta vacia» y una direccion de cadena nunca es 0 —ni la de la cadena vacia—, " +
      "asi que el operador decide por la direccion y no por el texto. Compara con " +
      "`s.length > 0`, o escribe el `?` sobre una condicion que no sea una cadena.",
  );
  return true;
}

/**
 * BUG-WASM-88. **`numStrOf(value)` — the wrap, in one place.**
 *
 * BUG-WASM-86 wrote these four lines inside the template's chain, and this is the second
 * caller. Two copies of a rule that must agree is the family this file has paid for three
 * times today, so the helper was written before the second use rather than after it.
 *
 * It marks the result in both places at once — `b.stringNames` for the lowering and
 * `stringSeeds` for the emitter — through `markString`, for the reason in that function's
 * comment: marking only one of them is what produced a valid block holding the last piece
 * of a concatenation and nothing else.
 */
function numStrOf(value: IRValue, b: BlockBuilder): IRValue {
  const helper = ensureGlobalFunction(b, "numToStr") ?? "numToStr";
  const t = freshTemp();
  b.emit({ op: "call", target: t, callee: { kind: "ref", name: helper }, args: [value], indirect: false } as any);
  markString(t, b);
  return { kind: "temp", id: t };
}

function receiverIsProvedString(receiver: any, b: BlockBuilder): boolean {

  if (receiver?.type === "Identifier") return b.stringNames.has(receiver.name);
  // BUG-WASM-88. An expression this lowering has ALREADY proved. Asked first, because a
  // chain's inner link is answered before its parent is reached, and the parent's only
  // other question is about the AST it is holding — which no mark on a temporary can answer.
  if (receiver && typeof receiver === "object" && provedStringNodes.has(receiver)) return true;
  // A string literal in place
  // `"hola".indexOf("h")` — is proved by the same fact.
  if (receiver?.type === "Literal") {
    const t = receiver.literalType ?? (typeof receiver.value);
    return t === "string";
  }
  // A `+` whose two sides are both proved, which is `let s = "ho" + "la"`. The
  // recursion is the same one BUG-WASM-66 needed and the reason is the same: `a + b + c`
  // is left-associative, so a rule that only looked at literals would miss the left one.
  if (receiver?.type === "BinaryExpression" && receiver.operator === "+") {
    return receiverIsProvedString(receiver.left, b) && receiverIsProvedString(receiver.right, b);
  }
  // BUG-WASM-86. **A call to a function that returns a string is a string.** This function is
  // the THIRD place in this file that answers the question — the lowering asks `b.stringNames`
  // about lowered values, the emitter asks `isStringValue` about its own fixed point, and this
  // one asks about the AST — and it was the only one of the three that could not see a
  // function result. Same family as BUG-WASM-84: two rules for one fact, and the case nobody
  // had is where they part. Asked of the AST, so it asks a NAME-keyed set.
  if (receiver?.type === "CallExpression" && receiver.callee?.type === "Identifier") {
    return stringFns.has(receiver.callee.name);
  }
  // BUG-WASM-90. **A field the parameter's annotation declares as a string.** This is the
  // shape the census is dominated by, and it is the case the file ALREADY states in writing.
  if (annotatedFieldIs(receiver, "string")) return true;
  return false;

}

function lowerExpr(expr: Expression, b: BlockBuilder): IRValue {
  switch (expr.type) {
    case "Literal": {
      const t = freshTemp();
      const litType = expr.literalType ?? (typeof expr.value);
      // BUG-WASM-69. A string literal marks its own temporary, and the binding that
      // receives it inherits the mark. This is the only place a name is proved to hold
      // a string in the lowering, and it is what the STRING method branch asks.
      if (litType === "string") b.stringNames.add(t);
      b.emit({ op: "literal", target: t, value: expr.value, kind: litType as any });
      return { kind: "temp", id: t };
    }
    case "Identifier": {
      // `this` is the receiver parameter of the method being lowered, not a
      // binding. It resolves to an ordinary ref, so `this.x` lowers to a
      // `loadfield` on it — and the emitter's own rule (a parameter used as the
      // receiver of a field access IS a record) then types it as an address
      // with nothing said here.
      if (expr.name === "this" && b.thisBinding) return { kind: "ref", name: b.thisBinding };
      // A name that is a FUNCTION is a function VALUE here, not a reference to
      // a slot. Without this, `apply(twice, 21)` passed a name the emitter had
      // nothing to materialise for, and the argument came out as zero.
      if (b.functionNames.has(expr.name)) {
        const t = freshTemp();
        b.emit({ op: "fnvalue", target: t, fn: expr.name } as any);
        return { kind: "temp", id: t };
      }
      return { kind: "ref", name: expr.name };
    }
    // BUG-WASM-60: a `=>` is the same lambda. The parser is what differs — an arrow's
    // body may be a bare EXPRESSION where a `fn`'s is a list of statements — and it
    // is normalised to a `return` below, after which the two are one program.
    //
    // The JS generator emitted arrows all along and `renameBinding` already treated
    // one as a scope boundary, so the language had them; only this backend refused,
    // and refusing used to be a string literal rather than a sentence.
    case "ArrowFunction":
    case "FunctionExpression": {
      // A lambda is LIFTED to a module-level function and the expression becomes
      // a reference to it. There is nowhere else for a function value to live:
      // a function value is an index, and an index only exists for a function in
      // the module.
      //
      // Lifting the body is the easy half. The hard half is a CLOSURE — a
      // lambda that reads a name from the scope around it has to carry that
      // scope with it, and a lifted function shares none of it. Rather than
      // generate a lambda that quietly reads a global of the same name, the
      // capture is reported.
      const name = `__lambda${lambdaCounter++}`;
      const captures = [...freeVariablesOf(expr, b.functionNames)].sort();
      if (captures.length > 0) b.captures[name] = captures;
      const visible = new Set(b.functionNames);
      visible.add(name);
      // The captures become LEADING parameters, so the lifted function is
      // literally `fn __lambda0(k, v) { … }`. A closure's record is what carries
      // them there, through the thunk built for this one function.
      const captureParams = captures.map((c) => ({ type: "Param", name: c, rest: false }));
      b.lifted.push(
        lowerFunction(
          {
            name: { name },
            params: [...captureParams, ...expr.params],
            // BUG-WASM-61b: this object is REBUILT, so the parser's flags do not come
            // along for the ride. `implicitReturn` was dropped here, and the rule in
            // `lowerFunction` that reads it had nothing to read — the fix was right and
            // did nothing. The arrow below is not affected: an arrow's bare body was
            // already turned into a `return` on the line above.
            implicitReturn: (expr as any).implicitReturn,
            body: Array.isArray(expr.body)
              ? expr.body
              : [{ type: "ReturnStatement", value: expr.body } as any],
          },
          b.arrayKinds,
          b.loopVarKinds,
          visible,
          b.lifted,
          b.diagnostics,
          {},
          b.captures,
          undefined,
          true,
        ),
      );
      const t = freshTemp();
      b.emit({ op: "fnvalue", target: t, fn: name } as any);
      return { kind: "temp", id: t };
    }
    // BUG-WASM-64. A template literal with NO hole is a string, and 53 of the corpus's
    // 120 are exactly that. The value is the text, so nothing has to be decided.
    //
    // The 67 that DO have a hole are a refusal, and the refusal names the part that is
    // missing rather than the construct: a hole holding a string is concatenation this
    // backend already has, and a hole holding a number is a FORMATTING decision that
    // has not been made. The texts say which: they are log lines — "Age invalid: ",
    // "User created: ", "Validation failed on " — and an age is a number.
    //
    // `parts`, not `expressions`: the node is a list of Text parts and expression parts.
    case "TemplateLiteral": {
      const parts = (expr as any).parts ?? [];
      const holes = parts.filter((p: any) => p.kind !== "Text");
      // BUG-WASM-86. **There is no refusal here any more, and there is no new instruction
      // either.** A template is a left-leaning chain of `+`, and every link of that chain
      // already concatenated: measured, two pieces give "ab", three "abc" and four "abcd"
      // (`.mavis-probe/chain85.txt`). A hole holding a number is a piece, and the piece needs
      // a name — which is what BUG-WASM-85 built.
      //
      // **A hole holding a STRING is not wrapped**, and the refusal that used to fire for one
      // is the row that said two paths existed for one thing: `a${"b"}` was refused while
      // `"a" + "b"` worked. Wrapping a string in `numToStr` would be worse than refusing it —
      // that function answers the empty string for a value it cannot render, so the text would
      // disappear without a word.
      //
      // What the refusal said is not lost, it moved: `"a" + 1` written out by hand is STILL
      // refused, because a `+` is not a template and turning it into one would answer a
      // question nobody asked.

      // Text part, hole, text part, hole… — a left-leaning chain of `+`, which is
      // exactly the shape the JavaScript generator lowers a template to.
      let acc: IRValue | null = null;
      for (const p of parts) {
        let piece: IRValue;
        if (p.kind === "Text") {
          const t = freshTemp();
          b.emit({ op: "literal", target: t, value: p.value ?? "", kind: "string" });
          piece = { kind: "temp", id: t };
        } else {
          const value = lowerExpr(p.expression, b);
          if (isProvedStringValue(value, b)) {
            piece = value;
          } else if (forWasm) {
            // The wrap, and **WASM ONLY**: BUG-WASM-77's rule, that a number written into a
            // string is a decision the WebAssembly emitter cannot make yet and JavaScript's
            // `+` has always made. `tests/program.test.ts` is not a JavaScript backend — its
            // `runJs` is `emitIR(lowerToIR(ast))` — and without the gate the shared path got
            // the wrap too, where `allocblock` has no JavaScript form: a number went missing
            // and `Age invalid: ${age}` came back as `Age invalid: `.
            piece = numStrOf(value, b);
          } else {
            // The shared path's own answer, which is the one it has always given.
            piece = value;
          }
        }
        if (!acc) { acc = piece; continue; }
        const t = freshTemp();
        b.emit({ op: "binop", target: t, operator: "+", left: acc, right: piece });
        // **The mark the loop never made.** The `+` case in `lowerExpr` has always done this
        // one line; two paths for one thing is how the template came to refuse a hole holding
        // text while the same two pieces written with `+` worked.
        markString(t, b);

        acc = { kind: "temp", id: t };
      }
      if (!acc) {
        const empty = freshTemp();
        b.emit({ op: "literal", target: empty, value: "", kind: "string" });
        return { kind: "temp", id: empty };
      }
      return acc;
    }

    // BUG-WASM-63. Twenty programs. A ternary is the `if`/`else` above with the two
    // arms assigning ONE shared temp, and the merge block is where the value is.
    //
    // Measured before writing it, because this could have been an emitter change: eight
    // programs of plain `if`/`else` that assign one temp and read it back all pass
    // today, including one whose arms are strings, one inside a loop and a nested
    // `if` inside an arm. **A branch already produces a value through a merge block**
    // — the `IfStatement` shape was always emitted, nobody had read the result back.
    //
    // So this is a lowering change with no new IR node and no new opcode, which is the
    // same property that made the string methods cheap.
    case "TernaryExpression": {
      const result = freshTemp();
      const cond = lowerExpr(expr.condition, b);
      // BUG-WASM-91. A string CONDITION is the case that looks most supported — the arms
      // are ordinary values and the branch is real, so nothing else reads as odd.
      refuseStringTruthiness(b, "la condicion de un `? :`", cond);

      const thenLabel = `then_${freshTemp()}`;
      const elseArmLabel = `else_${freshTemp()}`;
      const endLabel = `end_${freshTemp()}`;

      b.terminate({ op: "branch", condition: cond, thenLabel, elseLabel: endLabel, elseArm: elseArmLabel });

      // **The value is lowered BEFORE the assign**, because `lowerExpr` emits into the
      // current block and the assign has to land after it. Written the other way round
      // the two would be in the wrong order inside the same block.
      b.startBlock(thenLabel);
      const yes = lowerExpr(expr.consequent, b);
      b.emit({ op: "assign", target: result, value: yes } as any);
      if (!b.isTerminated()) b.terminate({ op: "jump", target: endLabel });

      b.startBlock(elseArmLabel);
      const no = lowerExpr(expr.alternate, b);
      b.emit({ op: "assign", target: result, value: no } as any);
      if (!b.isTerminated()) b.terminate({ op: "jump", target: endLabel });

      // The merge. `b.current` is the inner merge if an arm was itself a ternary, and
      // that is the same tail-of-the-arm shape a nested `if` already produces.
      b.startBlock(endLabel);
      return { kind: "temp", id: result };
    }

    case "BinaryExpression": {
      let left = lowerExpr(expr.left, b);
      let right = lowerExpr(expr.right, b);
      // BUG-WASM-88. **A number the AST can prove is not a hole — it is the format
      // question with an answer.**
      //
      // A template has been wrapping its numeric hole in `numToStr` since BUG-WASM-86, and
      // the corpus writes `"prefijo: " + n` more often than it writes a hole. A literal's
      // type is known HERE, at the point the `+` is lowered, so this needs no analysis and
      // no fact from another file — which is why it is the one leaf of the 636 chains that
      // is answerable today.
      //
      // **WASM ONLY, and for BUG-WASM-77's reason**: JavaScript's `+` has always made this
      // decision, and the shared lowering is what `tests/program.test.ts` runs, so wrapping
      // there would replace the reference rule with this backend's answer.
      let numStrAnswered = false;
      if (forWasm && expr.operator === "+") {
        // The mark for an annotated field is NOT here. It was, and it was the wrong floor:
        // it fired only when the field was an OPERAND of a `+`, and the two places that read
        // it through a binding — a declaration's value, an argument, a return — got nothing.
        // It is in the `MemberExpression` case now, where the field is lowered.
        const leftIsText = receiverIsProvedString(expr.left, b);
        const rightIsText = receiverIsProvedString(expr.right, b);
        if (leftIsText !== rightIsText) {
          if (leftIsText && isProvedNumberExpr(expr.right)) {
            right = numStrOf(right, b);
            numStrAnswered = true;
          } else if (rightIsText && isProvedNumberExpr(expr.left)) {
            left = numStrOf(left, b);
            numStrAnswered = true;
          }
        }
      }
      // BUG-WASM-66. `+` concatenates only when BOTH sides are strings, and the emitter
      // is the only place that knows which a value is — so the refusal went there, as a
      // `throw`, and the gate failed on it: "the compiler must never throw on real code",
      // with three corpus programs reporting `threw`. The emitter has no channel for a
      // refusal and this one does.
      //
      // **The case the AST can answer is a string LITERAL on one side and something
      // unknown on the other**, and it is the common one: "prefijo: " + x, x + "!",
      // "Ruta: " + ruta. It answered 1634496360 in one shape and 0 in the other, with no
      // diagnostic of any kind.
      //
      // **What this does not catch: `s + t` with neither side known.** Both look like
      // numbers, so they add, and if they were strings the answer is a denormal.
      // Telling those apart needs the question that is still open, so it is written here
      // rather than guessed at.
      // BUG-WASM-91. The sibling of the `+` refusal below, and it belongs beside it
      // because both are one question: what does this operator mean on this type. One
      // diagnostic per operator — the first operand that is a string names it.
      if (TRUTHY_OPS.has(expr.operator)) {
        if (!refuseStringTruthiness(b, "el operando de `" + expr.operator + "`", left)) {
          refuseStringTruthiness(b, "el operando de `" + expr.operator + "`", right);
        }
      }
      // BUG-WASM-92. **`??` is not an operator here yet — it is an addition, silently.**
      //
      // Measured on numbers: `1 ?? 9` is 10, which is `1 + 9`, and so is `9 ?? 1`. The
      // emitter's `LOGICAL_OPS` does not list `??`, so it reaches `getBinOpcode`'s
      // `default`, and that default is `f64.add`.
      //
      // Refused rather than fixed, because: it is wrong for EVERY type, so there is no
      // safe subset to keep — which is exactly what separates it from `&&` and `||`, wrong
      // for arbitrary numbers but right for 0/1, this language's boolean. Nothing in the
      // suite executes `??`; the four in `tests/` are the harness's TypeScript, a lexer
      // token list, and `e2e.test.ts` checking that the JAVASCRIPT output still says
      // `a ?? b`, which never came through here. And doing it properly is a null check,
      // which needs the branch-based lowering the `? :` already gets right.
      if (forWasm && expr.operator === "??") {
        b.diagnostics.push(
          "el operador `??` todavia no esta implementado en el backend de WebAssembly: " +
            "no es un opcode sino una comprobacion de nulo, y ahora mismo se compila " +
            "como una suma (`1 ?? 9` daria 10). Se implementara con ramas, como el `? :`.",
        );
      }
      if (expr.operator === "+") {

        // BUG-WASM-71. **This predicate only knew about literals, and it refused
        // `s + "x"` and `"x" + s`** — concatenations that have worked since BUG-WASM-49.
        // No test caught it, because every concatenation test in the suite uses two
        // literals; it was found by a probe whose CONTROL program was a `+`.
        //
        // The two rules needed the same predicate and I wrote them separately, which is
        // the mistake. `receiverIsProvedString` knows an Identifier, a Literal and a `+`,
        // and it is the one answer to "is this a string" that the lowering has.
        //
        // BUG-WASM-77: **WASM ONLY.** A number written into a string is a decision the
        // WebAssembly emitter cannot make yet, and JavaScript's `+` has always made it.
        // Claiming it from the shared pass stopped a working backend from compiling
        // something it was about to get right, with 1001 tests green and none of them
        // covering it.
        // BUG-WASM-88. `numStrAnswered` is this function saying "that side is a number and I
        // rendered it", so the refusal does not re-open the question it just closed. Without
        // it the two halves disagreed about the SAME expression twenty lines apart: the wrap
        // replaced the IR value and the refusal asked the AST node, which the wrap never
        // touched. **Teaching `receiverIsProvedString` about numbers instead would be a second
        // rule for one fact, in the exact place this file has been bitten by it three times
        // today.**
        if (forWasm && !numStrAnswered && receiverIsProvedString(expr.left, b) !== receiverIsProvedString(expr.right, b)) {

          b.diagnostics.push(
            "`+` con una cadena y un valor cuyo tipo no se conoce: escribir un número " +
              "en una cadena es una decisión de formato y no se ha tomado. " +
              "Concatenar exige que los dos lados sean cadenas.",
          );
        }
      }
      const t = freshTemp();
      // BUG-WASM-69. A `+` of two proved strings is a proved string, and the binding
      // that receives it inherits the mark — which is what lets `"ho" + "la"` be a
      // string receiver. Without this the two halves of the rule disagreed: the proof
      // understood a `+` IN PLACE, and did not understand a `+` BEHIND A NAME.
      //
      // Asked of the IR values, not of the AST: a literal's temporary only exists once
      // `lowerExpr` has run, so the AST node is not the thing that has the mark.
      if (expr.operator === "+" && isProvedStringValue(left, b) && isProvedStringValue(right, b)) {
        b.stringNames.add(t);
        // BUG-WASM-88. And the NODE, so the `+` above this one — in a chain, the parent —
        // can see it. The temp's mark is for a name that comes later; this one is for the
        // parent that has already arrived.
        provedStringNodes.add(expr as unknown as object);
      }
      b.emit({ op: "binop", target: t, operator: expr.operator, left, right });
      return { kind: "temp", id: t };
    }
    case "UnaryExpression": {
      const arg = lowerExpr(expr.argument, b);
      // BUG-WASM-91. `!` is `i32.eqz` on a non-zero address, so `!""` is 0 rather than 1.
      // The empty string is the only string it gets wrong, and it is the one that matters.
      // `-` and `+` are arithmetic and are not asked here.
      if (expr.operator === "!") refuseStringTruthiness(b, "el operando de `!`", arg);
      const t = freshTemp();
      b.emit({ op: "unaryop", target: t, operator: expr.operator, argument: arg });
      return { kind: "temp", id: t };
    }
    case "CallExpression": {
      // A METHOD call on a value: `a.push(x)`. Lowered to its own instruction
      // rather than a field access plus a call, because this backend has no
      // runtime to dispatch a method — `a.push` would load a field named
      // "push", which does not exist.
      const calleeExpr: any = expr.callee;
      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.property as any)?.name === "push"
      ) {
        const base = lowerExpr(calleeExpr.object, b);
        const value = expr.arguments.length
          ? lowerExpr(expr.arguments[0], b)
          : { kind: "lit", value: 0, litType: "number" } as IRValue;
        const t = freshTemp();
        b.emit({ op: "arraypush", target: t, array: base, value } as any);
        return { kind: "temp", id: t };
      }

      // **BUG-WASM-83. The two PRIMITIVES that make text out of a number.**
      //
      // They sit next to `push` because that is what they are: a call whose callee is
      // a bare name the language itself gives a meaning to, lowered to its own
      // instruction rather than to a function. `allocblock(16)` reserves sixteen
      // bytes; `storebyte(b, i, v)` writes one.
      //
      // Checked HERE, above the generic call path, so a program that uses them does
      // not reach the BUG-WASM-82 refusal that says the module has no such name. The
      // refusal is right about a name nobody defined and wrong about two the language
      // defines.
      if (calleeExpr?.type === "Identifier" && calleeExpr.name === "allocblock") {
        // ONE argument, and the refusal says so. BUG-WASM-81 wrote `allocblock(b, n)` —
        // a kind and a size — and the kind has no meaning here: the block is a string
        // block and its own tag says so. Taking the first argument silently would be
        // worse than refusing, because the program would get a block of the wrong size
        // and no way to know.
        if (expr.arguments.length !== 1) {
          b.diagnostics.push(
            `allocblock recibe el número de BYTES, y solo uno: \`allocblock(16)\``,
          );
          const bad = freshTemp();
          b.emit({ op: "literal", target: bad, value: 0, kind: "number" });
          return { kind: "temp", id: bad };
        }
        // The size into a temp of its own: the emitter needs it as a local, and this
        // is the same shape the `for` counter uses.
        const sizeT = freshTemp();
        b.emit({ op: "assign", target: sizeT, value: lowerExpr(expr.arguments[0], b) } as any);
        const t = freshTemp();
        b.emit({ op: "allocblock", target: t, size: { kind: "temp", id: sizeT } } as any);
        // **The block IS a string**, and these are the two tables that make the rest of
        // the language treat it as one: `arrays` is what turns `.length` into a header
        // read, and `stringNames` is what a string method dispatches on. The seed path
        // for a string parameter fills exactly these two and nothing else, so this is
        // the same pair of facts rather than a third place that knows what a string is.
        b.stringNames.add(t);
        b.arrays.set(t, "address");
        return { kind: "temp", id: t };
      }

      if (calleeExpr?.type === "Identifier" && calleeExpr.name === "storebyte") {
        if (expr.arguments.length !== 3) {
          b.diagnostics.push(
            `storebyte recibe bloque, índice y valor: \`storebyte(b, i, v)\``,
          );
          const bad = freshTemp();
          b.emit({ op: "literal", target: bad, value: 0, kind: "number" });
          return { kind: "temp", id: bad };
        }
        b.emit({
          op: "storebyte",
          block: lowerExpr(expr.arguments[0], b),
          index: lowerExpr(expr.arguments[1], b),
          value: lowerExpr(expr.arguments[2], b),
        } as any);
        // A void instruction in EXPRESSION position still owes its caller a value, and
        // the value is a NUMBER: a string placeholder here would be an address, and the
        // caller would go on using it as a number, far from here (BUG-WASM-58). The
        // statement path drops it, so `storebyte(…)` written on its own costs one dead
        // literal — which is cheaper than a second code path.
        const wrote = freshTemp();
        b.emit({ op: "literal", target: wrote, value: 0, kind: "number" });
        return { kind: "temp", id: wrote };
      }

      // `Math.min(a, b)` — a helper written in the language, like the list
      // methods, but with NO receiver in front of the arguments. It is checked
      // BEFORE the list-method branch below, because `isListMethod` does not know
      // about these names and a future one colliding with a list method would
      // otherwise be resolved by whichever table answered first.
      // BUG-WASM-80. `Math.floor/trunc/round/sqrt` are ONE OPCODE each, so they are a
      // `unaryop` and not a method written in the language — which is the whole reason
      // they are not in `MATH_METHODS`. Checked before the `Math` method branch below,
      // and before the list branch, for the same reason that one is: a name in two
      // tables belongs to whichever was reached first.
      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.object as any)?.type === "Identifier" &&
        (calleeExpr.object as any).name === "Math" &&
        expr.arguments.length === 1 &&
        MATH_UNARY_OPS.has(String((calleeExpr.property as any)?.name ?? ""))
      ) {
        const t = freshTemp();
        b.emit({
          op: "unaryop",
          target: t,
          operator: String((calleeExpr.property as any).name),
          argument: lowerExpr(expr.arguments[0], b),
        } as any);
        return { kind: "temp", id: t };
      }

      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.object as any)?.type === "Identifier" &&
        (calleeExpr.object as any).name === "Math" &&
        isMathMethod(String((calleeExpr.property as any)?.name ?? ""))
      ) {
        const method = String((calleeExpr.property as any).name);
        const helper = ensureMathMethod(b, method, b.functionNames);
        if (helper) {
          const args: IRValue[] = expr.arguments.map((a) => lowerExpr(a, b));
          const t = freshTemp();
          b.emit({ op: "call", target: t, callee: { kind: "ref", name: helper }, args, indirect: false, receiverFirst: true } as any);
          return { kind: "temp", id: t };
        }
      }

      // **A method of the class being lowered.** `this.m(…)` resolves HERE, and
      // lexically: the receiver is `this`, so the class is known and there is no
      // other object it could be. Without this the callee was `this.m` — a field
      // read of a field no record has — and the call went through the table to a
      // zero.
      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.property as any)?.name &&
        b.currentClass
      ) {
        const mn = String((calleeExpr.property as any).name);
        const impl = b.currentClass.methods.get(mn);
        if (impl) {
          const recv = lowerExpr(calleeExpr.object, b);
          const mArgs: IRValue[] = [recv];
          for (const a of expr.arguments) mArgs.push(lowerExpr(a, b));
          const tm = freshTemp();
          b.emit({ op: "call", target: tm, callee: { kind: "ref", name: impl }, args: mArgs, indirect: false } as any);
          return { kind: "temp", id: tm };
        }
      }

      // **A method on a RECEIVER THAT IS A BINDING.** `c.add(4)` where `c` got
      // its value from `new Counter()`. Same call, resolved from the class of
      // the binding instead of from the class being lowered — the only difference
      // between the two branches is where the class name came from.
      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.property as any)?.name &&
        (calleeExpr.object as any)?.type === "Identifier" &&
        !b.currentClass
      ) {
        const holder = b.classOf.get(String((calleeExpr.object as any).name));
        const table = holder ? b.classes.get(holder) : undefined;
        const impl = table?.methods.get(String((calleeExpr.property as any).name));
        if (impl) {
          const recv = lowerExpr(calleeExpr.object, b);
          const rArgs: IRValue[] = [recv];
          for (const a of expr.arguments) rArgs.push(lowerExpr(a, b));
          const tr = freshTemp();
          b.emit({ op: "call", target: tr, callee: { kind: "ref", name: impl }, args: rArgs, indirect: false } as any);
          return { kind: "temp", id: tr };
        }
      }
      // **`super(…)` runs the PARENT constructor on the same record.** Measured on
      // the corpus: five such calls and no `super.m(…)` anywhere, so this is the
      // whole of what inheritance has to do here — the method table is copied
      // from the parent at lift time and the chain unwinds through constructors.
      if (calleeExpr?.type === "Identifier" && (calleeExpr as any).name === "super") {
        const parentCtor = b.currentClass?.parentCtor;
        if (parentCtor && b.thisBinding) {
          const sArgs: IRValue[] = [{ kind: "ref", name: b.thisBinding }];
          for (const a of expr.arguments) sArgs.push(lowerExpr(a, b));
          const ts = freshTemp();
          b.emit({ op: "call", target: ts, callee: { kind: "ref", name: parentCtor }, args: sArgs, indirect: false } as any);
          return { kind: "temp", id: ts };
        }
      }

      // **A Set method.** Resolved by name, so a Set held in another file still
      // works — a per-file type fact does not survive the linker, and the corpus
      // exports its keyword and delimiter sets for the lexer to use.
      // **A STRING method, dispatched by name.** The helper is Nodeon source, so this is
      // the same shape as the list methods and the set methods above: build it on first
      // use, and push the receiver first. Nothing here is new emitter code — the loop
      // inside the helper is lowered into blocks like any `while` in a program.
      //
      // BUG-WASM-69. **And the NAME is only half the question when two tables have it.**
      // Measured on both sides, and neither was right:
      //
      //   before — `indexOf` in the LIST table only, so `s.indexOf("hola")` ran the LIST
      //            helper over a string block and answered -1. No diagnostic, no trap.
      //   after  — `indexOf` added to the STRING table, which is checked FIRST, so the
      //            six existing LIST tests stopped compiling to the right thing.
      //
      // The list side of this has always had a fact — `arrays` says a name is a list —
      // and the string side did not exist, so the tie was broken by table order. **The
      // receiver decides, and only with positive evidence**: a name the lowering proved
      // holds a string literal. Everything else keeps today's behaviour, which is the
      // important half — a list returned by a call and then indexed is not made worse
      // by asking for proof, and would have been had the rule been "unless it is a
      // list".
      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.property as any)?.name &&
        Object.prototype.hasOwnProperty.call(STRING_METHODS, String((calleeExpr.property as any).name)) &&
        // A name only the STRING table has needs no proof — that is how it dispatched
        // before `indexOf` was in two tables, and it is how `startsWith` on a PARAMETER
        // still works. The proof is only for a name the two tables SHARE.
        (!isListMethod(String((calleeExpr.property as any).name)) ||
          receiverIsProvedString(calleeExpr.object, b))
      ) {
        const method = String((calleeExpr.property as any).name);
        const helper = ensureStringMethod(b, method);
        if (helper) {
          // The receiver FIRST, the way every other helper here takes it.
          const strArgs: IRValue[] = [lowerExpr(calleeExpr.object, b)];
          for (const a of expr.arguments) strArgs.push(lowerExpr(a, b));
          const t = freshTemp();
          b.emit({
            op: "call",
            target: t,
            callee: { kind: "ref", name: helper },
            args: strArgs,
            indirect: false,
            receiverFirst: true,
          } as any);
          return { kind: "temp", id: t };
        }
      }

      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.property as any)?.name &&
        Object.prototype.hasOwnProperty.call(SET_METHODS, String((calleeExpr.property as any).name))
      ) {
        const helper = ensureSetMethod(b, String((calleeExpr.property as any).name), b.functionNames);
        if (helper) {
          const setArgs: IRValue[] = [lowerExpr(calleeExpr.object, b)];
          for (const a of expr.arguments) setArgs.push(lowerExpr(a, b));
          const ts = freshTemp();
          b.emit({ op: "call", target: ts, callee: { kind: "ref", name: helper }, args: setArgs, indirect: false } as any);
          return { kind: "temp", id: ts };
        }
      }

      // A list method: `a.map(fn(v) { … })` becomes a call to a module function
      // written in the language itself. There is no runtime to dispatch it, and
      // `a.map` as a field read would load a field named "map", which does not
      // exist. `push` is above because it is an INSTRUCTION, not a function.
      if (
        calleeExpr &&
        calleeExpr.type === "MemberExpression" &&
        !calleeExpr.computed &&
        (calleeExpr.property as any)?.name
      ) {
        const method = String((calleeExpr.property as any).name);
        if (isListMethod(method)) {
          // The receiver's element kind decides WHICH helper to build, and it
          // has to be read BEFORE the receiver is lowered: the receiver's own
          // temporary only exists afterwards.
          const receiver = calleeExpr.object as any;
          const receiverName =
            receiver?.type === "Identifier"
              ? receiver.name
              : undefined;
          const elementKind: "number" | "address" =
            receiverName && b.arrays.get(receiverName) === "address" ? "address" : "number";
          // The result list holds what the CALLBACK returns, which for a lambda
          // is visible here. `map` on its own never builds a new list.
          const resultKind = METHODS_RETURNING_LIST.has(method) && method !== "foreach"
            ? resultElementKind(expr.arguments[0] as Expression)
            : elementKind;
          const helper = ensureListMethod(b, method, elementKind, resultKind, b.functionNames);
          if (helper) {
            // The helper takes the LIST FIRST, then whatever the call passed.
            // `a.map(f)` reads as `__map_number(a, f)`.
            const base = lowerExpr(calleeExpr.object, b);
            const args: IRValue[] = [base];
            for (const a of expr.arguments) args.push(lowerExpr(a, b));
            const t = freshTemp();
            b.emit({ op: "call", target: t, callee: { kind: "ref", name: helper }, args, indirect: false } as any);

            // to be a list — the same trap as a parameter, one expression on.
            if (METHODS_RETURNING_LIST.has(method)) b.arrays.set(t, resultKind);
            return { kind: "temp", id: t };
          }
        }
      }

      // A callee that IS a function name stays a plain reference, so a direct
      // call keeps the cheap `call`. Anything else — a binding, a field, a
      // lambda — is reached through a value and has to go through the table.
      const calleeNode: any = expr.callee;
      // BUG-WASM-85. **A name the LANGUAGE provides is a name the module has**, and the
      // only way that is true is if something put it there. `ensureGlobalFunction` adds
      // it to `functionNames`, so the line below sees an ordinary function — which is the
      // whole design: the built-in is reached the way a method is, and there is no second
      // kind of call in the emitter to keep in step with this one.
      //
      // It runs only when the module has NO such name, and that is the precedence a
      // program needs: its own `numToStr` is its own.
      if (calleeNode?.type === "Identifier" && !b.functionNames.has(calleeNode.name)) {
        ensureGlobalFunction(b, calleeNode.name);
      }
      const isDirect = calleeNode?.type === "Identifier" && b.functionNames.has(calleeNode.name);
      // BUG-WASM-82. **A bare name that is neither a function of the module nor a slot
      // of this function is not a callee.** It used to be lowered as a load of a local
      // that was never declared, so the module validated and the trap said
      // `function signature mismatch` — a type complaint about a missing SYMBOL. This
      // is the same defect BUG-WASM-81 measured on `allocblock`, one layer up: the
      // reservation was never the problem, the call was.
      //
      // The MEMBER half was already named, by the emitter — `console.log(1)` says
      // "una llamada a un miembro (\"log\")… no hay host al que preguntar" — and that is
      // why this one had to keep its own words: a test asserting "rejected" cannot
      // tell which rule fired.
      //
      // A diagnostic and a ZERO, not a throw: the corpus gate requires the compiler to
      // never throw over a real file, and the zero is what the shape has to produce for
      // anything reading the IR while ignoring that it does not compile.
      if (!isDirect && calleeNode?.type === "Identifier" && !b.hasSlot(calleeNode.name)) {
        b.diagnostics.push(
          `una llamada a "${calleeNode.name}" todavía no está soportada por el backend de WebAssembly: ` +
            `no hay ninguna función ni variable con ese nombre en el módulo`,
        );
        const refused = freshTemp();
        b.emit({ op: "literal", target: refused, value: 0, kind: "number" });
        return { kind: "temp", id: refused };
      }
      const callee: IRValue = isDirect
        ? { kind: "ref", name: calleeNode.name }
        : lowerExpr(calleeNode, b);
      // **THE RECEIVER, as argument zero.** This line is the whole of BUG-WASM-54.
      //
      // `a.slice(1)` used to lower to `call(loadfield(a, "slice"), 1)` — the member's
      // VALUE and the written arguments, with `a` in no field of the instruction at
      // all. Measured:
      //
      //     {"op":"call","field":"slice","argCount":1,
      //      "args":[{"defOp":"literal"}],"receiver":null,"object":null}
      //
      // so every host member the gate names — `join`, `log`, `existsSync`,
      // `readFileSync`, `get`, `slice`, `replace`, `includes` — was refused for want of
      // an argument it never received.
      //
      // WebAssembly has no method call, so the receiver travels as argument zero,
      // which is what the list helpers above already do: `__map_number(a, f)`. And
      // `receiverFirst` is the flag the emitter already reads to know an argument is
      // a record, so nothing new is introduced — only the argument that was missing.
      const receiverFirst = calleeNode?.type === "MemberExpression" && !isDirect;
      const args: IRValue[] = receiverFirst
        ? [lowerExpr(calleeNode.object, b), ...expr.arguments.map((a: Expression) => lowerExpr(a, b))]
        : expr.arguments.map((a: Expression) => lowerExpr(a, b));
      const t = freshTemp();
      b.emit({
        op: "call",
        target: t,
        callee,
        args,
        indirect: !isDirect,
        receiverFirst,
        inTry: b.tryAfters.length > 0,
      } as any);
      // BUG-WASM-86. **A call to a function that returns a string returns a string.** The mark
      // belongs on the NAME, because `b.stringNames` is what both halves read.
      if (isDirect && stringFns.has(calleeNode?.name)) markString(t, b);

      return { kind: "temp", id: t };
    }
    case "NewExpression": {
      // `new C(…)` is an allocation followed by a call to the constructor. The
      // constructor is lifted like any other function and takes the receiver as
      // its first written parameter, so this is `objlit` + `call` and no new
      // instruction.
      const ctorName = (expr.callee as any)?.name;
      const cls = ctorName ? b.classes.get(ctorName) : undefined;

      // **`new Error(…)` and its two siblings are a RECORD.** Measured on the
      // corpus: 18 sites, and every one of them is `throw new Error(…)` — the
      // value is never bound, never returned and never read. So what is needed is
      // a value that can travel in the exception slot, and the same `objlit` a
      // class instance uses builds it.
      //
      // `message` and `name` are the two fields anything could read off an error,
      // and both are strings. There is deliberately NO `stack`: there is no call
      // stack to read in a WebAssembly module, and a `stack` field that comes
      // back as zero is worse than an absent one, because the program that reads
      // it reports a stack trace with nothing in it.
      if (ctorName === "Error" || ctorName === "SyntaxError" || ctorName === "TypeError") {
        const msg = (expr.arguments ?? [])[0];
        const te = freshTemp();
        b.emit({
          op: "objlit",
          target: te,
          fields: ["message", "name"],
          values: [
            msg ? lowerExpr(msg, b) : { kind: "lit", value: "", litType: "string" },
            { kind: "lit", value: ctorName, litType: "string" },
          ],
        } as any);
        return { kind: "temp", id: te };
      }

      // `new Array()` and `new Array(n)` are a list of zeros. The one host
      // constructor the corpus wants that needs no decision from anyone: whether a
      // string here is bytes or characters decides what a `Set` of them is, and a
      // list of numbers is not waiting on that.
      // **`new Set([…])` builds a list of ADDRESSES.** A string is an address in
      // this backend, so the set holds them and `has` compares them; the elements
      // are placed with `storeelement` rather than written into the literal,
      // because an address is not a number and putting one in a number slot
      // stores the wrong thing.
      if (ctorName === "Set") {
        const arg = (expr.arguments ?? [])[0] as any;
        const elements: any[] = arg?.type === "ArrayExpression" ? (arg.elements ?? []) : [];
        const ts = freshTemp();
        b.emit({
          op: "arraylit",
          target: ts,
          values: new Array(elements.length).fill(0),
          elementKind: "address",
        } as any);
        elements.forEach((el: any, i: number) => {
          b.emit({
            op: "storeelement",
            array: { kind: "temp", id: ts },
            index: i,
            value: el ? lowerExpr(el, b) : { kind: "lit", value: 0, litType: "number" },
          } as any);
        });
        b.arrays.set(ts, "address");
        return { kind: "temp", id: ts };
      }

      if (ctorName === "Array") {
        const sizeArg = (expr.arguments ?? [])[0] as any;
        const count = sizeArg?.type === "Literal" && typeof sizeArg.value === "number" ? sizeArg.value : 0;
        const ta = freshTemp();
        b.emit({
          op: "arraylit",
          target: ta,
          values: new Array(Math.max(0, count)).fill(0),
          elementKind: "number",
        } as any);
        b.arrays.set(ta, "number");
        return { kind: "temp", id: ta };
      }

      if (!cls) {
        // Not a class of this module: `new Map(…)`, `new Error(…)`, a host type.
        // It USED to be dropped silently by the `default` branch below, so a
        // program that built its whole data structure with `new` compiled to
        // zeroes and said nothing. Named instead — a refusal with the callee in
        // it beats a module that answers 0.
        b.diagnostics.push(
          "new " + (ctorName ?? "?") + "() todavía no está soportado por el backend de WebAssembly",
        );
        const t0 = freshTemp();
        b.emit({ op: "literal", target: t0, value: 0, kind: "number" } as any);
        return { kind: "temp", id: t0 };
      }
      const self = freshTemp();
      b.emit({
        op: "objlit",
        target: self,
        fields: cls.fields,
        values: cls.fields.map(() => ({ kind: "lit", value: 0, litType: "number" })),
      } as any);
      const ctorArgs: IRValue[] = [{ kind: "temp", id: self }];
      for (const a of (expr.arguments ?? []) as Expression[]) ctorArgs.push(lowerExpr(a, b));
      b.emit({
        op: "call",
        callee: { kind: "ref", name: cls.ctor },
        args: ctorArgs,
        indirect: false,
      } as any);
      // **The instance is the ALLOCATION, not the constructor's result.**
      // A constructor has no `return`, so its result is whatever is in the result
      // slot — zero — and handing that to the binding sent every method call
      // through address 0. Measured: all nine cases compiled and seven answered a
      // wrong number, the classic "the module is valid and the arithmetic is
      // nonsense" shape. `c.add(4)` then `c.add(6)` gave 10 instead of 11, which is
      // 4 + 6: the constructor's own field write had gone to a different object
      // than the one the methods were called on.
      return { kind: "temp", id: self };
    }
    case "ObjectExpression": {
      // An object literal becomes a record allocated on the bump heap, with
      // one 8-byte slot per field. Field order fixes the layout, and the
      // emitter declares fields module-wide so an offset never depends on which
      // function mentions the field first.
      const props: any[] = (expr as any).properties ?? [];
      const fields: string[] = [];
      const values: IRValue[] = [];
      for (const p of props) {
        if (p?.spread) continue; // unsupported in this backend
        const name = p.key?.name ?? p.key?.value;
        if (name === undefined) continue;
        fields.push(String(name));
        values.push(p.value ? lowerExpr(p.value, b) : { kind: "lit", value: 0, litType: "number" });
      }
      const t = freshTemp();
      b.emit({ op: "objlit", target: t, fields, values } as any);
      return { kind: "temp", id: t };
    }
    case "ArrayExpression": {
      // An array literal becomes a constant block in linear memory; the
      // expression evaluates to its i32 address. Layout: an i32 length
      // followed by the elements, each 8 bytes as an f64.
      //
      //   [ base+0  ] length (i32)
      //   [ base+8  ] element 0 (f64)
      //   [ base+16 ] element 1 (f64)
      //
      // so `a[i]` is `f64.load(base + 8 + i*8)`.
      //
      // An element may be an OBJECT, which is itself an address. Those are
      // built first with `objlit`, and the element records that address. A
      // flat list of numbers could not express `[{v: 1}, {v: 2}]`, and those
      // silently became `[0, 0]`.
      const elements = (expr as any).elements ?? [];
      const t = freshTemp();

      const numbers: number[] = [];
      const pending: { slot: number; temp: string; value?: any }[] = [];
      let allNumbers = true;

      for (const el of elements) {
        // **A STRING literal is an address too, and it was going into a number
        // slot.** Only an object element turned `allNumbers` off, so
        // `const L = ["fn", "class"]` was typed `number`, its addresses were
        // written as doubles, and the scan that read them back never matched:
        //
        //     arrayKinds: {"L":"number"}
        //     L.indexOf("class")   → -1     the element is there
        //     L.length             → 2      the header is right
        //
        // That is the worst shape this backend produces — not a crash, not a zero, a
        // confident wrong answer that reads as an empty result.
        if (el && el.type === "ObjectExpression") {
          allNumbers = false;
          // Build the record now; its address is the element value.
          const props: any[] = el.properties ?? [];
          const fields: string[] = [];
          const values: IRValue[] = [];
          for (const p of props) {
            if (p?.spread) continue;
            const name = p.key?.name ?? p.key?.value;
            if (name === undefined) continue;
            fields.push(String(name));
            values.push(p.value ? lowerExpr(p.value, b) : { kind: "lit", value: 0, litType: "number" });
          }
          const recT = freshTemp();
          b.emit({ op: "objlit", target: recT, fields, values } as any);
          numbers.push(0);
          pending.push({ slot: numbers.length - 1, temp: recT });
          continue;
        }
        if (el && el.type === "Literal" && typeof el.value === "string") {
          allNumbers = false;
          // Placed with `storeelement` like the object slots, for the same reason:
          // the address is not a number and putting one in the literal's number
          // slot stores the wrong thing.
          numbers.push(0);
          pending.push({ slot: numbers.length - 1, temp: freshTemp(), value: el });
          continue;
        }
        numbers.push(el && typeof el.value === "number" ? el.value : 0);
      }

      // `elementKind` tells the emitter how to read a slot: "number" loads an
      // f64, "address" loads an i32. The lowering is the only place that knows
      // which, and reading an f64 slot as an i32 turned every value into its
      // raw bit pattern.
      b.emit({
        op: "arraylit",
        target: t,
        values: numbers,
        elementKind: allNumbers ? "number" : "address",
      } as any);

      // The array block was placed with zeros for the object slots, so each one
      // is written afterwards with its record address.
      for (const p of pending) {
        b.emit({
          op: "storeelement",
          array: { kind: "temp", id: t },
          index: p.slot,
          // A string element is the LITERAL itself, not a temp: lowering it here
          // keeps the slot's value and the write's value the same node.
          value: p.value ? lowerExpr(p.value, b) : { kind: "temp", id: p.temp },
        } as any);
      }
      // Record how the elements of this array must be read, so a `for` over it
      // loads an f64 for a numeric array and an i32 address for one of records.
      b.arrays.set(t, allNumbers ? "number" : "address");
      return { kind: "temp", id: t };
    }

    case "MemberExpression": {
      const obj = lowerExpr(expr.object, b);
      const t = freshTemp();
      // BUG-WASM-90. **A field the parameter's annotation declares a string IS a string, and
      // the mark goes HERE — where the field is lowered — and not where it is used.**
      //
      // Measured: `const t = <proved>` then `t + "!"` passes, because the propagation at
      // `ir-lower.ts:2142` marks a binding whose value is a proved temporary. But
      // `const name = v.name.name` was refused, because that temporary was never marked and
      // the propagation had nothing to carry. Marking at the source makes every reader work —
      // a declaration, an argument, a return, a `+` — and leaves ONE place, which is the only
      // way two places stop being able to drift.
      if (annotatedFieldIs(expr, "string")) markString(t, b);
      const objKey = obj.kind === "temp" ? obj.id : obj.kind === "ref" ? obj.name : "";
      if (expr.computed) {
        // A computed member `a[i]` on an array is an index, not a field name.
        // The IR field carries a marker so the emitter can tell the two apart.
        const prop = lowerExpr(expr.property, b);
        b.emit({
          op: "loadfield",
          target: t,
          object: obj,
          field: " index",
          computed: true,
          index: prop,
        } as any);
      } else {
        const fieldName = (expr.property as any).name ?? String(expr.property);
        // `.length` on a list is the LENGTH HEADER at offset 0, not a field of
        // a record. Lowered as a field read it was given a slot in the record
        // layout like any other name, so `a.length` read whatever bytes sat at
        // that offset — a denormal double, not a count.
        if (fieldName === "length" && b.arrays.has(objKey)) {
          b.emit({ op: "arraylength", target: t, array: obj } as any);
        } else {
          b.emit({ op: "loadfield", target: t, object: obj, field: fieldName, computed: false });
        }
      }
      return { kind: "temp", id: t };
    }
    case "AssignmentExpression": {
      const val = lowerExpr(expr.right, b);
      if (expr.left.type === "Identifier") {
        b.emit({ op: "assign", target: expr.left.name, value: val });
        return { kind: "ref", name: expr.left.name };
      }
      // Assignment to a field: `o.x = v`.
      if (expr.left.type === "MemberExpression" && !expr.left.computed) {
        const obj = lowerExpr(expr.left.object, b);
        const field = (expr.left.property as any).name ?? String(expr.left.property);
        b.emit({ op: "storefield", object: obj, field, value: val } as any);
        return { kind: "ref", name: field };
      }
      // Indexed assignment: `a[i] = v`. Without this the value was evaluated
      // and thrown away — `a[0] = 9` left the array untouched — so a program
      // that writes its cells through an index produced the right answer for
      // the wrong reason and never changed state.
      if (expr.left.type === "MemberExpression" && expr.left.computed) {
        const obj = lowerExpr(expr.left.object, b);
        const index = lowerExpr(expr.left.property, b);
        b.emit({ op: "storeelement", array: obj, index, value: val } as any);
        return { kind: "temp", id: freshTemp() };
      }
      return val;
    }
    default: {
      // BUG-WASM-58. Say what is missing, the way the statement path above does —
      // because an unhandled node here used to become a STRING, and a string is an
      // address, and the caller used that address as a number.
      //
      // Ten forms reached it (measured, `.mavis-probe/exprforms.probe.ts`):
      // TernaryExpression, TemplateLiteral, RegExpLiteral, AwaitExpression,
      // YieldExpression, ArrowFunction, TypeofExpression, DeleteExpression,
      // VoidExpression. None of them trapped, and none of them reported anything.
      //
      // **A NUMBER zero, not a string placeholder.** A statement placeholder cannot
      // be used as a value and is harmless; an expression one can, and that is the
      // defect itself. The diagnostic carries the name, so the shape only matters to
      // anything that reads the IR while ignoring that it does not compile.
      b.diagnostics.push(
        `expresión "${expr.type}" todavía no está soportada por el backend de WebAssembly`,
      );
      const t = freshTemp();
      b.emit({ op: "literal", target: t, value: 0, kind: "number" });
      return { kind: "temp", id: t };
    }
  }
}
