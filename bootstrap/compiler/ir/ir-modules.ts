// ── Linking a program's files into ONE module ─────────────────────────
//
// `lowerToIR` lowers ONE file. A wasm module has no module system, so a program
// of thirty files becomes thirty lowerings merged into a single module, with
// every name made unique and every reference rewritten to the file that owns it.
//
// The corpus said this is the whole job: 76 of its 79 imports point at another
// `.no` file, 2 at a Node builtin and 1 at an npm package. A backend that links
// Nodeon files reaches almost all of it; one that does not reaches exactly one.
//
// Names are prefixed per file rather than left alone, because two files may
// both export `compile` and the emitter resolves a callee by NAME through one
// flat list. A prefix is what makes that list unambiguous.
import * as path from "node:path";
import type { Statement } from "../ast/nodes";
import { compileToAST } from "../compile";
import { lowerToIR, setListMethodParser } from "./ir-lower";
import { Lexer } from "../lexer/lexer";
import { Parser } from "../parser/parser";
import type { IRModule, IRFunction, IRInstruction, IRValue } from "./ir-nodes";

// The list methods are parsed from source, so the linker wires the parser the
// same way `index.ts` does. Repeating it here rather than importing `index.ts`
// avoids a cycle: index re-exports this file.
setListMethodParser((source: string) => {
  const parser = new Parser(new Lexer(source).tokenize(), source);
  const ast = parser.parseProgram();
  return { ...ast, errors: parser.errors };
});

export interface LinkResult {
  /** The files that were loaded, in dependency order. */
  files: string[];
  /** One module with every file's functions and globals in it. */
  module: IRModule;
  /** Anything that stopped the link, in the language of the source. */
  problems: string[];
}

/** A short, stable, readable prefix for a file's names. */
function keyFor(file: string, root: string): string {
  const rel = path.relative(root, file).replace(/\\/g, "/").replace(/\.no$/, "");
  return rel.replace(/[^A-Za-z0-9_]/g, "_");
}

export function linkProgram(
  entry: string,
  options: {
    read: (file: string) => string;
    resolvePath: (spec: string, from: string) => string | null;
    root: string;
  },
): LinkResult {
  const problems: string[] = [];
  const { read, resolvePath, root } = options;

  // ── 1. Walk the graph, each file once ──────────────────────────────
  const sources = new Map<string, ReturnType<typeof compileToAST>>();
  const order: string[] = [];
  const visit = (file: string): void => {
    // Every key is a RESOLVED path: a specifier is resolved against the
    // importing file and compared to these, and the two have to be spelled the
    // same way or nothing matches.
    const key = path.resolve(file);
    if (sources.has(key)) return;
    let text: string;
    try {
      text = read(key);
    } catch (e) {
      problems.push(`no se puede leer ${file}: ${(e as Error).message}`);
      return;
    }
    const ast = compileToAST(text);
    if ((ast.errors ?? []).length) {
      problems.push(`${path.relative(root, key)}: ${(ast.errors ?? []).length} errores de análisis`);
      return;
    }
    sources.set(key, ast);
    order.push(key);
    for (const stmt of (ast.body ?? []) as Statement[]) {
      if (stmt.type !== "ImportDeclaration") continue;
      const target = resolvePath(String((stmt as any).source), key);
      if (target) visit(target);
      else problems.push(`${path.relative(root, key)} importa "${(stmt as any).source}", que no es un fichero .no`);
    }
  }
  visit(entry);

  const keyOf = new Map(order.map((f) => [f, keyFor(f, root)] as const));
  const prefixOf = (file: string) => keyOf.get(file) ?? file;

  // ── 2. Each file's OWN names, and what its imports bind ────────────
  interface FileInfo {
    file: string;
    key: string;
    /** Names declared in this file that other things may refer to. */
    own: Set<string>;
    /** local name -> `ownerKey::exported` */
    imports: Map<string, string>;
    /** what this file publishes, as `ownerKey::local` */
    exports: Map<string, string>;
  }
  const info = new Map<string, FileInfo>();

  for (const file of order) {
    const ast = sources.get(file)!;
    const key = prefixOf(file);
    const own = new Set<string>();
    const exports = new Map<string, string>();
    const imports = new Map<string, string>();

    for (const stmt of (ast.body ?? []) as Statement[]) {
      const inner = (stmt as any).type === "ExportDeclaration" && (stmt as any).declaration
        ? (stmt as any).declaration
        : stmt;
      if (inner?.type === "FunctionDeclaration" && inner.name) {
        own.add(inner.name.name);
        exports.set(inner.name.name, `${key}::${inner.name.name}`);
      }
      if (inner?.type === "VariableDeclaration") {
        // A Nodeon `VariableDeclaration` carries ONE `name`, not an array of
        // declarators — that is the ESTree shape, and reaching for it is why
        // `export const K = 7` was never recognised as something the file owns.
        const n = inner.name?.name;
        if (n) {
          own.add(n);
          exports.set(n, `${key}::${n}`);
        }
      }
      if (stmt.type === "ImportDeclaration") {
        const imp = stmt as any;
        const target = resolvePath(String(imp.source), file);
        if (!target) continue;
        const tkey = prefixOf(target);
        for (const spec of imp.namedImports ?? []) {
          const published = spec.name === "default" ? "default" : spec.name;
          imports.set(spec.alias ?? spec.name, `${tkey}\u0000${published}`);
        }
        if (imp.defaultImport) imports.set(imp.defaultImport, `${tkey}\u0000default`);
        if (imp.namespaceImport) {
          problems.push(`"import * as ${imp.namespaceImport}" todavía no está soportado`);
        }
      }
    }
    info.set(file, { file, key, own, imports, exports });
  }

  const exportsOf = new Map<string, Map<string, string>>();
  for (const f of info.values()) exportsOf.set(f.key, f.exports);

  // An import is checked HERE, not where it is used. A binding nothing refers to
  // is still a claim about another file, and validating it lazily meant an unused
  // import of something that does not exist passed in silence.
  for (const f of info.values()) {
    for (const [local, bound] of f.imports) {
      const sep = bound.indexOf("\u0000");
      const ownerKey = bound.slice(0, sep);
      const published = bound.slice(sep + 1);
      if (!exportsOf.get(ownerKey)?.has(published)) {
        problems.push(
          `${path.relative(root, f.file)} importa "${local}" y ${ownerKey} no lo exporta`,
        );
      }
    }
  }

  /** Where does `name`, seen from `from`, actually live? */
  const resolve = (name: string, from: string): string | undefined => {
    const me = info.get(from)!;
    const bound = me.imports.get(name);
    if (bound) {
      const sep = bound.indexOf("\u0000");
      const ownerKey = bound.slice(0, sep);
      const published = bound.slice(sep + 1);
      const target = exportsOf.get(ownerKey)?.get(published);
      if (target) return target;
      problems.push(`${path.relative(root, from)} importa "${published}" y ese fichero no lo exporta`);
      return undefined;
    }
    if (me.own.has(name)) return `${me.key}::${name}`;
    return undefined;
  };

  // ── 3. Merge, renaming everything a file owns ──────────────────────
  const functions: IRFunction[] = [];
  const globals: IRInstruction[] = [];
  const arrayKinds: Record<string, "number" | "address"> = {};
  const loopVarKinds: Record<string, "number" | "address"> = {};
  const diagnostics: string[] = [];
  const captures: Record<string, string[]> = {};

  for (const file of order) {
    const me = info.get(file)!;
    // Lowered ONCE: lowering twice would give two sets of temporaries for one
    // file, and the rename below would only reach one of them.
    // BUG-WASM-77. A LINKED program exists to be emitted to WebAssembly — a wasm module
    // has no module system, which is the whole reason this file is here — so the target
    // is declared rather than assumed. Without it the WASM-specific refusals never fire
    // on a corpus program, and the gate reports a program as compiling when it is going
    // to be refused.
    const mod = lowerToIR(sources.get(file)!, { wasm: true });

    // A file OWNS more than it declares. Lowering a `.map` or a `.filter` LIFTS a
    // helper into the module — `__map_number_number` — and that helper is as much
    // a part of this file as a declared `fn` is, with the same need for a prefix.
    //
    // It was not registered, and the two halves of the rename disagreed about it:
    // the FUNCTION was renamed unconditionally, while the CALL went through
    // `resolve`, which only knew the file's source declarations, and kept the bare
    // name. Measured on the repository's own formatter:
    //
    //     function:  src_compiler_formatter_formatter::__map_number_number
    //     call site: __map_number_number
    //
    // and the emitter said `llamada a "__map_number_number", que este módulo no
    // define`. It was silent about it until the refusal became binding — the call
    // was emitted as an index of -1 and a zero, and the module still VALIDATED.
    //
    // **Four corpus programs, and the one that formats the compiler itself, were
    // compiling to a module that answered 0.**
    for (const fn of mod.functions ?? []) {
      if (fn.name && !me.own.has(fn.name)) me.own.add(fn.name);
    }

    const rename = (node: any, isTopLevel = false): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((n) => rename(n)); return; }
      if (node.kind === "ref" && typeof node.name === "string") {
        const where = resolve(node.name, file);
        if (where) node.name = where;
      }
      // `op`, not `type`. Every IR instruction is discriminated by `op` — there is
      // no `type` field on one — so this branch has never once matched, and a
      // LAMBDA referred to by name kept its bare name while the function it names
      // was prefixed. Measured on a linked program with one `.map`:
      //
      //     function:  main::__lambda1
      //     fnvalue:   __lambda1          ← bare
      //
      // and calling it gave `null function or function signature mismatch`. Alone
      // the two agree by accident, which is why the module test passed and the
      // corpus did not: the linked module is the only place a name can drift.
      if (node.op === "fnvalue" && typeof node.fn === "string") {
        const where = resolve(node.fn, file);
        if (where) node.fn = where;
      }
      // A top-level binding's name is a plain field, not a reference value, so
      // the walk above never saw it — and the import on the other side of the
      // file was then looking for a name that did not exist.
      if (isTopLevel && (node.op === "declare" || node.op === "assign") && typeof node.name === "string") {
        const where = resolve(node.name, file);
        if (where) node.name = where;
      }
      for (const value of Object.values(node)) rename(value);
    };

    for (const fn of mod.functions) {
      rename(fn);
      functions.push({ ...fn, name: `${me.key}::${fn.name}` });
    }
    for (const inst of mod.globals) {
      rename(inst, true);
      globals.push(inst);
    }
    // A lambda's captures travel with its new name.
    for (const [name, caps] of Object.entries(mod.captures ?? {})) {
      captures[`${me.key}::${name}`] = caps;
    }
    Object.assign(arrayKinds, mod.arrayKinds ?? {});
    Object.assign(loopVarKinds, mod.loopVarKinds ?? {});
    diagnostics.push(...(mod.diagnostics ?? []));
  }

  // ── 4. A call the lowering could not recognise as DIRECT ───────────
  //
  // The lowering decides "direct" by whether the callee names a function of the
  // SAME file, and it runs BEFORE the imports are resolved — so `twice(n)` in
  // the importing file was marked indirect, and an indirect call wants an i32
  // VALUE where a name was. The linker is the first place that knows the answer.
  const known = new Set(functions.map((f) => f.name));
  for (const fn of functions) {
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (inst.op !== "call" || !(inst as any).indirect) continue;
        const callee = (inst as any).callee;
        if (callee?.kind === "ref" && known.has(callee.name)) {
          (inst as any).indirect = false;
        }
      }
    }
  }

  const merged: IRModule = {
    type: "IRModule",
    functions,
    globals,
    arrayKinds,
    loopVarKinds,
    diagnostics,
    captures,
  };
  return { files: order, module: merged, problems };
}
