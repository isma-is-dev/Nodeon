// ── IR → WASM Binary Compiler ───────────────────────────────────────
// Converts optimized IR directly to WASM binary bytecode.
// Uses the wasm-binary encoder for byte generation.

import {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
} from "./ir-nodes";
import {
  WasmModuleDesc, WasmFunc, WasmFuncType, WasmValType,
  encodeWasmModule, encodeI32, encodeF64, OP, serializeType,
} from "./wasm-binary";
import { hoistModuleConstants } from "./ir-lower";

// ── Type Inference ──────────────────────────────────────────────────

function inferLitType(value: any, kind: string): WasmValType {
  if (kind === "number") return Number.isInteger(value) ? "i32" : "f64";
  if (kind === "boolean") return "i32";
  // A string is an address into linear memory, which is an i32.
  return "i32";
}

function inferBinOpType(op: string, lt: WasmValType, rt: WasmValType): WasmValType {
  if (lt === "f64" || rt === "f64") return "f64";
  if (["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(op)) return "i32";
  if (op === "/") return "f64";
  return "i32";
}

// Operators whose RESULT is a boolean (i32 in wasm), whatever the operand type.
// `inferBinOpType` returns i32 for these, so the emitter and the local-typing
// pass must agree on the same set.
const COMPARISON_OPS = new Set([
  "===", "!==", "==", "!=", "<", ">", "<=", ">=",
  "&&", "||", "!", "in", "instanceof",
]);

function isComparisonOp(op: string): boolean {
  return COMPARISON_OPS.has(op);
}

// Logical and bitwise operators are integer in wasm even on f64 operands, so
// their operands must be narrowed before the operation.
const LOGICAL_OPS = new Set(["&&", "||", "&", "|", "^", "<<", ">>", ">>>"]);

/** Bytes of header before an array's first element: an i32 length plus padding. */
const ARRAY_HEADER_BYTES = 8;

/**
 * BUG-WASM-78. The word IN FRONT of a block that says what kind of block it is.
 *
 * A string, a list, a record and a closure are all i32 and nothing said which was
 * which, so `${n}` could not tell a number from a string at run time and `typeof`
 * had nothing to read. **In front rather than inside**, so that no reader moves: the
 * length is still at the block address, the capacity at +4, the elements at +8. The
 * tag is read as `load(base, -4)`.
 */
const TAG_BYTES = 4;
const TAG_STRING = 1;
const TAG_ARRAY = 2;
const TAG_RECORD = 3;
const TAG_CLOSURE = 4;

/**
 * Fixed address of the bump-pointer slot.
 *
 * It MUST be a constant, not something derived from the buffer as it grows.
 * Computed lazily it landed at the next free byte at the moment the FIRST
 * literal was interned, and every later literal — including the array holding
 * them — was then written over it, so the allocator pointer was corrupted and
 * records overlapped the static data. Reserving the tail of the first page
 * keeps it clear of anything the data section can grow into.
 */
const HEAP_POINTER_ADDRESS = 65520;

/** The runtime heap starts at the start of the second page. */
const HEAP_START = 65536;

/**
 * Where a pending exception is parked.
 *
 * A `throw` has to be caught by a `try` in a CALLER — the corpus has 26 `throw`
 * and not one of them sits inside a `try` — so the failure cannot be a local
 * flag. It is one address, and every function reads it: `throw` stores and
 * returns early, every call site propagates, and a `try` checks it.
 *
 * Eight bytes, because a thrown value is an address like anything else here, and
 * zero is "no exception", which is how the data section starts it.
 */
const EXCEPTION_SLOT = HEAP_POINTER_ADDRESS + 4;

/**
 * Pages of memory the module STARTS with.
 *
 * Page 0 holds the static data image; the heap starts at page 1. Every array
 * literal AND every record is allocated from that heap at run TIME, so a loop
 * that builds a grid per tick consumes `8 + rows*cols*8` bytes each time.
 *
 * This is a starting size, not a ceiling: the allocator calls `memory.grow`
 * when an allocation would not fit. See buglist.md (BUMP-WASM-8).
 */
const MEMORY_PAGES = 16;

/**
 * A shared buffer holding string literals, array literals and the bump pointer.
 *
 * All of them live in the same linear memory because a module gets exactly one.
 * Blocks are 8-byte aligned so an f64 load is always naturally aligned.
 */
/** Capacity an array literal is created with: length rounded up, minimum 8. */
function arrayCapacity(length: number): number {
  let cap = 8;
  while (cap < length) cap *= 2;
  return cap;
}

class StringTable {
  private buf: number[] = [0]; // address 0 stays null
  private offsets = new Map<string, number>();
  private arrayBlocks = new Map<string, number>();

  /** Address of the bump-pointer slot holding the next free byte. */
  get heapPointerAddress(): number {
    return HEAP_POINTER_ADDRESS;
  }

  /** First byte available to the allocator. */
  get heapStart(): number {
    return HEAP_START;
  }

  /**
   * Intern a string and return its address.
   *
   * Layout: `[len: i32][cap: i32][bytes…][NUL]` — **the same two words an array
   * has**, and for the same reason. A string was NUL-terminated with no header, so
   * `.length` had nothing to load and became a field read of the record layout,
   * which returned whatever eight bytes happened to be there (measured: 1634496360
   * for `"hola"`). And a concatenation had no length to allocate against, which is
   * why `+` on two strings added their addresses instead.
   *
   * The NUL stays, so anything that walks to a terminator still works.
   */
  intern(value: string): number {
    const existing = this.offsets.get(value);
    if (existing !== undefined) return existing;
    const address = this.align(8);
    for (let i = 0; i < 4; i++) this.buf.push((TAG_STRING >>> (i * 8)) & 0xff);
    const bytes = new TextEncoder().encode(value);
    for (let i = 0; i < 4; i++) this.buf.push((bytes.length >>> (i * 8)) & 0xff); // length
    for (let i = 0; i < 4; i++) this.buf.push((bytes.length >>> (i * 8)) & 0xff); // capacity
    for (const byte of bytes) this.buf.push(byte);
    this.buf.push(0); // NUL terminator
    // Past its own tag: `address` is where the tag word is.
    const block = address + TAG_BYTES;
    this.offsets.set(value, block);
    return block;
  }

  /**
   * Place an array of f64 values in memory and return its base address.
   *
   * Layout: `[len: i32][cap: i32][elem0: f64]…`, so an element is at
   * `base + 8 + i*8`. The second word is a CAPACITY rather than the padding it
   * used to be, which is what makes `push` expressible: without room in the
   * block there is nowhere to put a new element, and a call to a runtime is not
   * available in this backend.
   *
   * Capacity is the length rounded up to a power of two, minimum 8, so a literal
   * with a few elements can take several pushes before it must grow.
   */
  internArray(values: number[]): number {
    const key = values.join(",");
    const existing = this.arrayBlocks.get(key);
    if (existing !== undefined) return existing;
    const address = this.align(8);
    for (let i = 0; i < 4; i++) this.buf.push((TAG_ARRAY >>> (i * 8)) & 0xff);
    const cap = arrayCapacity(values.length);
    for (let i = 0; i < 4; i++) this.buf.push((values.length >>> (i * 8)) & 0xff);
    for (let i = 0; i < 4; i++) this.buf.push((cap >>> (i * 8)) & 0xff);
    for (const v of values) {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, Number(v), true);
      for (const b of bytes) this.buf.push(b);
    }
    // Pad the reserved tail so the block really is `cap` elements long.
    for (let i = values.length; i < cap; i++) {
      for (let b = 0; b < 8; b++) this.buf.push(0);
    }
    const block = address + TAG_BYTES;
    this.arrayBlocks.set(key, block);
    return block;
  }

  /**
   * Reserve a closure record for a function that captures NOTHING, and return
   * its address.
   *
   * A function value is the ADDRESS of a closure record — always, plain or not —
   * so the call site reads the target index from the same word in both cases and
   * there is no tag to interpret. A record with no captures never changes, so it
   * lives in the static image and every reference to that function shares it.
   *
   * Layout: `[thunkIndex: i32][captureCount: i32]` and then one 8-byte slot per
   * captured value. A fixed header is what lets the emitter and the call site
   * agree by construction: an earlier attempt tagged the low bit of the value
   * instead, and the two sides then had to agree about arithmetic they each did
   * separately.
   */
  reserveClosureRecord(thunkIndex: number, captureCount: number): number {
    const address = this.align(8);
    for (let i = 0; i < 4; i++) this.buf.push((TAG_CLOSURE >>> (i * 8)) & 0xff);
    for (let i = 0; i < 2; i++) {
      const value = i === 0 ? thunkIndex : captureCount;
      for (let b = 0; b < 4; b++) this.buf.push((value >>> (b * 8)) & 0xff);
    }
    return address + TAG_BYTES;
  }

  /**
   * Reserve a closure record for a function that captures NOTHING, and return
   * its address. It never changes, so it lives in the static image and every
   * reference to that function shares it.
   */
  reserveClosureRecord(thunkIndex: number, captureCount: number): number {
    const address = this.align(8);
    for (let i = 0; i < 4; i++) this.buf.push((TAG_CLOSURE >>> (i * 8)) & 0xff);
    for (let i = 0; i < 2; i++) {
      const value = i === 0 ? thunkIndex : captureCount;
      for (let b = 0; b < 4; b++) this.buf.push((value >>> (b * 8)) & 0xff);
    }
    return address + TAG_BYTES;
  }

  private align(n: number): number {    while (this.buf.length % n !== 0) this.buf.push(0);
    return this.buf.length;
  }

  /**
   * Reserve `size` bytes for a RUNTIME record and return its address.
   *
   * Records are allocated at run time from the bump heap, so they must not
   * land on top of the static data. The heap therefore starts past everything
   * the data section occupies, and the pointer slot lives at the very end of
   * the static image with its first value pointing at `heapStart`.
   */
  heapStartFor(size: number): number {
    return this.heapStart + size;
  }

  /**
   * The final image: literals at the front, the bump pointer reserved at the
   * tail of the first page, and the heap starting at the second page.
   *
   * The image must be long enough to HOLD the pointer slot. Sizing it to the
   * pointer's address truncated the four bytes that write it, which corrupted
   * the data section and made the engine reject the module with
   * "Invalid array length".
   */
  bytes(): Uint8Array {
    // The image must cover the exception slot as well as the bump pointer, or a
    // `throw` writes past its own data section and the engine discards it — a
    // throw that silently does nothing, which is the worst of the three.
    const out = new Uint8Array(EXCEPTION_SLOT + 8);
    out.set(this.buf, 0);
    const view = new DataView(out.buffer);
    view.setInt32(HEAP_POINTER_ADDRESS, HEAP_START, true);
    // The exception slot starts clear, so no `try` has to clear it before the
    // first one runs.
    view.setInt32(EXCEPTION_SLOT, 0, true);
    return out;
  }
}

/**
 * Field offsets for record-shaped data.
 *
 * A record is a run of 8-byte f64 slots, so a field's offset is its index times
 * 8. Fields are declared for the whole module before any function is compiled,
 * so an offset never depends on which function mentions the field first — a
 * layout assigned in first-use order would give `o.c` the value of `o.b`.
 */
class RecordLayout {
  private offsets = new Map<string, number>();
  private next = 0;

  /** Byte offset of a field. */
  fieldOffset(field: string): number {
    const known = this.offsets.get(field);
    return known === undefined ? -1 : known * 8;
  }

  /** Declare a field if new, and return its byte offset. */
  declare(field: string): number {
    if (!this.offsets.has(field)) {
      this.offsets.set(field, this.next++);
    }
    return this.fieldOffset(field);
  }

  /**
   * How many slots a record needs to hold ANY field in the module.
   *
   * That shared index space has a cost, and paying it wrong is a silent
   * out-of-bounds read: sizing a record by its OWN field count put `{ item: x }`
   * in 8 bytes while the shared layout had already given `item` the offset 8 —
   * one slot past the end of its own record. `o.item` then read the NEXT
   * allocation, and the answer came back as a double with a pointer spliced
   * into its low half: `3` read as `3.000000000029104`, which is
   * `0x4008000000010000` instead of `0x4008000000000000`.
   */
  fieldCount(): number {
    return this.next;
  }
}

// ── Main Entry ──────────────────────────────────────────────────────

export function compileIRToWasmBinary(mod: IRModule): Uint8Array {
  // A problem the lowering OR THE EMITTER found is a problem the caller has to
  // hear about. A module that compiled anyway would run and return a plausible
  // wrong number, which is harder to trace than a refusal.
  //
  // **The check comes after the description is built, and that order is the
  // fix.** `compileIRToWasmDesc` is what collects the emitter's `unsupported` set
  // into `mod.diagnostics`, so checking first meant reading an empty list and
  // returning the bytes anyway: every refusal the emitter names was advisory on a
  // first call and only binding on a second one over the same object. Measured
  // through a computed member on a record, which the emitter reports by name:
  //
  //     first  call  →  ran, and answered 0
  //     second call  →  refused
  //
  // So the module built, and the program read eight bytes per byte of a string's
  // own address. Every "say what you don't support instead of computing a wrong
  // number" in the emitter was being said to a listener that was not listening
  // yet.
  const desc = compileIRToWasmDesc(mod);
  if (mod.diagnostics?.length) {
    throw new Error(
      `no se puede compilar a WebAssembly:\n  - ${mod.diagnostics.join("\n  - ")}`,
    );
  }
  return encodeWasmModule(desc);
}

export function compileIRToWasmDesc(mod: IRModule): WasmModuleDesc {
  // A module-level constant becomes a function here, and nowhere else: this
  // backend has nowhere to put a module-level binding, and `mod.globals` is a
  // flat list nothing executes. See `hoistModuleConstants`.
  hoistModuleConstants(mod, new Set(mod.functions.map((f) => f.name)));

  const functions: WasmFunc[] = [];
  const funcNames: string[] = [];
  const stringTable = new StringTable();

  // Declare every field the module touches BEFORE compiling any function.
  //
  // A record's SIZE depends on the whole count, and an `objlit` that introduced
  // a new field name would otherwise raise the count after some records had
  // already been sized against the smaller one. So the names are collected from
  // the literals too, not only from the reads and writes.
  const recordLayout = new RecordLayout();
  // Temps that hold a record, so a binding to one is typed as an address.
  const recordTemps = new Set<string>();
  for (const fn of mod.functions) {
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (inst.op === "loadfield" || inst.op === "storefield") {
          if (!inst.computed) recordLayout.declare(inst.field);
        }
        if (inst.op === "objlit") {
          for (const field of (inst as any).fields ?? []) recordLayout.declare(String(field));
          if ((inst as any).target) recordTemps.add((inst as any).target);
        }
      }
    }
  }

  // Classify each function's RESULT as a number or an address, so a call to it
  // is typed the same way. A function that returns a record or an array returns
  // an i32 address; anything else returns f64. This is what a call's type is
  // read from, and getting it wrong made `cells.push(0)` (which returns the
  // array) store an i32 into an f64 slot.
  // Which values in this module are ADDRESSES, and which functions take or
  // return one. Resolved BEFORE any function is compiled, because function #0
  // can call function #7 and has to push arguments at the callee's declared
  // parameter types. See `inferModuleAddressTypes` for why this is a fix point
  // over the whole module rather than a per-function guess.
  const moduleTypes = inferModuleAddressTypes(mod, recordTemps);

  // A function VALUE is the index of a THUNK with the uniform signature, so a
  // call through one can be made without knowing which function it will reach.
  // The thunks are only built when something actually needs them, so a module
  // of direct calls carries no table and no element segment.
  const usesFunctionValues = moduleHasFunctionValues(mod);
  const realCount = mod.functions.length;
  // A function used as a value that captures NOTHING gets a record in the
  // STATIC image: it never changes, so every reference to that function shares
  // one. Reserved BEFORE any function is emitted, because a `fnvalue` needs its
  // address while emitting the body of the function that holds it.
  const plainRecords: number[] = [];
  if (usesFunctionValues) {
    for (let i = 0; i < realCount; i++) {
      if ((mod.captures?.[mod.functions[i].name] ?? []).length === 0) {
        plainRecords[i] = stringTable.reserveClosureRecord(realCount + i, 0);
      }
    }
  }
  const typeSignatures: string[] = [];
  // The uniform signature goes FIRST, so its index is 0 and every `call_indirect`
  // can name it without knowing how many distinct signatures the module has.
  // A function's own type index is found by position, so shifting them all by
  // one costs nothing and keeps both sides in agreement.
  //
  // The string format is the encoder's own — `params=>results`. A second format
  // invented here deserialised into a type with the wrong number of parameters,
  // and the engine said "not enough arguments on the stack" about a call that had
  // pushed exactly the right nine.
  if (usesFunctionValues) {
    typeSignatures.push(serializeType(uniformSignature()));
  }
  const signatureIndexOf = (fn: WasmFunc): number => {
    const sig = serializeType(fn.type);
    let idx = typeSignatures.indexOf(sig);
    if (idx === -1) {
      idx = typeSignatures.length;
      typeSignatures.push(sig);
    }
    return idx;
  };

  const unsupported = new Set<string>();
  for (const fn of mod.functions) {
    const compiled = compileFn(
      fn,
      funcNames,
      stringTable,
      recordLayout,
      mod,
      moduleTypes,
      usesFunctionValues,
      plainRecords,
      unsupported,
    );
    functions.push(compiled);
    signatureIndexOf(compiled);
    funcNames.push(fn.name);
  }

  // Every instruction the emitter has no case for, named. A module that uses
  // one does not compile, and saying WHICH is the difference between a gap in
  // the backend and a mystery.
  // **ONE DIAGNOSTIC PER THING, and the joining was the whole bug.** These used to be
  // packed into one string separated by commas, so thirty-three unsupported
  // instructions arrived at the gate as ONE gap — and the gate, counting faithfully,
  // reported one thing missing where thirty-three were. Fixing the GATE did not help,
  // because the commas were in the message all along.
  //
  // The sentence above this block says every instruction the emitter has no case for
  // is NAMED, and that is only true one at a time.
  if (unsupported.size > 0) {
    for (const thing of [...unsupported].sort()) {
      (mod.diagnostics ??= []).push(
        `el backend de WebAssembly todavía no implementa: ${thing}`,
      );
    }
  }

  if (usesFunctionValues) {
    // The count is taken BEFORE the loop: pushing into the array being walked
    // grows the bound, so `i < functions.length` never stops.
    //
    // TWO CONTIGUOUS BLOCKS: the plain thunks first, then the closure thunks.
    // A record's first word is `realCount + i` or `2*realCount + i`, which the
    // emitter and the call site both read, so there is no index arithmetic for
    // the two of them to disagree about.
    const realCount = functions.length;
    for (let i = 0; i < realCount; i++) {
      functions.push(buildThunk(functions[i], i));
    }
    for (let i = 0; i < realCount; i++) {
      const fn = functions[i];
      const captured = (mod.captures?.[fn.name] ?? []).map(
        (name) =>
          (moduleTypes.addressNames[fn.name]?.has(name) ? "i32" : "f64") as WasmValType,
      );
      functions.push(buildClosureThunk(fn, i, captured));
    }
  }

  const exports = functions.map((f, i) => ({ name: f.name, funcIndex: i }));
  // Every module gets a memory so loads and stores are expressible. Without it,
  // strings, arrays and objects had nowhere to live and compiled to a zero
  // constant.
  return {
    functions,
    exports: exports.filter((e) => !e.name.startsWith("thunk:")),
    memoryPages: MEMORY_PAGES,
    data: stringTable.bytes(),
    usesFunctionValues,
    typeSignatures,
  };
}

/** True when some function's NAME is used as a value or called through one. */
function moduleHasFunctionValues(mod: IRModule): boolean {
  for (const fn of mod.functions) {
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (inst.op === "fnvalue") return true;
        if (inst.op === "call" && (inst as any).indirect) return true;
      }
    }
  }
  return false;
}

// ── Function Compilation ────────────────────────────────────────────

interface CompileCtx {
  locals: Map<string, { index: number; type: WasmValType }>;
  funcNames: string[];
  nextLocal: number;
  strings: StringTable;
  /** Same buffer as `strings` — arrays and records are interned into it too. */
  arrays: StringTable;
  recordLayout: RecordLayout;
  /** What each `for` variable receives, keyed by name. */
  loopVarKinds: Record<string, "number" | "address">;
  /** What each array holds, keyed by the temp it was lowered to. */
  arrayKinds: Record<string, "number" | "address">;
  /** Which values in the module are addresses. */
  moduleTypes: ModuleAddressTypes;
  /** The instruction that produced each name, so a write can find its source. */
  defs: Map<string, IRInstruction>;
/** The function being emitted, for the module-wide tables. */
  current: string;
  /**
   * How many functions the WHOLE module has. A function value is a thunk index
   * and the thunks start after every real function, so the offset needs the
   * TOTAL, not the count of functions compiled so far. With the count so far, a
   * value created in the third function pointed at the third REAL function, the
   * call reached a signature that did not match, and the engine read past the
   * results it had been handed.
   */
  totalFunctions: number;
  /**
   * EVERY function name in the module, in index order — including the lambdas
   * that were lifted, which are appended after the declared ones.
   *
   * `funcNames` only holds what has been compiled SO FAR, so a function value
   * created in the second function could not find a lambda declared third and
   * silently became index 0: the call reached the wrong thunk and the engine
   * said "null function or function signature mismatch".
   */
  allFunctionNames: string[];
  /**
   * For each function, the names it CAPTURED from the scope around it. A
   * function value for one of these points at a closure record instead of at a
   * bare index.
   */
  capturesByFunction: Record<string, string[]>;
  /** The value a plain function of index `i` carries. */
  plainThunkIndex: (i: number) => number;
  /** The address a plain function's closure record already lives at. */
  plainRecordAddress: (i: number) => number;
  /**
   * IR instructions this emitter has no case for.
   *
   * An unrecognised instruction used to emit NOTHING, which is silent: the
   * module compiled, the engine later complained about a stack that was empty
   * somewhere else, and the message named a function nobody was looking at.
   * `fmtChild` in the real formatter produced exactly that. Naming the op turns
   * "unsupported construct somewhere in here" into a fact.
   */
  unsupported: Set<string>;
  /**
   * The function being emitted's result type, so an exception propagation can
   * return a value of the right width.
   */
  resultTypeOfCurrentFunction: WasmValType;
  /**
   * The module's functions that return NOTHING, by name.
   *
   * A call to one pushes no value — a wasm function with no result type leaves
   * the stack as it found it — so the `local.set` that stores its result finds
   * an EMPTY stack, and the engine says
   *
   *     not enough arguments on the stack for local.set (need 1, got 0)
   *
   * **The target is on the instruction because the lowering gives one to every**
   * **`call`, including the ones whose value nobody reads.** A statement that is
   * only a call is the common case, and a call to a function with no `return` is
   * a call to a function that has nothing to give.
   *
   * The whole bug was seven lines, and it is why seven corpus programs were
   * rejected:
   *
   *     fn walkExpression(expr, ev) {
   *       switch expr.type {
   *         case "IfExpression" { walkExpression(expr.condition, ev) }   ← no return
   *       }
   *     }
   *
   * A discarded result needs no slot, and the signature is the one thing that
   * knows. It lives on the context because `emitInst` is a module-level function
   * that only receives `ctx`, and computing it per function would be the third
   * copy of the same fact.
   */
  voidFunctions: Set<string>;
  /** The index stored in the closure record of the function at `i`. */
  closureThunkIndex: (i: number) => number;
  /**
   * The type index of the uniform thunk signature, needed by every
   * `call_indirect`. -1 when the module has no function values.
   */
  uniformTypeIndex: number;
  /**
   * Allocates an extra local and returns its index. The array header and
   * `push` need a place to keep the length across an `if`, and an indirect
   * call needs somewhere to land a result in BOTH representations — so the
   * type is a parameter, not an assumption. An f64 stored into an i32 slot is
   * rejected by the engine as a type error, not read as a different number.
   */
  scratchLocal: (type?: WasmValType) => number;
}

/** The operand an instruction treats as an OBJECT — the thing that is indexed. */
function receiverOperand(inst: IRInstruction): any {
  if (inst.op === "loadfield" || inst.op === "storefield") return (inst as any).object;
  if (inst.op === "storeelement" || inst.op === "arraypush" || inst.op === "elementref") {
    return (inst as any).array;
  }
  // A LIST METHOD call carries its receiver as the first argument, because the
  // helper is written `fn __indexOf(list, v)`. Without this the receiver was
  // invisible here, a parameter used only as `xs.indexOf(v)` was not known to
  // hold a record, the call pushed an f64 where an i32 address belonged, and the
  // scan read garbage — `indexOf` answered -1 for an element that was in the list.
  //
  // **The lowering sets the flag, and this reads it**, rather than matching the
  // helper's name: the name is an implementation detail and would be a second
  // copy of the same fact.
  if (inst.op === "call" && (inst as any).receiverFirst) {
    return ((inst as any).args ?? [])[0] ?? null;
  }
  return null;
}

/**
 * The parameters that hold a RECORD rather than a number.
 *
 * A parameter used as the receiver of a field or element access IS an object, so
 * its value is an i32 address:
 *
 *     fn place(g, r, c, v) { g.cells[idxOf(g, r, c)] = v; return g }
 *
 * Typed as f64, `place` received a pointer where a number was expected and
 * every write landed on a garbage address.
 *
 * Two places need this fact — the function's SIGNATURE and the local map its
 * body reads, which are the same slots. They used to compute it separately and
 * disagreed: the signature learned that `seedGlider`'s `g` was a record and the
 * local map did not, and the body read an i32 through an f64 slot. Both now read
 * `inferModuleAddressTypes`, which owns the decision for the whole module.
 */
function receiverParamNames(fn: IRFunction): Set<string> {
  const names = new Set<string>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      const recv = receiverOperand(inst);
      const name = recv?.kind === "ref" ? recv.name : null;
      if (name && fn.params.includes(name)) names.add(name);
    }
  }
  return names;
}

/** The name a value refers to, whether it is a binding or a temp. */
function valueName(v: any): string | null {
  if (!v) return null;
  if (v.kind === "ref") return v.name as string;
  if (v.kind === "temp") return v.id as string;
  return null;
}

/**
 * Which values in the module are ADDRESSES — strings, arrays and records — and
 * which functions take or return one.
 *
 * A number is an f64 and an address is an i32, and the two are not
 * interchangeable: passing a pointer where a number is expected produced a
 * `i32.add[0] expected type i32` module, and passing a record as f64 turned
 * every subsequent field read into garbage.
 *
 * Deciding this per function does not work, and the game is why. In
 * `examples/life.no`:
 *
 *     fn seedGlider(g) { place(g, 1, 2, 1); …; return g }   // `g` is a record
 *     fn simulate(t)  { let g = seedGlider(makeGrid(8, 8)) } // `g` is a record
 *
 * `seedGlider`'s `g` is only ever passed to `place` and returned; it is never
 * used as a field receiver, so a per-function rule types it as a number. And
 * `simulate`'s `g` is only ever bound to a call, so the same. The fact
 * crosses a function boundary, and in `simulate` it also travels in a cycle
 * (`step` returns the record it was given, `simulate` feeds it back).
 *
 * So the answer is computed once for the WHOLE module and iterated to a fix
 * point. Each rule only ever ADDS facts, which bounds the loop and makes the
 * result independent of the order the functions are visited.
 */
interface ModuleAddressTypes {
  /** For each function, the parameter indices that hold a record. */
  paramIsRecord: Record<string, Set<number>>;
  /** For each function, whether its result is an address. */
  returnsAddress: Record<string, boolean>;
  /**
   * For each function, whether its result is a STRING.
   *
   * The mirror of `returnsAddress`, and the same shape of fact: something about a
   * CALLEE, which the lowering of the caller cannot see and the emitter has to be told.
   *
   * It exists because a method call IS a call. With it missing, the receiver of
   * `s.slice(2)` is the RESULT of a call, nothing in the string fixpoint follows a
   * call, and every method that dispatches on a receiver is refused — `slice`,
   * `replace`, `includes`, and `path` built on all of them.
   */
  returnsString: Record<string, boolean>;
  /** For each function, every name (binding or temp) that holds an address. */
  addressNames: Record<string, Set<string>>;
  /** For each function, the names that hold a LIST rather than a record. */
  arrayNames: Record<string, Set<string>>;
  /**
   * For each function, the names that hold a STRING.
   *
   * `addressNames` is not enough, because a string, a list and a record are all
   * i32 — the same address, three different things. This is the fourth kind, and
   * it is what lets `.length` stop being a rule keyed on a NAME:
   *
   *     let s = "hola"; s.length   → 4        ✓  (by LAYOUT, not by knowledge)
   *     "hola".length               → denormal ✗
   *     { length: 99 }.length       → 0         ✗  and it always has
   *
   * A record with a field called `length` being swallowed by the list rule is a
   * project-long bug, and it is the same defect as the other two.
   */
  stringNames: Record<string, Set<string>>;
  /** Field names that hold a STRING anywhere in the module. */
  stringFields: Set<string>;
  /**
   * For each function, what each LIST holds: numbers, or addresses to records.
   *
   * The lowering records this for a list literal and for the binding it was
   * assigned to, but NOT for the temporary a field read produced — and that
   * temporary is what every later read uses. So `o.items[0].v` read a record
   * address as a double, used it as the object pointer, and returned 0.
   */
  arrayElementKind: Record<string, Record<string, "number" | "address">>;
  /** Field names that hold a LIST anywhere in the module. */
  arrayFields: Set<string>;
  /**
   * Field names whose value is an ADDRESS, and must therefore be written and
   * read with `i32.store`/`i32.load` rather than as an f64 slot.
   */
  fieldIsAddress: Set<string>;
}

function inferModuleAddressTypes(mod: IRModule, recordTemps: Set<string>): ModuleAddressTypes {
  const byName = new Map<string, IRFunction>();
  const addressNames: Record<string, Set<string>> = {};
  const arrayNames: Record<string, Set<string>> = {};
  const stringNames: Record<string, Set<string>> = {};
  const arrayElementKind: Record<string, Record<string, "number" | "address">> = {};
  const paramIsRecord: Record<string, Set<number>> = {};
  const returnsAddress: Record<string, boolean> = {};
  const returnsString: Record<string, boolean> = {};

  // What kind of element a FIELD holds, for the whole module.
  //
  // `{ items: [{ v: 3 }] }` writes a list of records into the field `items`,
  // and the kind is known at that moment. A later read of the same field has to
  // agree, and the lowering does not carry it across the record.
  const fieldElementKind = new Map<string, "number" | "address">();

  // What each parameter's list holds, so a list passed in keeps its element
  // kind at the call site: `fn firstOf(xs) { return xs[0] }` called with a list
  // of records has to read an address.
  const paramKinds: Record<string, ("number" | "address" | undefined)[]> = {};
  for (const fn of mod.functions) {
    paramKinds[fn.name] = fn.params.map(() => undefined);
  }

  for (const fn of mod.functions) {
    byName.set(fn.name, fn);
    // ── Base facts, true without looking at any other function ──────────
    const names = new Set<string>();
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        const target = nameOf(inst);
        // A literal that IS a value: a record, an array, a length, a string.
        if (target && (recordTemps.has(target) || mod.arrayKinds?.[target] === "address")) {
          names.add(target);
        }
        // BATCH-PATCH-74: `arraylength` is NOT here. A block, a record and a function
        // are addresses; a COUNT is a number, and pinning it as an address is what
        // made `s.length - p.length` emit `i32.sub` into an f64 slot. The rule below
        // that learns what the array IS still reads `arraylength` — the operand is an
        // address, the length is not.
        if (inst.op === "arraylit" || inst.op === "objlit" || inst.op === "fnvalue") {
          if (target) names.add(target);
        }
        if (inst.op === "elementref" && (inst as any).asAddress && target) names.add(target);
      }
    }
    addressNames[fn.name] = names;
    // **A seeded PARAMETER is a list too.**
    //
    // `mod.arrayKinds` already carries the seed — `lowerFunction` merges its builder's
    // `arrays` into the module's table, so a seeded parameter is there as "address".
    // But this filter asks `names.has(id)`, and `names` holds the TARGETS of
    // instructions. **A parameter is the target of nothing**, so the seed was being
    // thrown away by the very set that exists to say what a name holds.
    //
    // Measured, and it is not a string problem:
    //
    //     s[1]        → 111   right — the CALLER's local is a target
    //     s[i]        → 8 bytes read as an f64, where the block holds one byte
    //     startsWith  → 0      a false number, on a real match
    //
    // `map`, `indexOf` and `filter` all take their receiver this way, so whatever
    // covers this covers them.
    const seeded = fn.params.filter((p) => (mod.arrayKinds as any)?.[p] === "address");
    arrayNames[fn.name] = new Set([
      ...Object.keys(mod.arrayKinds ?? {}).filter((id) => names.has(id)),
      ...seeded,
    ]);
    arrayElementKind[fn.name] = { ...(mod.arrayKinds ?? {}) };
    paramIsRecord[fn.name] = new Set();
    returnsAddress[fn.name] = false;
    returnsString[fn.name] = false;
  }
  // `for v in records` binds `v` to an address, and the lowering says so.
  for (const fn of mod.functions) {
    for (const [name, kind] of Object.entries(mod.loopVarKinds ?? {})) {
      if (kind === "address") addressNames[fn.name].add(name);
    }
    // A parameter used as the receiver of a field or element access IS a
    // record: `fn place(g, r, c, v) { g.cells[…] = v; return g }`.
    for (const p of receiverParamNames(fn)) {
      const index = fn.params.indexOf(p);
      if (index < 0) continue;
      paramIsRecord[fn.name].add(index);
      addressNames[fn.name].add(p);
    }
  }

  let changed = true;

  // Fields that hold a LIST, for the whole module.
  //
  // `makeGrid` pushes to `g.cells` and `step` only ever READS `g.cells`, so
  // the temp the read produced was never the array of a push and nothing said
  // it was a list. The fact belongs to the FIELD, not to one expression: a
  // record has one shape everywhere, so learning it once in the function that
  // writes is enough for every function that reads.
  const arrayFields = new Set<string>();
  for (const fn of mod.functions) {
    const defs = new Map<string, IRInstruction>();
    for (const b of fn.blocks) {
      for (const inst of b.instructions) {
        const n = nameOf(inst);
        if (n) defs.set(n, inst);
      }
    }
    for (const b of fn.blocks) {
      for (const inst of b.instructions) {
        if (
          inst.op === "arraypush" ||
          inst.op === "arraylength" ||
          inst.op === "elementref" ||
          inst.op === "storeelement"
        ) {
          const def = defs.get(valueName((inst as any).array) ?? "");
          if (def && (def.op === "loadfield" || def.op === "storefield")) {
            // A computed read `o.items[0]` is a `loadfield` too, not an
            // `elementref`, so a list that is only ever INDEXED never reached
            // this set and the field was not known to hold a list at all.
            if (!((def as any).computed) || inst.op !== "arraypush") {
              arrayFields.add((def as any).field);
            }
          }
        }
      }
    }
  }

  let passes = 0;
  while (changed) {
    if (++passes > 40) {
      // A fix point that does not settle is a compiler defect, and the honest
      // shape for one is a sentence with the name in it, not a process that
      // never returns. Reported so the module does not compile; see buglist.md.
      throw new Error(
        `los tipos de este módulo no convergen después de ${passes} pasadas ` +
          `(inferencia de direcciones). Queda pendiente saber qué regla se contradice.`,
      );
    }
    changed = false;
    for (const fn of mod.functions) {
      const mine = addressNames[fn.name];
      const lists = arrayNames[fn.name];
      const kinds = arrayElementKind[fn.name];
      const learn = (name: string | null) => {
        if (name && !mine.has(name)) { mine.add(name); changed = true; }
      };
      /** Record what a list holds, so its elements are read at the right width. */
      const learnKind = (name: string | null, kind: "number" | "address" | undefined) => {
        if (!name || !kind) return;
        // **ONLY EVER WIDEN.** `number` → `address` is a widening and is taken;
        // `address` → `number` is a narrowing and is IGNORED.
        //
        // This is a fix point, and a fix point over a set that can move BOTH ways
        // does not terminate. One program of the corpus — `src/cli/commands/
        // test.no` plus its three imports — learned the same name as a list of
        // records in one function and as numbers in another, so the two rules set
        // `changed` on alternating passes, forever: the emitter burned CPU without
        // emitting anything. And because that program is in the corpus, the gate
        // that says what this backend is worth never finished — it was killed at
        // 280s having written nothing, which is a gate measuring nothing.
        //
        // The other inference loop in this file already says this out loud —
        // "only ever widen: a pass that narrowed would oscillate" — and this one
        // had the same shape without the guard. Widening is also the safe
        // direction: a name read as an ADDRESS is read as a pointer, and a name
        // read as a NUMBER is read at 8 bytes, so guessing wrong in the narrow
        // direction is the one that invents memory.
        //
        // One order over `{number, address}` and a monotone update means the loop
        // settles in at most two passes per name, which is bounded.
        const widen = (current: "number" | "address" | undefined) =>
          current === "address" ? current : kind;
        const next = widen(kinds[name]);
        if (next !== kinds[name]) { kinds[name] = next; changed = true; }
        const asParam = fn.params.indexOf(name);
        if (asParam >= 0) {
          const nextParam = widen(paramKinds[fn.name][asParam]);
          if (nextParam !== paramKinds[fn.name][asParam]) {
            paramKinds[fn.name][asParam] = nextParam;
            changed = true;
          }
        }
      };
      /**
       * Record what a FIELD holds, by the same widening rule as `learnKind`.
       *
       * `kinds` is per function, so one field written with a numeric list in one
       * function and a list of records in another taught this map both facts, and
       * it took the last one each pass — forever. The other half of the pair of
       * non-terminating updates, and it is fed by `learnKind`, so widening one
       * without the other would only have moved the cycle.
       */
      const learnFieldKind = (
        field: string,
        kind: "number" | "address" | undefined,
      ) => {
        if (!field || !kind) return;
        const next = fieldElementKind.get(field) === "address" ? "address" : kind;
        if (next !== fieldElementKind.get(field)) {
          fieldElementKind.set(field, next);
          changed = true;
        }
      };

      for (const block of fn.blocks) {
        for (const inst of block.instructions) {
          // A value used AS AN ARRAY is an address, even when it came from a
          // field read: `g.cells` is a list, not a number. Reading it as an f64
          // is what made `totalAlive` sum zeroes.
          if (
            inst.op === "arraypush" ||
            inst.op === "arraylength" ||
            inst.op === "elementref" ||
            inst.op === "storeelement"
          ) {
            const listName = valueName((inst as any).array);
            learn(listName);
            if (listName && !lists.has(listName)) { lists.add(listName); changed = true; }
            // Writing an ADDRESS into an element means the list holds records.
            if (inst.op === "storeelement") {
              const v = valueName((inst as any).value);
              if (v && mine.has(v)) learnKind(listName, "address");
              else if (v && kinds[v]) learnKind(listName, kinds[v]);
            }
            continue;
          }
          if (inst.op === "call") {
            const cname = (inst as any).callee?.kind === "ref" ? (inst as any).callee.name : "";
            if (!byName.has(cname)) continue;
            if (returnsAddress[cname]) learn((inst as any).target);
            // An argument handed to a record parameter is a record, and a list
            // handed to a list parameter holds the same things.
            const ps = paramIsRecord[cname];
            ((inst as any).args ?? []).forEach((arg: any, i: number) => {
              if (ps.has(i)) learn(valueName(arg));
              learnKind(valueName(arg), paramKinds[cname]?.[i]);
            });
            continue;
          }
          if (inst.op === "objlit") {
            // A field written with a list holds whatever that list holds.
            const fields: string[] = (inst as any).fields ?? [];
            const values: IRValue[] = (inst as any).values ?? [];
            fields.forEach((f, i) => {
              learnFieldKind(f, kinds[valueName(values[i]) ?? ""]);
            });
            continue;
          }
          if (inst.op === "loadfield" || inst.op === "storefield") {
            const field = (inst as any).field;
            if (inst.op === "loadfield" && !(inst as any).computed) {
              const target = nameOf(inst);
              // Reading a field the module knows holds a list reads a list, and
              // it holds the same things the field was written with. Both
              // facts stand on their own: gating the kind on the list would
              // lose it whenever a list is only ever indexed and never pushed
              // or measured, which is `o.items[0].v`.
              const isListField = arrayFields.has(field);
              const kind = fieldElementKind.get(field);
              if (target && (isListField || kind) && !lists.has(target)) {
                lists.add(target);
                changed = true;
              }
              if (target && kind) learnKind(target, kind);
            }
            if (inst.op === "storefield") {
              const v = valueName((inst as any).value);
              learnFieldKind(field, kinds[v ?? ""]);
            }
            learn(valueName((inst as any).object));
          }
        }
        // A binding that copies an address is an address, and a binding that
        // copies a list holds the same things.
        for (const inst of block.instructions) {
          if (inst.op !== "declare" && inst.op !== "assign") continue;
          const v = valueName((inst as any).value);
          if (v && mine.has(v)) learn(nameOf(inst));
          if (v && kinds[v]) {
            learnKind(nameOf(inst), kinds[v]);
            if (!lists.has(nameOf(inst) ?? "") && lists.has(v)) {
              lists.add(nameOf(inst)!);
              changed = true;
            }
          }
        }
        // A `return` of an address makes the whole function return one.
        const t = block.terminator;
        if (t?.op === "return" && t.value && !returnsAddress[fn.name]) {
          if (mine.has(valueName(t.value) ?? "")) {
            returnsAddress[fn.name] = true;
            changed = true;
          }
        }
      }
      // A parameter this function learned to hold a record is part of its
      // SIGNATURE, not just of its body. `blinkerPopulation(g)` only ever hands
      // `g` to `totalAlive(g)`, so it is a record by propagation alone; without
      // this the signature said f64 and the body pushed an i32.
      fn.params.forEach((p, i) => {
        if (mine.has(p) && !paramIsRecord[fn.name].has(i)) {
          paramIsRecord[fn.name].add(i);
          changed = true;
        }
      });
    }
  }
  // Fields that hold an ADDRESS, decided after the fix point because it needs
  // to know what every value IS.
  //
  // A record slot is 8 bytes and is read with whichever width the reader chose.
  // Writing every field as an f64 and reading an address back with `i32.load`
  // takes the low 32 bits of a double — and the low 32 bits of any address in
  // this heap are ZERO, because the address is the whole mantissa. `g.cells`
  // came back as 0, so every grid was the null page. The width is a property of
  // the FIELD, not of one write, so it is learned once for the whole module.
  const fieldIsAddress = new Set<string>();
  const stringFields = new Set<string>();
  for (const fn of mod.functions) {
    const mine = addressNames[fn.name];
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (inst.op === "objlit") {
          const fields: string[] = (inst as any).fields ?? [];
          const values: IRValue[] = (inst as any).values ?? [];
          fields.forEach((field, i) => {
            const value = values[i];
            // **A string literal IS an address, and it has no name for the
            // name-based rule to find.** `valueName` returns null for a literal, so
            // a field written from one was never learned as an address field and
            // was emitted as an f64 slot holding a pointer:
            //
            //     throw new Error("negativo: " + n)   catch (e) { return e.message }
            //     got 4, want "negativo: -4"
            //
            // 4 is the address of the string. This is not an `Error` bug — every
            // record literal that stores a string hits it.
            if (value?.kind === "lit" && (value as any).litType === "string") {
              fieldIsAddress.add(field);
              return;
            }
            const v = valueName(value);
            if (v && mine.has(v)) fieldIsAddress.add(field);
          });
          continue;
        }
        if (inst.op === "storefield") {
          const v = valueName((inst as any).value);
          if (v && mine.has(v)) fieldIsAddress.add((inst as any).field);
          continue;
        }
        if (inst.op === "loadfield" && !(inst as any).computed) {
          const target = nameOf(inst);
          if (target && mine.has(target)) fieldIsAddress.add((inst as any).field);
        }
      }
    }
  }

  // ── Strings ────────────────────────────────────────────────────────────
  //
  // A string, a list and a record are ALL i32, so `addressNames` cannot say which
  // is which — and `.length` had been guessing from a NAME:
  //
  //     "hola".length           →  denormal  (took a different route entirely)
  //     { length: 99 }.length    →  0         (swallowed by the LIST rule, and always
  //                                          has been — a project-long bug)
  //
  // So this is the fact the other two were guesses for. A short fixpoint, because
  // the statements are not in dependency order and `let a = "x"` has to reach a
  // `let b = a` that came before it.
  for (const fn of mod.functions) {
    const mine = (stringNames[fn.name] = new Set<string>());
    for (let pass = 0; pass < 8; pass++) {
      let grew = false;
      const claim = (n: string | null | undefined): boolean => {
        if (!n || mine.has(n)) return !!n && mine.has(n);
        mine.add(n);
        grew = true;
        return true;
      };
      // STRING-SEED-75: what the CALLER knew. A parameter is never assigned a string
      // literal, so the loop below has no way to reach it, and this set is what
      // `isStringValue` asks — one byte per element instead of eight. Claimed before
      // the instructions so the first pass already knows it.
      for (const n of mod.stringSeeds?.[fn.name] ?? []) claim(n);
      for (const block of fn.blocks) {
        for (const inst of block.instructions) {
          if (inst.op === "literal" && (inst as any).kind === "string") {
            claim((inst as any).target);
            continue;
          }
          if (inst.op === "declare" || inst.op === "assign") {
            const v = valueName((inst as any).value);
            if (v && mine.has(v)) claim(nameOf(inst));
            continue;
          }
          if (inst.op === "storefield") {
            const v = valueName((inst as any).value);
            if (v && mine.has(v)) stringFields.add((inst as any).field);
            continue;
          }
          if (inst.op === "loadfield") {
            // **A READ of a string is a string too, and its absence is why every
            // shape of `slice` was refused.** For `s.slice(2)` the receiver that
            // reaches the emitter is the TEMP this `loadfield` produced, not `s`, and
            // a temp nothing had claimed is a number. This is the same gap
            // `isListValue` documents in its own comment: a value that arrives from a
            // field read is an address and is in nobody's set.
            //
            // Two ways, and both are needed — the object being a string
            // (`let s = "…"; s.slice(2)`) and the FIELD being one (`r.name.slice(…)`).
            const o = valueName((inst as any).object);
            if (o && mine.has(o)) claim(nameOf(inst));
            if (!(inst as any).computed && stringFields.has(String((inst as any).field))) {
              claim(nameOf(inst));
            }
            continue;
          }
          if (inst.op === "loadfield") {
            // **A READ of a string is a string too, and its absence is why every
            // shape of `slice` was refused.** For `s.slice(2)` the receiver that
            // reaches the emitter is the TEMP this `loadfield` produced, not `s`, and
            // a temp nothing had claimed is a number. This is the same gap
            // `isListValue` documents in its own comment: a value that arrives from a
            // field read is an address and is in nobody's set.
            //
            // Two ways, and both are needed — the object being a string
            // (`let s = "…"; s.slice(2)`) and the FIELD being one (`r.name.slice(…)`).
            const o = valueName((inst as any).object);
            if (o && mine.has(o)) claim(nameOf(inst));
            if (!(inst as any).computed && stringFields.has(String((inst as any).field))) {
              claim(nameOf(inst));
            }
            continue;
          }
          if (inst.op === "loadfield") {
            // **A READ of a string is a string too, and its absence is why every
            // shape of `slice` was refused.** For `s.slice(2)` the receiver that
            // reaches the emitter is the TEMP this `loadfield` produced, not `s`, and
            // a temp nothing had claimed is a number. This is the same gap
            // `isListValue` documents in its own comment: a value that arrives from a
            // field read is an address and is in nobody's set.
            //
            // Two ways, and both are needed — the object being a string
            // (`let s = "…"; s.slice(2)`) and the FIELD being one (`r.name.slice(…)`).
            const o = valueName((inst as any).object);
            if (o && mine.has(o)) claim(nameOf(inst));
            if (!(inst as any).computed && stringFields.has(String((inst as any).field))) {
              claim(nameOf(inst));
            }
            continue;
          }
          if (inst.op === "call") {
            // **A call that returns a STRING produces a string.** The mirror of the
            // address fixpoint's own `call` case, and the rule whose absence made
            // every method that dispatches on a receiver be refused — because the
            // receiver of a member call is the RESULT of a call.
            const cname = (inst as any).callee?.kind === "ref" ? (inst as any).callee.name : "";
            if (cname && returnsString[cname]) claim(nameOf(inst));
            continue;
          }
          if (inst.op === "binop" && (inst as any).operator === "+") {
            const ln = valueName((inst as any).left);
            const rn = valueName((inst as any).right);
            if ((ln && mine.has(ln)) || (rn && mine.has(rn))) claim(nameOf(inst));
          }
        }
      }
      // A function that RETURNS a string returns one, for the same reason the
      // address fixpoint has: the answer is about the whole program and the caller
      // cannot see it.
      for (const block of fn.blocks) {
        const t = block.terminator;
        if (t?.op === "return" && t.value && !returnsString[fn.name]) {
          if (mine.has(valueName(t.value) ?? "")) {
            returnsString[fn.name] = true;
            grew = true;
          }
        }
      }
      if (!grew) break;
    }
  }

  return {
    paramIsRecord,
    returnsAddress,
    addressNames,
    arrayNames,
    arrayElementKind,
    arrayFields,
    fieldIsAddress,
    returnsString,
    stringNames,
    stringFields,
  };
}

/** True when `fn`'s parameter at `index` holds a record rather than a number. */
function paramIsRecord(types: ModuleAddressTypes, fnName: string, index: number): boolean {
  return types.paramIsRecord[fnName]?.has(index) ?? false;
}

/** The wasm type of a parameter: an address is i32, a number is f64. */
function paramTypeAt(types: ModuleAddressTypes, fnName: string, index: number): WasmValType {
  return paramIsRecord(types, fnName, index) ? "i32" : "f64";
}

function compileFn(fn: IRFunction, funcNames: string[], strings: StringTable, recordLayout: RecordLayout, mod: IRModule, moduleTypes: ModuleAddressTypes, usesFunctionValues: boolean, plainRecords: number[], unsupported: Set<string>): WasmFunc {
  const ctx: CompileCtx = {
    locals: new Map(),
    funcNames: [...funcNames, fn.name],
    nextLocal: 0,
    strings,
    arrays: strings,
    recordLayout,
    loopVarKinds: mod.loopVarKinds ?? {},
    arrayKinds: mod.arrayKinds ?? {},
    moduleTypes,
    defs: new Map(),
    current: fn.name,
    totalFunctions: mod.functions.length,
    allFunctionNames: mod.functions.map((f) => f.name),
    capturesByFunction: mod.captures ?? {},
    unsupported,
    resultTypeOfCurrentFunction: "f64",
    // Which functions return nothing. Asked at every call site, so it is built
    // once here rather than per function: a per-function copy would be the third
    // place that knows the same fact, and the first two already disagreed.
    voidFunctions: new Set(
      mod.functions
        .filter((f) => !f.blocks.some((b) => b.terminator?.op === "return" && !!b.terminator.value))
        .map((f) => f.name),
    ),
    // The build above lays the thunks out as `realCount + i` and
    // `2*realCount + i`; those are the numbers a closure record's first word
    // holds, and `plainRecordAddress` is where a captureless function's record
    // already lives.
    plainThunkIndex: (i: number) => mod.functions.length + i,
    closureThunkIndex: (i: number) => 2 * mod.functions.length + i,
    plainRecordAddress: (i: number) => plainRecords[i] ?? 0,
    uniformTypeIndex: usesFunctionValues ? 0 : -1,
    scratchLocal: (type: WasmValType = "i32") => {
      const index = ctx.nextLocal++;
      localTypes.push(type);
      return index;
    },
  };

  // A wasm parameter IS the local of the same name, so the two are created
  // together from one list of types. Deriving the signature separately — the old
  // `inferParamType`, which returned f64 on every path — let the signature
  // contradict the body for a parameter that holds a record.
  const paramTypes: WasmValType[] = fn.params.map((_, i) => paramTypeAt(moduleTypes, fn.name, i));
  fn.params.forEach((p, i) => {
    ctx.locals.set(p, { index: ctx.nextLocal++, type: paramTypes[i] });
  });

  // First pass: collect all locals/temps and infer types.
  const localTypes: WasmValType[] = [];
  inferLocals(fn, ctx, localTypes);

  // The signature comes from the SETTLED types, after convergence, so it can
  // never contradict the body it describes.
  const resultType = inferResultType(fn, ctx);
  // The signature comes from the SETTLED types, after convergence, so it can
  // never contradict the body it describes. An exception propagation returns a
  // zero of this width, so it has to be known before anything is emitted.
  ctx.resultTypeOfCurrentFunction = resultType ?? "f64";

  // Second pass: emit bytecode.
  //
  // Control flow is walked from the block graph, never a flat list. A `br` in
  // wasm is a BRANCH to the Nth enclosing `block`/`loop`/`if`, not a goto, so a
  // loop is `block { loop { cond; eqz; br_if 1; body; br 0 } }`:
  //   - `br 0` re-enters the loop
  //   - `br_if 1` leaves it, and the enclosing `block` is what gives depth 1
  //     somewhere to go
  // The previous version emitted an EMPTY `if`/`end` per branch, so both arms of
  // an `if` ran and a loop ran exactly once.
  const body: number[] = [];
  // Which instruction produced each name. A `push` that grows an array has to
  // write the new address back to wherever it was read from, and that is only
  // knowable by looking at the definition.
  for (const b of fn.blocks) {
    for (const inst of b.instructions) {
      const name = nameOf(inst);
      if (name) ctx.defs.set(name, inst);
    }
  }
  const byLabel = new Map<string, IRBlock>();
  for (const b of fn.blocks) byLabel.set(b.label, b);
  const order = fn.blocks.map((b) => b.label);
  const idx = (label: string) => order.indexOf(label);

  /** Push the result value (or a zero) WITHOUT emitting the `return`. */
  const emitReturnValue = (v: IRValue | null) => {
    if (v && resultType) emitValue(v, ctx, resultType, body);
    else if (resultType === "f64") { body.push(OP.f64_const); encodeF64(body, 0.0); }
    else if (resultType === "i32") { body.push(OP.i32_const); encodeI32(body, 0); }
  };

  /** Emit instructions; returns true when the block ended in a `return`. */
  const emitBody = (block: IRBlock): boolean => {
    for (const inst of block.instructions) emitInst(inst, ctx, body);
    const t = block.terminator;
    if (t?.op === "return") {
      emitReturnValue(t.value);
      body.push(OP.return);
      return true;
    }
    return false;
  };

  let bi = 0;
  // `openDepth` counts the `block`/`loop` pairs currently open, so a `return`
  // can close them all. A `return` leaves the FUNCTION, so every construct it
  // was nested in has to be closed after it or the stream goes misaligned.
  let openDepth = 0;

  /**
   * Innermost last: where each enclosing construct a `break` or a `continue` can
   * leave through sits, and at what `openDepth`.
   *
   * `br` is a branch to the Nth enclosing `block`/`loop`/`if`, so the depth a
   * jump needs is NOT a constant — it is one more for every construct the jump
   * happens to sit inside. The previous attempt stored `1` and emitted `br 1`
   * unconditionally, which at the top of a loop body targets the LOOP and
   * re-enters it forever: the test suite hung rather than failing.
   *
   * So the depth is computed where the jump is emitted, against the depth of the
   * construct being LEFT:
   *
   *     N = openDepth - scopeDepth
   *
   * and a scope records the depth of EACH thing a jump can target, not a base to
   * add a constant to. That distinction is the whole bug: a loop opens two
   * constructs and its `break` leaves the outer one, so `br (openDepth - base) + 1`
   * is right for a loop and wrong for a `switch`, which opens one. Adding the `+1`
   * to the switch — or dropping it from the loop — puts the branch one level out,
   * and one level out from inside a `switch` is not a wrong answer but a `br` to
   * the FUNCTION body, which needs a result on the stack and makes the module
   * invalid. Both earlier attempts were this same `+1`, which is why putting the
   * base somewhere else could not have fixed them: two placements failing by one
   * in OPPOSITE directions is the signature of a constant that is wrong, not of a
   * base that is misplaced.
   */
  const breakScopes: {
    exit: string;
    header: string | null;
    /** `openDepth` of the construct a `break` leaves through. */
    exitDepth: number;
    /** `openDepth` of the construct a `continue` re-enters, if it has one. */
    headerDepth: number | null;
  }[] = [];

  /**
   * The scope that OWNS a jump target, or null when nothing open claims it.
   *
   * Reading only the innermost scope was wrong the moment a `switch` appeared:
   * a `break` out of a LOOP from inside a switch, and a `continue` out of a loop
   * from inside a switch, both name a label the innermost scope does not hold.
   * The lowered jump carries the label of the construct it leaves, so the whole
   * stack is searched and the label decides — not the position.
   */
  const scopeFor = (target: string) => {
    for (let i = breakScopes.length - 1; i >= 0; i--) {
      const s = breakScopes[i];
      if (s.exit === target || s.header === target) return s;
    }
    return null;
  };

  /**
   * The blocks of one `if` ARM, from `from` up to the merge block at `to`.
   *
   * An arm ends at the block that jumps to the merge point.
   *
   * The branch's `elseLabel` ALWAYS names the merge, never the else arm: the
   * lowering writes `elseLabel: endLabel`, and the else arm is named separately
   * by `elseArm`. Reading `elseLabel` as the else arm emitted the merge block's
   * instructions into the `else` slot and then emitted the real else arm as a
   * fall-through, which is why `if c { a = 1 } else { a = 5 }` set `a = 5` when
   * `c` was true and left it alone when `c` was false — the two arms ran at the
   * wrong times.
   *
   * `to` is the merge and the START comes from the caller, because the end of an
   * arm is not knowable from its own blocks: this stops at the first jump to the
   * merge, and an arm holding a nested `if` jumps to the merge from inside that
   * nested `if`, long before the outer arm is finished. That is why the else arm
   * is named rather than inferred — see `elseArm`.
   */
  const armBlocks = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let k = from; k < to; k++) {
      out.push(k);
      const kt = fn.blocks[k].terminator;
      // An arm is finished when it RETURNS or when it jumps to the merge point.
      // Only the second case was recognised, so an arm that returned ran on and
      // swallowed the NEXT one — and the next one is the else arm. Every
      // `if (c) { return a } else { return b }` compiled to the then-arm alone
      // and answered 0 when the condition was false.
      if (kt?.op === "return") break;
      if (kt?.op === "jump" && idx(kt.target) === to) break;
    }
    return out;
  };

  /**
   * Emit one arm's blocks. A `return` or a jump that leaves the arm ends it — but
   * a nested construct does NOT, unless it is the last thing in the arm.
   *
   * `blocks` is the arm, already sliced by `armBlocks`, so it is the authority on
   * how far the arm reaches. A nested construct returns the index of the first
   * block it did not emit, and the walk RESUMES there if that block is still in
   * this arm.
   *
   * It used to `return` unconditionally after any nested `branch`. That is right
   * for a nested `if` that happens to be the whole arm, and wrong for a LOOP with
   * more statements after it in the same arm — which is a `case` body of the shape
   * the corpus is full of:
   *
   *     case "ClassBody" {
   *       for m in members { walkClassMember(m, v) }   ← emitted
   *       out.push(collect)                            ← silently dropped
   *     }
   *
   * Six shapes of that, all of which **validated** and returned a wrong number:
   * the loop ran, and everything after it in the case did not.
   */
  const emitArm = (blocks: number[]): void => {
    /**
     * Where to carry on after a nested construct, or null if the arm is finished.
     *
     * `blocks` is the arm, already sliced by `armBlocks`, so it is the authority
     * on how far the arm reaches; `next` is the first block the nested construct
     * did not emit. A `next` outside the list means the construct was the whole of
     * the arm.
     *
     * The walk is an INDEXED loop, not a `for…of`, on purpose: `for (let k of
     * blocks) { k = again; continue; }` looks like it repositions the walk and does
     * not — `continue` asks the iterator for the next element, which is past the
     * end, so the arm ends early and silently. That is the same symptom as the bug
     * being fixed, which is why it is written down here.
     */
    const resume = (next: number): number | null => {
      const at = blocks.indexOf(next);
      if (at > 0 && at < blocks.length) return at;
      return null;
    };

    for (let i = 0; i < blocks.length; i++) {
      const kb = fn.blocks[blocks[i]];
      for (const inst of kb.instructions) emitInst(inst, ctx, body);
      const kt = kb.terminator;
      if (kt?.op === "return") {
        emitReturnValue(kt.value);
        body.push(OP.return);
        return;
      }
      if (kt?.op === "branch") {
        const again = resume(emitBranch(kb));
        if (again === null) return;
        i = again - 1;
        continue;
      }
      if (kt?.op === "jump") {
        // A jump to a label an open construct OWNS is that construct's `break` or
        // `continue`, and it differs by one level: a `break` leaves through the
        // `block` that wraps the construct, and a `continue` goes back through the
        // `loop` itself.
        const scope = scopeFor(kt.target);
        if (scope) {
          const toTarget = kt.target === scope.exit ? scope.exitDepth : scope.headerDepth!;
          body.push(OP.br, openDepth - toTarget);
          return;
        }
        // Otherwise it is a jump onto a loop's header, which starts a nested loop.
        //
        // **And that loop does not have to be the whole arm.** The lowering starts
        // a `for` by terminating the current block with a JUMP to the loop header,
        // so the first block of a `case` body that is a loop arrives here rather
        // than through the `branch` case above. Emitting the loop and returning
        // dropped everything after it in the case:
        //
        //     case "ClassBody" {
        //       for m in members { walkClassMember(m, v) }   ← emitted
        //       out.push(collect)                            ← silently dropped
        //     }
        //
        // Six shapes of that, all of which VALIDATED and returned a wrong number,
        // while the same program without the `switch` was right.
        const target = byLabel.get(kt.target);
        if (target && target.terminator?.op === "branch" && isLoopHeaderBlock(target, target.label)) {
          const again = resume(emitLoopHeader(target));
          if (again === null) return;
          i = again - 1;
          // Carry on with the rest of the case. The bare `return` below used to
          // run right after this assignment and cancel it, which is why the first
          // version of this fix changed nothing at all.
          continue;
        }
        return;
      }
    }
  };

  /**
   * Emit a plain `if` from `block`, and return the index of the merge block.
   * Recursive: a nested `if` in an arm is emitted as a real `if`, so a
   * condition inside a loop is never flattened away.
   */
  const emitPlainIf = (block: IRBlock): number => {
    const term = block.terminator as Extract<IRTerminator, { op: "branch" }>;
    for (const inst of block.instructions) emitInst(inst, ctx, body);
    emitValue(term.condition, ctx, "i32", body);
    body.push(OP.if, 0x40);
    openDepth += 1;

    const mergeIdx = idx(term.elseLabel);
    const thenStart = idx(term.thenLabel);
    const thenBlocks = thenStart < mergeIdx ? armBlocks(thenStart, mergeIdx) : [];
    // Where the else arm BEGINS. The lowering says so, because an arm holding a
    // nested `if` does not end where its last jump is: `armBlocks` stops at the
    // nested arm's jump to the merge, so "one block after the then arm" lands
    // INSIDE the then arm. The emitter emitted that block a second time as the
    // else, and in a `switch` that meant the default ran whatever the case did.
    const elseStart = term.elseArm ? idx(term.elseArm) : thenStart + thenBlocks.length;
    const elseBlocks = elseStart < mergeIdx ? armBlocks(elseStart, mergeIdx) : [];

    emitArm(thenBlocks);
    // An `else` is only valid on an `if` that HAS a result type, and this one is
    // emitted as void — so it may appear only when there is an else arm at all.
    // When the then-arm ends in a `return` the else arm is empty, and the `else`
    // that used to be emitted anyway made the module invalid. Every `if/else`
    // whose then-branch returns was broken, and that is most of them.
    if (elseBlocks.length > 0) {
      body.push(OP.else);
      emitArm(elseBlocks);
    }
    body.push(OP.end);
    openDepth -= 1;

    return mergeIdx;
  };

  /**
   * Emit a `switch`: the same chain of comparisons as a plain `if`, wrapped in
   * one `block` so that a jump out of a case has a construct to leave through.
   *
   * The chain itself needs nothing of its own — the `else` of one test is the
   * next test, and `emitPlainIf` already recurses through that. What it lacked
   * was the TARGET of the jump: in wasm, `break` is a `br` to the Nth enclosing
   * construct, and with no `block` around the chain that construct is the case's
   * own `if`, so every `break` fell into its own arm and the module was invalid.
   *
   * The depth is the arithmetic the loop already gets right, applied to the
   * depth of the construct being left — `br (openDepth - exitDepth)`. A `switch`
   * chain opens ONE construct where a loop opens two, which is the entire reason
   * the loop's old `+ 1` does not transfer: copied here it put the branch one
   * level too far out, and one level too far out from a case is the function
   * body, which wants a result value on the stack and makes the module invalid.
   */
  const emitSwitchChain = (
    block: IRBlock,
    term: Extract<IRTerminator, { op: "branch" }>,
  ): number => {
    body.push(OP.block, 0x40);
    openDepth += 1;
    // Published for the whole chain, so a `break` two `if`s down computes its
    // depth from THIS block, and a `break` out of an enclosing LOOP from inside
    // a case still finds that loop's own depth further down the stack.
    breakScopes.push({ exit: term.switchExit!, header: null, exitDepth: openDepth, headerDepth: null });
    const mergeIdx = emitPlainIf(block);
    breakScopes.pop();
    body.push(OP.end);
    openDepth -= 1;
    return mergeIdx;
  };

  /**
   * Emit a `branch` block, whichever of the three shapes it is.
   *
   * One dispatch rather than three copies of the same question: a `switch` at
   * the top of a function body, at the top of a loop body and inside an `if` arm
   * are three different places in the walk, and a construct that only works in
   * one of them is a construct that half works.
   */
  const emitBranch = (block: IRBlock): number => {
    const t = block.terminator as Extract<IRTerminator, { op: "branch" }>;
    if (isLoopHeaderBlock(block, block.label)) return emitLoopHeader(block);
    if (t.switchExit) return emitSwitchChain(block, t);
    return emitPlainIf(block);
  };
  /**
   * True when `block` is a loop header: a `branch` whose then-arm jumps back to
   * it.
   */
  const isLoopHeaderBlock = (block: IRBlock, label: string): boolean => {
    const t = block.terminator;
    if (t?.op !== "branch") return false;
    for (let k = idx(t.thenLabel); k < idx(t.elseLabel); k++) {
      const kt = fn.blocks[k].terminator;
      if (kt?.op === "jump" && idx(kt.target) === idx(label)) return true;
    }
    return false;
  };

  /**
   * Emit a loop, and return the index of the first block after it.
   *
   * Recursive, because a loop body can contain another loop or an `if`. Both
   * were previously emitted inline, which dropped their tests and their back
   * edges: a conditional ran on every iteration, and a nested loop never
   * advanced and hung the program.
   */
  const emitLoopHeader = (block: IRBlock): number => {
    const t = block.terminator as Extract<IRTerminator, { op: "branch" }>;

    body.push(OP.block, 0x40);
    body.push(OP.loop, 0x40);
    // A `break` leaves through the `block`, a `continue` goes back through the
    // `loop`. Two constructs, two depths, and they differ by exactly one — which
    // is the whole reason the depth is recorded per target instead of as one
    // base plus a constant.
    const blockDepth = openDepth + 1;
    const loopDepth = openDepth + 2;
    openDepth += 2;
    for (const inst of block.instructions) emitInst(inst, ctx, body);
    // `emitValue(..., "i32")` already converts the comparison; a second trunc
    // made the engine reject the module.
    emitValue(t.condition, ctx, "i32", body);
    body.push(OP.i32_eqz);
    body.push(OP.br_if, 0x01); // false -> leave the loop

    const exitIdx = idx(t.elseLabel);
    // Published while the body is emitted, so a `break` in an arm nested inside
    // an `if` can find the loop's exit AND count the constructs between.
    breakScopes.push({
      exit: t.elseLabel,
      header: block.label,
      exitDepth: blockDepth,
      headerDepth: loopDepth,
    });
    let returned = false;
    for (let k = idx(t.thenLabel); k < exitIdx; k++) {
      const kb = fn.blocks[k];
      const kt = kb.terminator;

      if (kt?.op === "branch") {
        // A nested loop, `switch` or `if` keeps its own test and its own back edge.
        k = emitBranch(kb) - 1;
        continue;
      }

      for (const inst of kb.instructions) emitInst(inst, ctx, body);

      if (kt?.op === "return") {
        emitReturnValue(kt.value);
        body.push(OP.return);
        returned = true;
        break;
      }

      if (kt?.op === "jump") {
        const target = kt.target;
        const targetBlock = byLabel.get(target);
        // Two shapes reach here:
        //  - a BACK EDGE: a `forstep` block jumping to THIS loop's header. It
        //    becomes `br 0` and re-enters the iteration.
        //  - a jump onto ANOTHER loop's header, which starts a nested loop.
        // Treating the back edge as a nested loop re-entered the same block
        // forever and overflowed the stack.
        const isBackEdge = idx(target) <= k;
        if (isBackEdge) {
          body.push(OP.br, 0x00);
          continue;
        }
        // A JUMP TO THIS LOOP'S OWN EXIT is a `break`, at the same depth the
        // arms compute: one `br` per construct opened since the loop began.
        if (kt.target === t.elseLabel) {
          const scope = scopeFor(kt.target) ?? breakScopes[breakScopes.length - 1];
          body.push(OP.br, openDepth - scope.exitDepth);
          // The rest of this body is unreachable from here and the loop's exit
          // is emitted by the caller, so stop walking it — WITHOUT claiming the
          // function is finished, which would skip the code after the loop.
          break;
        }
        if (
          targetBlock &&
          targetBlock.terminator?.op === "branch" &&
          isLoopHeaderBlock(targetBlock, targetBlock.label)
        ) {
          k = emitLoopHeader(targetBlock) - 1;
          continue;
        }
        if (idx(target) !== k + 1) {
          // Forward jump that skips blocks: what follows is unreachable here.
          emitReturnValue(null);
          body.push(OP.return);
          returned = true;
          break;
        }
      }
    }

    body.push(OP.end); // close the loop
    body.push(OP.end); // close the block
    openDepth -= 2;
    breakScopes.pop();

    return returned ? fn.blocks.length : exitIdx;
  };

  while (bi < fn.blocks.length) {
    const block = fn.blocks[bi];
    const t = block.terminator;

    if (t?.op === "jump" && idx(t.target) < bi) {
      // Back edge: re-enter the enclosing loop (depth 0 from here).
      body.push(OP.br, 0x00);
      bi++;
      continue;
    }

    if (t?.op === "jump") {
      // A forward jump that LANDS ON A LOOP HEADER starts a nested loop:
      //   for i { for j { ... } }   →   outer body jumps to the inner header
      // Emitting a bare fall-through left the inner loop with no `loop` and no
      // back edge, so it never advanced and the whole program hung.
      const target = byLabel.get(t.target);
      if (target && target.terminator?.op === "branch" && isLoopHeaderBlock(target, target.label)) {
        for (const inst of block.instructions) emitInst(inst, ctx, body);
        bi = emitLoopHeader(target);
        continue;
      }
      const skips = idx(t.target) !== bi + 1;
      for (const inst of block.instructions) emitInst(inst, ctx, body);
      if (skips) { emitReturnValue(null); body.push(OP.return); bi++; continue; }
      bi++;
      continue;
    }

    if (t?.op === "branch") {
      // A LOOP HEADER is a branch whose then-arm jumps back to this same block;
      // a `switch` is one whose first test opens a chain. Both are the same shape
      // here, and the shared dispatch is what keeps a `switch` working at the top
      // of a function, inside a loop and inside an `if` arm alike.
      bi = emitBranch(block);
      continue;
    }

    if (emitBody(block)) { bi++; continue; }
    bi++;
  }

  // Close anything still open, then satisfy the fallthrough type check.
  for (let d = 0; d < openDepth; d++) body.push(OP.end);
  emitReturnValue(null);
  body.push(OP.return);

  return {
    name: fn.name,
    type: { params: paramTypes, results: resultType ? [resultType] : [] },
    locals: localTypes,
    body,
  };
}

/**
 * Assign a wasm type to every local, iterating until the assignment stops
 * changing.
 *
 * A single pass is not enough, because types propagate along data flow and the
 * statements are not in dependency order. In
 *
 *     for o in records { t = t + o.v }
 *
 * the accumulator `t` is met before the loop variable `o` has a type, so it
 * falls back to the default and the function signature comes out `i32` instead
 * of `f64`; the body then stores an f64 into an i32 slot and the loop
 * accumulates 0. Re-running the same rules with the types learned by the
 * previous pass resolves it — the standard fix-point for local typing.
 */
// ── Local Type Inference ────────────────────────────────────────────
//
// A wasm function gives every local ONE type for its whole life, so the
// compiler has to know a value's type before it emits anything. Types arrive
// along data flow and the statements are NOT in dependency order, so one pass
// is not enough: in
//
//     for o in records { t = t + o.v }
//
// the accumulator `t` is met before the loop variable `o` has a type, and a
// single pass types it from a default. Every earlier attempt at this fixed it
// by patching the default, which is why the fix is a proper fix point here
// instead.
//
// Three explicit phases:
//
//   1. RESERVE  — every name gets a slot, in program order. A name's index
//                 must not depend on when its type is discovered, or a later
//                 discovery shifts every index after it and the body writes
//                 to the wrong local.
//   2. CONVERGE — repeat the typing rules until no name changes. Types only
//                 widen (i32 → f64); a name pinned to i32 never widens.
//   3. SIGNATURE— the function's result type is derived from the settled
//                 types, so it cannot contradict the body.
//
// Widening rather than narrowing is what makes this terminate and is also
// correct: a narrow signature would make the body store an f64 into an i32
// slot, which the engine rejects.

/** Widen a the least constraining of two types. An address never widens. */
function widen(a: WasmValType, b: WasmValType): WasmValType {
  return a === "f64" || b === "f64" ? "f64" : "i32";
}

/**
 * The kind of value an instruction produces, independent of the types of its
 * operands. `null` means "depends on operands" and is resolved in the
 * convergence loop.
 */
function producedKind(inst: IRInstruction, ctx: CompileCtx): WasmValType | "address" | null {
  switch (inst.op) {
    // A string, an array and a record are addresses. A LENGTH IS NOT: it is a count,
    // and `arraypush` below already says so for the very same number. Grouping the
    // two is what put an `i32` under an `f64` subtraction.
    case "arraylit":
    case "objlit":
    case "fnvalue":
      return "address";
    // BUG-WASM-83. And so does a block the PROGRAM fills: it is the same string
    // block `emitStringBlock` builds, so the local that holds it is an address and
    // not a number. Stated here rather than left to a use site, because a local
    // that starts f64 and is written an i32 is the engine saying "expected type f64,
    // found i32" — and this is the third time that family has cost a turn.
    case "allocblock":
      return "address";
    case "arraypush":
      // push returns the new length, a number.
      return "f64";
    case "arraylength":
      // So does this one. Stated rather than defaulted, so that a reader does not
      // have to infer it from the absence of a case.
      return "f64";
    case "elementref":
      return (inst as any).asAddress ? "address" : "f64";
    case "loadfield":
      return "f64";
    case "call": {
      // A call can return a number OR an address (`cells.push(0)` returns the
      // array, `makeGrid()` returns a record). Typing every call as f64 made
      // the body store an i32 into an f64 slot:
      //   "local.set[0] expected type f64, found call of type i32"
      const callee = (inst as any).callee;
      const name = callee?.kind === "ref" ? callee.name : "";
      return ctx.moduleTypes.returnsAddress[name] ? "address" : "f64";
    }
    case "unaryop":
      return null; // depends on its argument
    case "binop":
      return null; // depends on its operands
    case "declare":
    case "assign":
    case "literal":
      return null;
    default:
      return null;
  }
}

function nameOf(inst: IRInstruction): string | undefined {
  if (inst.op === "declare") return inst.name;
  if (inst.op === "storefield") return undefined;
  return (inst as any).target;
}

/**
 * Reserve a slot for every name in program order and converge its type.
 * Fills `ctx.locals` and `localTypes`.
 */
function inferLocals(fn: IRFunction, ctx: CompileCtx, localTypes: WasmValType[]): void {
  // A name the module analysis already decided holds an ADDRESS. These are
  // facts, not guesses, and are never widened.
  //
  // This used to be a list of rules re-derived here — record literals, array
  // kinds, loop variables, the receiver of a field access, the two operands of
  // a `storeelement`. Each was a fact the module analysis had already
  // established and each was computed a second time, so they drifted: the
  // signature learned that `seedGlider`'s `g` was a record while the local map
  // did not, and the body read an i32 through an f64 slot. One source now.
  const moduleAddresses = ctx.moduleTypes.addressNames[fn.name] ?? new Set<string>();
  const pinned = new Map<string, WasmValType>();
  for (const name of moduleAddresses) pinned.set(name, "i32");

  // An `elementref` used as a value, and a `for` variable the lowering already
  // typed, are facts too — and the number case matters, because widening an
  // address to f64 would read the pointer as a number.
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      const name = nameOf(inst);
      if (inst.op === "elementref" && !(inst as any).asAddress && name) {
        pinned.set(name, "f64");
      }
      if (inst.op === "assign" && name) {
        const declared = ctx.loopVarKinds[name];
        if (declared) pinned.set(name, declared === "address" ? "i32" : "f64");
      }
    }
  }

  // ── Phase 1: reserve ──────────────────────────────────────────────
  // Order is program order, and an operand that only appears inside an
  // instruction still gets a slot, because emitValue resolves by name.
  const ensure = (name: string): void => {
    if (!name || ctx.locals.has(name)) return;
    const initial = pinned.get(name) ?? "f64";
    localTypes.push(initial);
    ctx.locals.set(name, { index: ctx.nextLocal++, type: initial });
  };
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      ensure(nameOf(inst));
      // A `storeelement` names its array and its value; `valueName` resolves
      // both a binding and a temp, which `.id` alone did not.
      if (inst.op === "storeelement") {
        ensure(valueName((inst as any).array) ?? "");
        ensure(valueName((inst as any).value) ?? "");
      }
    }
  }
  // Operands of assignments and operands generally are already named targets,
  // except a literal, which needs no slot.

  // ── Phase 2: converge ─────────────────────────────────────────────
  // A pass re-derives every name's type from the CURRENT types of its
  // operands. Because a name's type only ever widens, the number of passes is
  // bounded by the number of names; the cap is a guard, not the mechanism.
  const derive = (inst: IRInstruction): WasmValType | null => {
    switch (inst.op) {
      case "literal":
        return inferLitType(inst.value, inst.kind);
      case "binop": {
        const lt = resolveType(inst.left, ctx);
        const rt = resolveType(inst.right, ctx);
        return inferBinOpType(inst.operator, lt, rt);
      }
      case "unaryop":
        return resolveType(inst.argument, ctx);
      case "declare":
        return inst.value ? resolveType(inst.value, ctx) : "i32";
      case "assign":
        return resolveType(inst.value, ctx);
      case "call": {
        // Ask the MODULE, exactly as `producedKind` does a few lines up.
        //
        // This said `return "f64"` unconditionally, which is the third copy of
        // one rule and the reason two of them disagreed: a call that returns a
        // RECORD was typed as a double by the local map while the module analysis
        // knew it returned an address and pinned the destination. The destination
        // stayed i32 and the body stored the call's f64 straight into it:
        //
        //     local.set[0] expected type i32, found call of type f64
        //
        // The signature and the body are two answers to "does this call return a
        // record", and the fix point in `inferModuleAddressTypes` is the one that
        // already has the answer for the whole program.
        const callee = (inst as any).callee;
        const cname = callee?.kind === "ref" ? callee.name : "";
        return ctx.moduleTypes.returnsAddress[cname] ? "i32" : "f64";
      }
      case "loadfield":
        return "f64";
      default:
        return null;
    }
  };

  for (let round = 0; round <= ctx.nextLocal + 1; round++) {
    let changed = false;
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        const name = nameOf(inst);
        if (!name) continue;
        const existing = ctx.locals.get(name);
        if (!existing) continue;
        const fixed = pinned.get(name);
        if (fixed) {
          // Apply the fact, and never widen past it.
          if (existing.type !== fixed) { existing.type = fixed; changed = true; }
          continue;
        }
        const derived = derive(inst);
        if (derived && derived !== existing.type) {
          // Only ever widen: a pass that narrowed would oscillate.
          const next = widen(existing.type, derived);
          if (next !== existing.type) { existing.type = next; changed = true; }
        }
      }
    }
    if (!changed) break;
  }

  // A pinned name must end up pinned even if the loop above never touched it.
  for (const [name, type] of pinned) {
    const slot = ctx.locals.get(name);
    if (slot) slot.type = type;
  }

  // **Write the settled types back into the array that is actually declared.**
  //
  // `ctx.locals[name].type` and `localTypes[i]` were two facts about the same slot
  // that drifted: the first is settled by inference, the second is whatever the
  // slot was RESERVED with, which is `f64` for anything not pinned. A name that
  // inference settles on `i32` — every comparison result — was therefore declared
  // as an `f64` local while emitted as though it were `i32`, and the emitter
  // correctly declined to convert because it believed both already were `i32`.
  // The engine is where that surfaces:
  //
  //     i32.eqz[0] expected type i32, found local.get of type f64
  //
  // on **10 of the 16** corpus modules the engine rejected.
  //
  // **The offset is the whole trap, and it is why the first attempt broke 25 of
  // 838 tests.** `ensure` pushes onto `localTypes` and takes the slot index from
  // `ctx.nextLocal`, which is ALREADY `fn.params.length` by then — a parameter is
  // the local of the same name and the two are created together. So
  // `localTypes[k]` is slot `params.length + k`, and writing `localTypes[slot.index]`
  // shifts every settled type by the number of parameters: the first body local
  // lands on the second one's declaration and the last one runs off the end. That
  // is not a wrong type, it is a SCRAMBLED set of types, and a function with four
  // mixed-kind locals then fails for a reason unrelated to the fix.
  //
  // The arithmetic is written out rather than left implicit for that reason.
  const firstBodyLocal = fn.params.length;
  for (const slot of ctx.locals.values()) {
    const at = slot.index - firstBodyLocal;
    if (at >= 0 && at < localTypes.length) localTypes[at] = slot.type;
  }
}

/**
 * The function's single result type, derived from the settled local types.
 * Every `return` must agree, so the result is the widest of them; taking the
 * first one found picked a loop's i32 comparison over the real `return t`.
 */
function inferResultType(fn: IRFunction, ctx: CompileCtx): WasmValType | null {
  // BUG-WASM-84. **The module already knows whether this function gives an address, and
  // that IS the result type.** It was read at the call site (`returnsAddress`, which is
  // what types the call's result local) and computed again here from the types of the
  // returned VALUES — two rules for one fact, and they disagreed exactly where a value's
  // own type does not describe what the function hands back.
  //
  // A string LITERAL types as f64 (`resolveType` asks `inferLitType`, and a string is not
  // a number), while the same string in a local is i32. So `return "ab"` on one path and
  // `return b` — a block — on another widened to f64, and the caller, reading the same
  // function as an address, stored an i32 into it. The engine's words were
  // `local.set[0] expected type i32, found call of type f64`.
  //
  // Measured, one ingredient at a time (`.mavis-probe/ablate83.txt`):
  //
  //   fn mk()   { const b = allocblock(2)  return b }        () => (i32)   VALID
  //   fn mk(k) { const b = allocblock(k)  return b }        (f64) => (i32) VALID
  //   fn mk()   { if 1 == 1 { return "ab" }  …  return b } () => (f64)   ENGINE REFUSES
  //
  // **It can only make a module more valid, never less.** Every call site already pushes
  // i32 for a function `returnsAddress` calls an address, so a callee whose signature says
  // f64 is a module the engine already refuses. Making the signature agree turns an
  // invalid module into a valid one; there is no program that was accepted and stops
  // being accepted.
  if (ctx.moduleTypes.returnsAddress[fn.name]) return "i32";
  let result: WasmValType | null = null;
  for (const block of fn.blocks) {
    if (block.terminator?.op !== "return" || !block.terminator.value) continue;
    const t = resolveType(block.terminator.value, ctx);
    result = result === null ? t : widen(result, t);
  }
  return result;
}

function resolveType(v: IRValue, ctx: CompileCtx): WasmValType {
  if (v.kind === "lit") return inferLitType(v.value, v.litType);
  if (v.kind === "ref") return ctx.locals.get(v.name)?.type ?? "f64";
  if (v.kind === "temp") return ctx.locals.get(v.id)?.type ?? "f64";
  return "f64";
}

// ── Bytecode Emission ───────────────────────────────────────────────

/** Memory argument for a load/store: two LEB128 zero bytes (align, offset). */
function emitU32MemArg(buf: number[], align: number, offset: number): void {
  emitLEB128U(buf, align);
  emitLEB128U(buf, offset);
}

/**
 * Emit `array.push(value)` inline.
 *
 * There is no runtime library in this backend, so the method compiles to its own
 * bytecode: store at `base + 8 + len*8`, then bump the length, leaving the new
 * length on the stack, which is what `push` returns.
 *
 * When the block is FULL it is GROWN, not truncated. The previous version
 * dropped the value instead, and every symptom looked like something else: an
 * 8×8 grid held 8 cells, `totalAlive` summed the wrong ones, and the missing
 * cells read as whatever happened to be in memory. `makeGrid(8, 8)` is 64
 * pushes, so the game never had a grid.
 *
 *   if (len < cap) { store at base + 8 + len*8 }
 *   else { newBase = alloc(8 + cap*2*8); copy len*8 bytes; rebind; store }
 *
 * The rebind matters: an array reached through a binding (`g.cells`) has its
 * address in a local, and a new block has to be written back there or the very
 * next `push` would grow the old one again.
 */
function emitArrayPush(ctx: CompileCtx, buf: number[], base: IRValue, value: IRValue): void {
  // The length is read once into a local; the `if` below then only consumes the
  // comparison result, so nothing is left on the stack across the block.
  const lenLocal = ctx.scratchLocal();
  const capLocal = ctx.scratchLocal();
  const baseLocal = ctx.scratchLocal();
  const newBaseLocal = ctx.scratchLocal();
  // **What the list HOLDS, asked once.** A list of addresses is an i32 slot and a
  // list of numbers is an f64 slot, and the write has to agree with the read that
  // will come looking for it.
  const asAddress = isAddressArrayValue(ctx, base);

  // The base address is read ONCE into a local. The growth branch replaces it,
  // and every later use must see the new block, not the original expression.
  emitValue(base, ctx, "i32", buf);
  buf.push(OP.local_set);
  emitLEB128U(buf, baseLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, baseLocal);
  buf.push(OP.i32_load);
  emitU32MemArg(buf, 0, 0); // offset 0 = the length word
  buf.push(OP.local_set);
  emitLEB128U(buf, lenLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, baseLocal);
  buf.push(OP.i32_load);
  emitU32MemArg(buf, 0, 4); // offset 4 = the capacity word
  buf.push(OP.local_set);
  emitLEB128U(buf, capLocal);

  // if (len < cap) { … } else { grow }
  //
  // `cap` lives in the SECOND WORD of the header, so it is read with the memory
  // ARGUMENT's offset, not by pushing a constant before the load. Pushing `4`
  // and then `i32.load` with offset 0 read `base + 0` — the LENGTH — so
  // `len < len` was always false and the store never happened.
  buf.push(OP.local_get);
  emitLEB128U(buf, lenLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, capLocal);
  buf.push(OP.i32_lt_s);
  buf.push(OP.if, 0x40);

  // ── room left: store at base + 8 + len*8 ─────────────────────────────
  emitStoreAtIndex(ctx, buf, baseLocal, lenLocal, value, asAddress);

  buf.push(OP.else);

  // ── full: allocate a block of twice the capacity and move the elements ─
  emitAlloc(
    ctx,
    buf,
    newBaseLocal,
    (b) => {
      b.push(OP.local_get);
      emitLEB128U(b, capLocal);
      b.push(OP.i32_const);
      encodeI32(b, 16); // 8 bytes per element, doubled
      b.push(OP.i32_mul);
      b.push(OP.i32_const);
      encodeI32(b, ARRAY_HEADER_BYTES);
      b.push(OP.i32_add);
    },
    TAG_ARRAY,
  );
  // newBase + 0 = len
  buf.push(OP.local_get);
  emitLEB128U(buf, newBaseLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, lenLocal);
  buf.push(OP.i32_store);
  emitU32MemArg(buf, 0, 0);
  // newBase + 4 = cap * 2
  buf.push(OP.local_get);
  emitLEB128U(buf, newBaseLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, capLocal);
  buf.push(OP.i32_const);
  encodeI32(buf, 2);
  buf.push(OP.i32_mul);
  buf.push(OP.i32_store);
  emitU32MemArg(buf, 0, 4);
  // memory.copy(newBase + 8, oldBase + 8, len * 8)
  buf.push(OP.local_get);
  emitLEB128U(buf, newBaseLocal);
  buf.push(OP.i32_const);
  encodeI32(buf, ARRAY_HEADER_BYTES);
  buf.push(OP.i32_add);
  buf.push(OP.local_get);
  emitLEB128U(buf, baseLocal);
  buf.push(OP.i32_const);
  encodeI32(buf, ARRAY_HEADER_BYTES);
  buf.push(OP.i32_add);
  buf.push(OP.local_get);
  emitLEB128U(buf, lenLocal);
  buf.push(OP.i32_const);
  encodeI32(buf, 3);
  buf.push(OP.i32_shl);
  emitMemoryCopy(buf);
  // The binding now points at the new block.
  buf.push(OP.local_get);
  emitLEB128U(buf, newBaseLocal);
  buf.push(OP.local_set);
  emitLEB128U(buf, baseLocal);
  // …and so does whatever the address was READ FROM. `g.cells.push(x)` re-reads
  // the field on every iteration, so writing back only to the local would grow
  // the old block again on the next push and lose the first nine cells.
  emitRebindArray(ctx, buf, base, newBaseLocal);
  emitStoreAtIndex(ctx, buf, baseLocal, lenLocal, value, asAddress);

  buf.push(OP.end);

  // len = len + 1, written back to the header.
  //
  // `i32.store` pops the VALUE from the top of the stack and the ADDRESS
  // beneath it, so the stack must be [address, value] — the address goes on
  // FIRST. A leftover `local.get len` ahead of it made the store write to
  // address `len+1` instead of the array's header.
  buf.push(OP.local_get);
  emitLEB128U(buf, baseLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, lenLocal);
  buf.push(OP.i32_const, 0x01);
  buf.push(OP.i32_add);
  buf.push(OP.i32_store);
  emitU32MemArg(buf, 0, 0);

  // The new length is the result of `push`.
  buf.push(OP.local_get);
  emitLEB128U(buf, lenLocal);
  buf.push(OP.i32_const, 0x01);
  buf.push(OP.i32_add);
}

/**
 * Point whatever `base` was read FROM at the new block, after a `push` grew it.
 *
 * `g.cells.push(0)` lowers to a `loadfield` of the field and then a push on that
 * temp. The field is re-read on every iteration of the surrounding loop, so
 * writing the new address only into the temp would grow the ORIGINAL block
 * again on the next push — the array would never get past its first capacity
 * and the cells that had been written would be left behind.
 *
 * When the array came from a field, the field is updated. When it came from a
 * binding, the binding is updated. Anything else is left alone: the caller has
 * no address to write back to and the grown block is simply dropped.
 */
function emitRebindArray(ctx: CompileCtx, buf: number[], base: IRValue, newBaseLocal: number): void {
  const name = valueName(base);
  if (!name) return;
  const def = ctx.defs.get(name);
  if (def && (def.op === "loadfield" || def.op === "storefield")) {
    emitValue((def as any).object, ctx, "i32", buf);
    buf.push(OP.i32_const);
    encodeI32(buf, ctx.recordLayout.declare((def as any).field));
    buf.push(OP.i32_add);
    buf.push(OP.local_get);
    emitLEB128U(buf, newBaseLocal);
    buf.push(OP.i32_store);
    emitU32MemArg(buf, 0, 0);
    return;
  }
  const local = ctx.locals.get(name);
  if (local && local.type === "i32") {
    buf.push(OP.local_get);
    emitLEB128U(buf, newBaseLocal);
    buf.push(OP.local_set);
    emitLEB128U(buf, local.index);
  }
}

/**
 * Store `value` into element `lenLocal` of the array whose base is `baseLocal`.
 *
 * The element address is `base + 8 + index*8`, built the same way the matching
 * READ builds it, or a cell written here would not be the cell read there.
 *
 * **The WIDTH is the list's element kind, not a constant.** This used to store
 * `f64` unconditionally while the reader asked the kind, so a list of addresses
 * was written as a double and read as an i32 — and the reader saw the low 32
 * bits of a double, which for an address in this heap is ZERO. Every element came
 * back 0 and a scan found nothing:
 *
 *     const S = new Set([]); S.add("fn"); S.add("class"); S.has("class")  → 0
 *
 * `storeelement` — the write a literal makes — already asked. One writer had the
 * rule and the other hardcoded an answer.
 */
function emitStoreAtIndex(
  ctx: CompileCtx,
  buf: number[],
  baseLocal: number,
  lenLocal: number,
  value: IRValue,
  asAddress: boolean,
): void {
  buf.push(OP.local_get);
  emitLEB128U(buf, baseLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, lenLocal);
  buf.push(OP.i32_const, 0x03);
  buf.push(OP.i32_shl);
  buf.push(OP.i32_add);
  buf.push(OP.i32_const, ARRAY_HEADER_BYTES);
  buf.push(OP.i32_add);
  if (asAddress) {
    emitValue(value, ctx, "i32", buf);
    buf.push(OP.i32_store);
  } else {
    emitValue(value, ctx, "f64", buf);
    buf.push(OP.f64_store);
  }
  emitU32MemArg(buf, 0, 0);
}

/**
 * Bump-allocate `size` bytes at run time and leave the address in `local`.
 *
 * The allocator is a pointer in memory rather than a wasm global, so the encoder
 * needs no global section:
 *
 *     aligned = ptr - (ptr & 7)      // clear the low 3 bits
 *     store(HEAP_PTR, aligned + size)
 *     result = aligned
 *
 * Aligning to 8 means CLEARING THE LOW 3 BITS, not masking with 7. `(x + 7) & 7`
 * keeps only those three bits and yields the remainder: 65543 & 7 is 7, so
 * `7 - 7` allocated every record at address 0 and the heap never advanced.
 *
 * The mask is built as `x - (x & 7)`. Encoding the negative `-8` needs a
 * multi-byte LEB128 form, and a one-byte form is read back as a POSITIVE
 * number: `0x78`, meant to be -8, is read as 120, and `x & 120` collapses the
 * pointer to 0. One small positive constant cannot be mis-encoded.
 *
 * `local` must be an i32 local; both callers hold their value in the
 * instruction's own target. `pushSize` PUSHES the size as an i32 rather than
 * taking a constant, because a growing block's new capacity is a value in a
 * local and not a number the emitter knows.
 */
function emitAlloc(
  ctx: CompileCtx,
  buf: number[],
  local: number,
  pushSize: (b: number[]) => void,
  /** BUG-WASM-78. What kind of block this is, written in front of it. */
  kind: number,
): void {
  const heapPtr = ctx.strings.heapPointerAddress;
  const endLocal = ctx.scratchLocal();
  const growLocal = ctx.scratchLocal();
  buf.push(OP.i32_const);
  encodeI32(buf, heapPtr);
  buf.push(OP.i32_load);
  emitU32MemArg(buf, 0, 0);
  buf.push(OP.local_set);
  emitLEB128U(buf, local);
  // aligned = ptr - (ptr & 7)
  //
  // The pointer is needed twice, so the first is PEEKED with local.tee (which
  // leaves a copy on the stack) while the second is a plain local_get. Pushing
  // only one and then `and` consumed it, leaving `i32.sub` with a single
  // operand.
  buf.push(OP.local_get);
  emitLEB128U(buf, local);
  buf.push(OP.local_get);
  emitLEB128U(buf, local);
  buf.push(OP.i32_const);
  encodeI32(buf, 7);
  buf.push(OP.i32_and);
  buf.push(OP.i32_sub);
  buf.push(OP.local_set);
  emitLEB128U(buf, local);

  // end = aligned + roundUp8(TAG_BYTES + size)
  //
  // **The rounding is load-bearing, and the first attempt's sixteen denormals were
  // here.** The allocator aligns the pointer DOWN (`ptr - (ptr & 7)`), which was safe
  // only because every block's size was a multiple of eight: the length, the capacity
  // and the elements are all eight-byte units, so `end` always landed aligned and the
  // next block started exactly where this one ended.
  //
  // A four-byte tag breaks that invariant. `aligned + 4 + 8` is not a multiple of eight,
  // so the next allocation rounds DOWN into the block just written and its tag lands on
  // top of that block's first field — which reads back as a denormal several instructions
  // later, nowhere near here.
  //
  // Counted: `local.get` and `pushSize` leave two, one add leaves one, the constant
  // makes two, the add leaves one, and so on to a single value for the `and`.
  buf.push(OP.local_get);
  emitLEB128U(buf, local);
  pushSize(buf);
  buf.push(OP.i32_add);
  buf.push(OP.i32_const);
  encodeI32(buf, TAG_BYTES);
  buf.push(OP.i32_add);
  buf.push(OP.i32_const);
  encodeI32(buf, 7);
  buf.push(OP.i32_add);
  buf.push(OP.i32_const);
  encodeI32(buf, -8);
  buf.push(OP.i32_and);
  buf.push(OP.local_set);
  emitLEB128U(buf, endLocal);

  // Grow the memory so `end` is inside it.
  //
  // An access past the end of memory TRAPS — `RuntimeError: memory access out
  // of bounds` — so the failure is loud, not silent. What makes it bad is the
  // diagnostic: it points at a load or a store in whatever line of compiled
  // code happened to run out, and says nothing about the real cause, which is
  // that the program needs more room. Growing turns that into "it keeps
  // working", which is what a language runtime owes its programs.
  //
  //   need  = (end + 65535) >> 16     pages
  //   have  = memory.size
  //   if (need > have) memory.grow(need - have)
  buf.push(OP.local_get);
  emitLEB128U(buf, endLocal);
  buf.push(OP.i32_const);
  encodeI32(buf, 65535);
  buf.push(OP.i32_add);
  buf.push(OP.i32_const, 16);
  buf.push(OP.i32_shr_u);
  buf.push(0x3f, 0x00); // memory.size
  buf.push(OP.i32_gt_u);
  buf.push(OP.if, 0x40);

  // (need - have) pages
  buf.push(OP.local_get);
  emitLEB128U(buf, endLocal);
  buf.push(OP.i32_const);
  encodeI32(buf, 65535);
  buf.push(OP.i32_add);
  buf.push(OP.i32_const, 16);
  buf.push(OP.i32_shr_u);
  buf.push(0x3f, 0x00); // memory.size
  buf.push(OP.i32_sub);
  buf.push(0x40, 0x00); // memory.grow
  // A failed grow returns -1 and a successful one the previous size, which is
  // 0 when the memory was empty. Testing against 0 would call a legitimate
  // grow a failure, so test the SIGN: `result < 0`.
  //
  // The comparison CONSUMES the result, so it is re-pushed from a local: the
  // engine rejected the module with "not enough arguments on the stack for
  // drop" when the `drop` followed the `if` directly.
  buf.push(OP.local_set);
  emitLEB128U(buf, growLocal);
  buf.push(OP.local_get);
  emitLEB128U(buf, growLocal);
  buf.push(OP.i32_const, 0x00);
  buf.push(OP.i32_lt_s);
  buf.push(OP.if, 0x40);
  // Trapping beats carrying on: a failed `memory.grow` means the allocation
  // cannot be satisfied, and the accesses that follow would all trap anyway.
  // Trapping HERE names the cause — the allocator — instead of leaving the
  // program to die at an unrelated line with a misleading message.
  buf.push(OP.unreachable);
  buf.push(OP.end);
  buf.push(OP.end);

  // store(aligned, kind) — AFTER the grow, because writing to memory that does not
  // exist yet traps. Address FIRST, value second: i32.store pops the value from the
  // top and the address beneath it. `local` still holds the aligned base here.
  buf.push(OP.local_get);
  emitLEB128U(buf, local);
  buf.push(OP.i32_const);
  encodeI32(buf, kind);
  buf.push(OP.i32_store);
  emitU32MemArg(buf, 0, 0);

  // …and the block's address is past its own tag, which is what every caller has
  // always been handed and therefore needs nothing changing.
  buf.push(OP.local_get);
  emitLEB128U(buf, local);
  buf.push(OP.i32_const);
  encodeI32(buf, TAG_BYTES);
  buf.push(OP.i32_add);
  buf.push(OP.local_set);
  emitLEB128U(buf, local);

  // store(HEAP_PTR, end) — i32.store pops the value from the top of the stack
  // and the address beneath it, so the address goes on FIRST.
  buf.push(OP.i32_const);
  encodeI32(buf, heapPtr);
  buf.push(OP.local_get);
  emitLEB128U(buf, endLocal);
  buf.push(OP.i32_store);
  emitU32MemArg(buf, 0, 0);

  // The address stays in `local`; `emitAlloc` never leaves anything on the
  // stack. A caller that wants the value pushes it with `local.get`. Leaving a
  // value behind instead made every caller responsible for consuming it, and
  // the growth branch of `push` silently left one on the stack — the engine
  // said "expected 0 elements on the stack for fallthru, found 1".
}

/**
 * `memory.copy` (bulk memory): pops dest, src, size, in that order.
 *
 * The sub-opcode is 10. 11 is `memory.fill`, which takes (dest, value, size) —
 * a byte repeated `size` times — and it validates happily, so the wrong
 * constant fills the grown block with a repeated byte pattern instead of
 * copying the elements and the array comes back full of garbage.
 */
function emitMemoryCopy(buf: number[]): void {
  buf.push(0xfc, 10, 0x00, 0x00);
}

/**
 * True when the value `v` is known to hold a LIST rather than a record.
 *
 * Two ways to know, and both are needed: the value is a name the module marked
 * as a list, or the value was READ from a field the module marked as one. The
 * second is what `g.cells.length` needs — `makeGrid` pushes to `g.cells` while
 * `step` only reads it, so in `step` nothing but the field's name says it.
 */
function isListValue(ctx: CompileCtx, v: IRValue): boolean {
  const name = valueName(v);
  if (!name) return false;
  if (ctx.moduleTypes.arrayNames[ctx.current]?.has(name)) return true;
  const def = ctx.defs.get(name);
  return !!def && def.op === "loadfield" && ctx.moduleTypes.arrayFields.has((def as any).field);
}

/**
 * True when the value `v` is the RESULT OF A CALL to a function that returns an address.
 *
 * Not "is a list" and not "is a string" — it cannot be either, because the module knows
 * a function returns an address and not which of the three address-kinds it returns. It
 * is asked at exactly one site, the `field === "length"` read, where the answer is the
 * same either way: a list's header is at offset 0 and a string's is at offset 0, so a
 * four-byte read is right for both.
 *
 * **It is a separate predicate on purpose.** Folding this into `isListValue` reads as a
 * generalisation and is a regression: `isRecordValue` consults `isListValue` first, and
 * four shapes that are right today — `g().v`, `g()[1]`, `g().startsWith`, and a byte read
 * off a returned string — go through it. Measured before this predicate existed; see the
 * table on the call site.
 */
function isCallToAnAddress(ctx: CompileCtx, v: IRValue): boolean {
  const name = valueName(v);
  if (!name) return false;
  const def = ctx.defs.get(name);
  if (def?.op !== "call") return false;
  const callee = (def as any).callee;
  const cname = callee?.kind === "ref" ? callee.name : "";
  return !!cname && !!ctx.moduleTypes.returnsAddress[cname];
}

/**
 * `a + b` where both sides are STRINGS: allocate, copy both, terminate.
 *
 * With `+` it used to be `i32.add` on two addresses, because a string, a list and a
 * record are all i32 and nothing could say which operand was which. Measured:
 * `"ho" + "la"` answered 24, which is 8 + 16.
 *
 * The length is at offset 0 and the bytes at offset 8 — BUG-WASM-48 put the header
 * there and BUG-WASM-49 made the operand's kind knowable — so this is arithmetic
 * over a header that already exists.
 *
 * **The result is a NEW block on the heap**, so a `+` inside a loop allocates once
 * per evaluation, exactly as an `arraylit` does. There is no collector yet; that is
 * a known cost, written down so it is a decision rather than a surprise.
 */
function emitStringConcat(
  ctx: CompileCtx,
  buf: number[],
  a: IRValue,
  b: IRValue,
  target: { index: number; type: WasmValType },
): void {
  const aLen = ctx.scratchLocal();
  const bLen = ctx.scratchLocal();
  const total = ctx.scratchLocal();
  const fresh = ctx.scratchLocal();

  const get = (l: number): void => {
    buf.push(OP.local_get);
    emitLEB128U(buf, l);
  };
  const set = (l: number): void => {
    buf.push(OP.local_set);
    emitLEB128U(buf, l);
  };
  const c8 = (n: number): void => {
    buf.push(OP.i32_const);
    encodeI32(buf, n);
  };

  emitValue(a, ctx, "i32", buf);
  buf.push(OP.i32_load);
  emitU32MemArg(buf, 0, 0);
  set(aLen);

  emitValue(b, ctx, "i32", buf);
  buf.push(OP.i32_load);
  emitU32MemArg(buf, 0, 0);
  set(bLen);

  get(aLen);
  get(bLen);
  buf.push(OP.i32_add);
  set(total);

  // **Everything from here down is `emitStringBlock`, verbatim.** BUG-WASM-72 wrote a
  // second copy of the allocate/copy/NUL/header tail for `slice`, got one `i32.add`
  // short in a hand-written source address, and was reverted. The reuse is not tidiness
  // here: it is what makes the arity question disappear, because the code that has it
  // right stops being code written by hand.
  emitStringBlock(ctx, buf, total, target, [
    { src: () => pushStrBase(ctx, buf, a), len: aLen },
    { destExtra: aLen, src: () => pushStrBase(ctx, buf, b), len: bLen },
  ]);
}

/**
 * `a` on the stack as a pointer PAST its 8-byte header — the first byte of its content.
 *
 * Three pushes, two consumed, one left. **The count is written out because that is the
 * mistake this file made twice** (BUG-WASM-72: `(source + 8) + from` with one `i32.add`),
 * and `emitAlloc` carries a comment about the same class for `i32.sub`.
 */
function pushStrBase(ctx: CompileCtx, buf: number[], v: IRValue): void {
  emitValue(v, ctx, "i32", buf);
  buf.push(OP.i32_const);
  encodeI32(buf, 8);
  buf.push(OP.i32_add);
}

/**
 * BUG-WASM-72. Build ONE string block out of N pieces, and it is the tail of
 * `emitStringConcat` lifted out whole rather than copied — because the two failures at
 * this were both a hand-written stack sequence whose operands were not counted, and both
 * were in a COPY of code that already got it right.
 *
 * `total` is a local holding the byte count, which is what the allocation and the header
 * need. Each piece pushes its own source address — that callback is the only place the
 * two callers differ, and for `slice` it is `pushStrBase(source)` followed by one
 * `i32.add` for the offset.
 */
function emitStringBlock(
  ctx: CompileCtx,
  buf: number[],
  total: number,
  target: { index: number; type: WasmValType },
  pieces: { src: () => void; len: number; destExtra?: number }[],
): void {
  const fresh = ctx.scratchLocal();
  const get = (l: number): void => { buf.push(OP.local_get); emitLEB128U(buf, l); };
  const set = (l: number): void => { buf.push(OP.local_set); emitLEB128U(buf, l); };
  const c8 = (n: number): void => { buf.push(OP.i32_const); encodeI32(buf, n); };

  // 8 header bytes, the bytes themselves, and a NUL terminator.
  emitAlloc(ctx, buf, fresh, (bb) => {
    bb.push(OP.local_get);
    emitLEB128U(bb, total);
    bb.push(OP.i32_const);
    encodeI32(bb, 9);
    bb.push(OP.i32_add);
  }, TAG_STRING);

  for (const p of pieces) {
    // dest: fresh + 8, plus this piece's own skip into the block.
    get(fresh);
    c8(8);
    buf.push(OP.i32_add);
    if (p.destExtra !== undefined) {
      get(p.destExtra);
      buf.push(OP.i32_add);
    }
    // src, then the count. `p.src()` leaves exactly one value and `get` leaves one.
    p.src();
    get(p.len);
    emitMemoryCopy(buf);
  }

  // The NUL, so anything that walks to a terminator still works.
  //
  // BUG-WASM-87. **This was THREE pushes, ONE add and a store that consumes one**, so the
  // address it wrote was `total + 8` and a value was left on the stack for the next
  // `local.set` to absorb — which is why the module VALIDATED and why the defect looked
  // like something else entirely. Measured off the emitted bytes: `local.get 6`,
  // `local.get 5`, `i32.const 8`, `i32.add`, `i32.const 0`, `i32.store8`.
  //
  // The residue is ONE zero byte written into the data section at `8 + size`. For a
  // two-piece concatenation it lands on a tag's second byte and nothing notices; for an
  // `allocblock(n)` it lands on whatever `8 + n` happens to name, and `8 + 4` is the
  // LENGTH word of the first interned string. That is the whole reason a bug in this
  // shared tail presented as "templates lose text".
  //
  // `pushStrBase` already carries the rule three screens up — "three pushes, two
  // consumed, one left" — written out because this file made the mistake twice. The
  // count was written out there and not here. The address is now built the way that
  // comment counts it: `(fresh + 8) + total`.
  get(fresh);
  c8(8);
  buf.push(OP.i32_add);
  get(total);
  buf.push(OP.i32_add);
  c8(0);
  buf.push(OP.i32_store8);
  emitU32MemArg(buf, 0, 0);

  // length and capacity — the two words every block here starts with
  get(fresh);
  get(total);
  buf.push(OP.i32_store);
  emitU32MemArg(buf, 0, 0);
  get(fresh);
  get(total);
  buf.push(OP.i32_store);
  emitU32MemArg(buf, 0, 4);

  get(fresh);
  if (target.type === "f64") emitConvert("i32", "f64", buf);
  set(target.index);
}

/**
 * True when the value `v` is known to hold a STRING.
 *
 * A string, a list and a record are all i32, which is why `addressNames` cannot
 * answer this and why `+` on two strings added their addresses instead of
 * concatenating (measured: `"ho" + "la"` → 24, which is 8 + 16).
 *
 * Two ways to know, and both are needed — the same two `isListValue` needs. A name
 * the module marked as a string, or a value READ from a field the module marked as
 * one, because a function that only reads a field has nothing else to go on.
 */
function isStringValue(ctx: CompileCtx, v: IRValue): boolean {
  const name = valueName(v);
  if (!name) return false;
  if (ctx.moduleTypes.stringNames[ctx.current]?.has(name)) return true;
  const def = ctx.defs.get(name);
  return !!def && def.op === "loadfield" && ctx.moduleTypes.stringFields.has((def as any).field);
}

/**
 * True when `v` is a RECORD — a value the module analysis decided holds an
 * address, and which is not a list.
 *
 * The two together are what tells `o[x]` (a name, which has no offset) from
 * `xs[i]` (an index, which does). A list is a list whichever of the two the
 * name also is, so the list case is checked first by the caller.
 */
function isRecordValue(ctx: CompileCtx, v: IRValue): boolean {
  const name = valueName(v);
  if (!name) return false;
  if (isListValue(ctx, v)) return false;
  return ctx.moduleTypes.addressNames[ctx.current]?.has(name) === true;
}

/**
 * True when the list `v` holds RECORDS rather than numbers, so its elements are
 * i32 addresses instead of f64 slots.
 *
 * Three sites asked this and each asked the lowering's `arrayKinds` alone, which
 * only knows a list literal and the binding it was assigned to. It does not know
 * the temporary a FIELD read produced, and that is the name every later read
 * uses: `o.items[0].v` looked the element up under a name the map had never heard
 * of, assumed a number, and read a record address as a double.
 *
 * The module analysis carries the kind across fields, bindings and call
 * arguments; the lowering's own answer is still consulted, because it is a fact
 * about the source rather than an inference.
 */
function isAddressArrayValue(ctx: CompileCtx, v: IRValue): boolean {
  const key = valueName(v);
  if (!key) return false;
  if (ctx.arrayKinds?.[key] === "address") return true;
  return ctx.moduleTypes.arrayElementKind[ctx.current]?.[key] === "address";
}

/** `pushSize` for a block whose size is a compile-time constant. */
function constantSize(size: number): (b: number[]) => void {
  return (b) => {
    b.push(OP.i32_const);
    encodeI32(b, size);
  };
}

/**
 * How many arguments a function VALUE can take.
 *
 * A function value has no signature of its own, so every function that can be
 * reached through one is given a THUNK with this single fixed shape, and the
 * call is made through it. Four is enough for the standard list methods and for
 * the language's own use; a function with more parameters is reachable only by
 * its own name. See buglist.md (BUG-WASM-10).
 */
const MAX_INDIRECT_ARGS = 4;

/**
 * A function VALUE carries a tag in its low bit.
 *
 *   bit 0 = 0 → a plain function. The rest is the index of its thunk and there
 *              is no environment.
 *   bit 0 = 1 → a CLOSURE. The rest is the ADDRESS of a record, and the record
 *              holds the index of the closure's own thunk plus the captured
 *              values.
 *
 * A tagged integer rather than a fixed-width record, because a plain function
 * value is then still one i32 and every existing call site keeps working. The
 * alternative — making EVERY value a closure record — would have put an
 * allocation in front of every function reference in the language.
 */
const FUNCTION_VALUE_TAG = 1;

/**
 * The uniform signature every thunk has, with the ENVIRONMENT in front.
 *
 * Nine parameters: the environment record, then four arguments in BOTH
 * representations, and the result in both.
 *
 * The duplication is the point. `i32.trunc_f64_s` would lose anything above
 * 2^31 or with a fractional part, so a number could not survive a trip through
 * a function value. Passing each argument twice and returning the result twice
 * lets the thunk take the copy its callee declared and the caller take the one
 * it expected, with no loss in either direction.
 */
function uniformSignature(): WasmFuncType {
  return {
    params: [
      "i32",
      ...Array.from({ length: MAX_INDIRECT_ARGS }, () => "i32" as WasmValType),
      ...Array.from({ length: MAX_INDIRECT_ARGS }, () => "f64" as WasmValType),
    ],
    results: ["i32", "f64"],
  };
}

/**
 * Bytes before a closure record's first captured value: the index of the thunk
 * to call, then how many captures follow.
 *
 * A FIXED header, read from the same word by the emitter and at the call site.
 * An earlier attempt tagged the low bit of the function value instead, and the
 * two sides then each did their own arithmetic to interpret it.
 */
const CLOSURE_HEADER_BYTES = 8;


/** The body of the thunk for `fn` at `index`. */
function buildThunk(fn: WasmFunc, index: number): WasmFunc {
  const body: number[] = [];
  const declared = fn.type.params;
  // Only the arguments the callee DECLARES are forwarded. The uniform signature
  // is wider than most functions, and padding the call would leave values on the
  // stack that the engine then reads as the callee's first arguments.
  //
  // Local 0 is the closure record, which a function with no captures ignores;
  // 1..4 are the i32 copies and 5..8 the f64 copies.
  for (let i = 0; i < declared.length && i < MAX_INDIRECT_ARGS; i++) {
    body.push(OP.local_get);
    emitLEB128U(body, declared[i] === "i32" ? i + 1 : i + 1 + MAX_INDIRECT_ARGS);
  }
  body.push(OP.call);
  emitLEB128U(body, index);

  // The callee left ONE value — unless it returned NOTHING, in which case it
  // left none and the uniform signature still owes two. `fn greet(name) { print(…)
  // }` is the most ordinary function there is, and its thunk tried to `local.set`
  // a value that was never pushed: "not enough arguments on the stack for
  // local.set". A void function reached through a function value answers zero in
  // both representations, which is the only thing it could answer.
  if (fn.type.results.length === 0) {
    body.push(OP.i32_const);
    encodeI32(body, 0);
    body.push(OP.f64_const);
    encodeF64(body, 0);
  } else {
    // Stash it, then build both copies in the order the signature wants:
    // results are pushed left to right, so the i32 copy goes first and the f64
    // copy ends up on top. Pushing them the other way round validates the same
    // and then fails the fall-through with "expected i32, got f64".
    //
    // Locals 9 and 10 sit after the NINE parameters, one of which is the
    // closure record. Using 8 would write into the last f64 argument.
    const resultType = fn.type.results[0];
    body.push(OP.local_set);
    emitLEB128U(body, 9);
    if (resultType === "i32") {
      body.push(OP.local_get);
      emitLEB128U(body, 9);
      body.push(OP.f64_convert_i32_u);
    } else {
      body.push(OP.local_get);
      emitLEB128U(body, 9);
      // SATURATES rather than trapping: at an indirect call the caller cannot
      // know the callee's result type, and a trap here would kill a program over
      // a value nobody was going to use as an address.
      body.push(0xfc, 0x02); // i32.trunc_sat_f64_s
    }
    body.push(OP.local_set);
    emitLEB128U(body, 10);
    const i32Copy = resultType === "i32" ? 9 : 10;
    const f64Copy = resultType === "i32" ? 10 : 9;
    body.push(OP.local_get);
    emitLEB128U(body, i32Copy);
    body.push(OP.local_get);
    emitLEB128U(body, f64Copy);
  }
  return {
    name: `thunk:${fn.name}`,
    type: uniformSignature(),
    locals: fn.type.results.length > 0 && fn.type.results[0] === "i32" ? ["i32", "f64"] : ["f64", "i32"],
    body,
  };
}

/**
 * Emit a call whose callee is a VALUE rather than a name.
 *
 * `call_indirect` needs a type, and at an indirect call the callee is not known
 * — so the call goes through the uniform thunk signature instead. Each argument
 * is pushed TWICE, once as an i32 and once as an f64, because the thunk has to
 * hand the callee whichever representation it declared and a trunc would lose
 * numbers. The thunk returns the result twice for the same reason, and the copy
 * that matches the destination is the one kept.
 */
function emitIndirectCall(inst: IRInstruction, ctx: CompileCtx, buf: number[]): void {
  const args: IRValue[] = (inst as any).args ?? [];
  // A function value is the ADDRESS of a closure record. The record IS the
  // environment, and its first word is the index of the thunk to call — so the
  // same two words serve a plain function and a closure, and there is no tag.
  const envSlot = ctx.scratchLocal();
  const indexSlot = ctx.scratchLocal();
  emitValue(inst.callee, ctx, "i32", buf);
  buf.push(OP.local_set);
  emitLEB128U(buf, envSlot);
  buf.push(OP.local_get);
  emitLEB128U(buf, envSlot);
  buf.push(OP.i32_load);
  emitU32MemArg(buf, 0, 0);
  buf.push(OP.local_set);
  emitLEB128U(buf, indexSlot);

  const byType = (t: WasmValType) => {
    for (let i = 0; i < MAX_INDIRECT_ARGS; i++) {
      if (i < args.length) {
        emitValue(args[i], ctx, t, buf);
      } else if (t === "f64") {
        // The padding has to match the slot's type. Pushing an i32 zero into an
        // f64 slot is not a smaller number, it is a different type, and the
        // engine rejects the module rather than the call.
        buf.push(OP.f64_const);
        encodeF64(buf, 0);
      } else {
        buf.push(OP.i32_const);
        encodeI32(buf, 0);
      }
    }
  };
  // The record goes first: the uniform signature's first slot is the
  // environment, and a function with no captures simply ignores it.
  buf.push(OP.local_get);
  emitLEB128U(buf, envSlot);
  byType("i32");
  byType("f64");

  // The callee's index goes on last: it is the topmost operand of call_indirect.
  buf.push(OP.local_get);
  emitLEB128U(buf, indexSlot);
  buf.push(OP.call_indirect);
  emitLEB128U(buf, ctx.uniformTypeIndex);
  buf.push(0x00); // table 0

  // Two results came back, i32 beneath f64. You cannot `drop` the lower one, so
  // both go to locals and the destination takes the copy it wants. The f64 one
  // is stored FIRST because it is the one on top of the stack.
  const f64Slot = ctx.scratchLocal("f64");
  const i32Slot = ctx.scratchLocal("i32");
  buf.push(OP.local_set);
  emitLEB128U(buf, f64Slot);
  buf.push(OP.local_set);
  emitLEB128U(buf, i32Slot);
  buf.push(OP.local_get);
  emitLEB128U(buf, inst.target && ctx.locals.get(inst.target)?.type === "i32" ? i32Slot : f64Slot);
  if (inst.target) {
    const local = ctx.locals.get(inst.target)!;
    buf.push(OP.local_set);
    emitLEB128U(buf, local.index);
  } else {
    buf.push(OP.drop);
  }
}

/**
 * The thunk for a CLOSURE: one that reads the values it captured out of the
 * environment record and hands them to the function as LEADING parameters.
 *
 * A lifted lambda that captures `k` is compiled as `fn __lambda0(k, v)`, so the
 * captures are just extra parameters in front. The closure record holds them in
 * the order the function was generated with, each in an 8-byte slot whose width
 * the capture's own kind decides — the same rule a record field follows.
 */
/**
 * The thunk for a CLOSURE: it reads the values the function CAPTURED out of the
 * record and hands them over as LEADING parameters.
 *
 * A lifted lambda that captures `k` is compiled as `fn __lambda0(k, v)`, so the
 * captures are just extra parameters in front. The record holds them from
 * offset `CLOSURE_HEADER_BYTES`, one 8-byte slot each, and the local 0 the
 * record's address — the caller puts it in the first slot of the uniform
 * signature for exactly this.
 */
/**
 * The thunk for a CLOSURE: it reads what the function CAPTURED out of the
 * record and hands it over as LEADING parameters.
 *
 * A lifted lambda that captures `a` and `b` is compiled as `fn __lambda0(a, b, v)`,
 * so the captures are just extra parameters in front — that is what makes a
 * closure work with the machinery already here.
 *
 * **The one thing this got wrong twice:** the declared parameters after the
 * captures are looked up by the CALLER's argument position, not by their index
 * in the declaration. The uniform signature's slots are numbered by what the
 * caller passed, and the caller's first argument lands in slot 0 — while `v` is
 * declared third. Reading slot 2 read a PADDING slot, so `v` arrived as 0 and
 * `v * a + b` answered with `b`. One capture hid it: with a single capture the
 * declared index and the argument position happen to coincide.
 */
function buildClosureThunk(
  fn: WasmFunc,
  index: number,
  captured: WasmValType[],
): WasmFunc {
  const body: number[] = [];
  const declared = fn.type.params;
  // The captures come first, from the record. Local 0 is the record's address.
  for (let k = 0; k < captured.length; k++) {
    body.push(OP.local_get);
    emitLEB128U(body, 0);
    body.push(OP.i32_const);
    encodeI32(body, CLOSURE_HEADER_BYTES + k * 8);
    body.push(OP.i32_add);
    body.push(captured[k] === "i32" ? OP.i32_load : OP.f64_load);
    // Every load carries a two-byte memory argument. Without it the next byte is
    // read as the alignment: "expected maximum alignment is 3, actual 32".
    body.push(0x00, 0x00);
  }
  // Then the declared parameters that are NOT captures, taken from the caller's
  // argument slots.
  for (let i = captured.length; i < declared.length && i < MAX_INDIRECT_ARGS; i++) {
    const argPos = i - captured.length;
    body.push(OP.local_get);
    emitLEB128U(body, declared[i] === "i32" ? argPos + 1 : argPos + 1 + MAX_INDIRECT_ARGS);
  }
  body.push(OP.call);
  emitLEB128U(body, index);

  // A function that returns NOTHING left nothing on the stack, and the uniform
  // signature still owes two values. Same rule as the plain thunk.
  if (fn.type.results.length === 0) {
    body.push(OP.i32_const);
    encodeI32(body, 0);
    body.push(OP.f64_const);
    encodeF64(body, 0);
  } else {
    const resultType = fn.type.results[0];
    body.push(OP.local_set);
    emitLEB128U(body, 9);
    if (resultType === "i32") {
      body.push(OP.local_get);
      emitLEB128U(body, 9);
      body.push(OP.f64_convert_i32_u);
    } else {
      body.push(OP.local_get);
      emitLEB128U(body, 9);
      body.push(0xfc, 0x02); // i32.trunc_sat_f64_s
    }
    body.push(OP.local_set);
    emitLEB128U(body, 10);
    const i32Copy = resultType === "i32" ? 9 : 10;
    const f64Copy = resultType === "i32" ? 10 : 9;
    body.push(OP.local_get);
    emitLEB128U(body, i32Copy);
    body.push(OP.local_get);
    emitLEB128U(body, f64Copy);
  }
  return {
    name: `closure:${fn.name}`,
    type: uniformSignature(),
    locals: fn.type.results.length > 0 && fn.type.results[0] === "i32" ? ["i32", "f64"] : ["f64", "i32"],
    body,
  };
}

/**
 * After a call: if an exception is pending, leave this function NOW so the
 * caller above sees it too.
 *
 * This is the whole of the propagation. Every call site pays for it, and that is
 * the price of a `throw` that happens in a helper — which is the only shape the
 * corpus uses.
 *
 * `openDepth` is closed first so the `if` is self-contained: a function can be
 * emitted inside a loop, and a `return` that left the enclosing constructs open
 * would misalign every `end` after it.
 */
function emitExceptionCheck(ctx: CompileCtx, buf: number[]): void {
  buf.push(OP.i32_const);
  encodeI32(buf, EXCEPTION_SLOT);
  buf.push(OP.i32_load);
  emitU32MemArg(buf, 0, 0);
  // `ne 0`, not `eqz`: `eqz` made the branch the NORMAL case and every
  // function returned zero, which is how 36 tests failed at once.
  buf.push(OP.i32_const, 0x00);
  buf.push(OP.i32_ne);
  buf.push(OP.if, 0x40);
  emitReturnValueFor(ctx, buf);
  buf.push(OP.return);
  buf.push(OP.end);
}

/** The function's own result, or a zero when it returns nothing. */
function emitReturnValueFor(ctx: CompileCtx, buf: number[]): void {
  const result = ctx.resultTypeOfCurrentFunction;
  if (result === "i32") {
    buf.push(OP.i32_const);
    encodeI32(buf, 0);
  } else {
    buf.push(OP.f64_const);
    encodeF64(buf, 0);
  }
}

function emitInst(inst: IRInstruction, ctx: CompileCtx, buf: number[]): void {
  switch (inst.op) {
    case "literal": {
      const local = ctx.locals.get(inst.target)!;
      emitLitValue(inst.value, inst.kind, local.type, buf, ctx.strings);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "binop": {
      const local = ctx.locals.get(inst.target)!;
      // **`+` on a STRING is concatenation, not addition.** A string, a list and
      // a record are all i32, so with nothing saying which operand was a string
      // this was `i32.add` on two addresses — measured `"ho" + "la"` as 24,
      // which is 8 + 16. BOTH sides have to be strings: turning a number into a
      // one is a formatting decision and is not made here.
      if (inst.operator === "+") {
        const leftIsString = isStringValue(ctx, inst.left);
        const rightIsString = isStringValue(ctx, inst.right);
        if (leftIsString && rightIsString) {
          emitStringConcat(ctx, buf, inst.left, inst.right, local);
          break;
        }
        // BUG-WASM-66. ONE side is a string and the other is not known to be one. That
        // is not arithmetic and it is not concatenation, and the fallback below added
        // a pointer to a pointer:
        //
        //     fn name(s) = s + "!"   →  name("hola").length  =  1634496360   want 5
        //     let g = fn(x) = x + "!"  →  g("hola")  =  0                want "hola!"
        //
        // **This does not decide the open question, it makes it visible.** Whether a
        // number in a string is `String(1)`, a rounded `0.3`, or a refusal is still
        // undecided, and all three beat a denormal. What does not beat it is answering
        // while the question is open, because nothing in the output says it is open.
        //
        // **The refusal was HERE, as a `throw`, and the gate failed on it.** The gate has
        // said since before this work that the compiler must never throw on real code — a
        // refusal is a reported gap and a crash is a defect in the compiler — and three
        // corpus programs reported `threw`. The emitter has no channel for a refusal, so
        // the check the AST can answer moved to the lowering, which has one.
        //
        // What is left unhandled here is the arm no shape can answer: `s + t` with
        // neither side known. Both look like numbers, so they add, and if they were
        // strings the answer is a denormal. That one needs the open decision and is
        // written down rather than guessed at.
        //
        // A hand-written template literal with one missing backtick is what put that
        // throw here badly the first time and took five test files down with it. The
        // message is one value in a string of text, and it is written as text.
      }
      // Emit operands at THEIR type and choose the opcode from the operator,
      // not from the destination local: a comparison yields i32 even when both
      // operands are f64, so using local.type pushed i32 operands and then
      // emitted f64.gt, which the engine rejected.
      const lt = resolveType(inst.left, ctx);
      const rt = resolveType(inst.right, ctx);
      const isLogical = LOGICAL_OPS.has(inst.operator);
      const operandType: WasmValType = isLogical
        ? "i32"
        : (lt === "f64" || rt === "f64" ? "f64" : "i32");
      emitValue(inst.left, ctx, operandType, buf);
      emitValue(inst.right, ctx, operandType, buf);
      // BUG-WASM-79. `%` on two f64s used to reach `getBinOpcode`'s `default`, which
      // is `f64_add` — so `37 % 10` was 47. There is no `f64.rem` in WebAssembly;
      // remainder is an integer opcode. This is the sequence that means the same
      // thing JavaScript's `%` does, a truncating remainder with the dividend's sign:
      //
      //   f64.trunc → i32.trunc_f64_s → i32.rem_s → f64.convert_i32_s
      //
      // Counted on the stack, which already holds [left, right].
      //
      // **Both sides have to become integers and NEITHER can stay on the stack**: the
      // second attempt spilled the divisor with `local.tee`, and `f64.trunc` then landed on
      // the divisor's i32 instead of the dividend's f64, which the engine named as a type
      // error at the instruction. **A `tee` leaves a copy UNDER the value it copies**,
      // so the top is never the thing underneath it. Two `local.set`s, one per side:
      //
      //   f64.trunc         → [a, tb]     tb is the divisor, still an f64
      //   i32.trunc_f64_s   → [a, ib]     ib is the divisor, an i32
      //   local.set  id     → [a]         divisor spilled
      //   f64.trunc         → [ta]        and now the top really is the dividend
      //   i32.trunc_f64_s   → [ia]
      //   local.set  ia     → []          dividend spilled
      //   local.get  ia     → [ia]        `i32.rem_s` takes the dividend from beneath
      //   local.get  id     → [ia, id]
      //   i32.rem_s         → [r]
      //   f64.convert_i32_s → [f64]
      if (inst.operator === "%" && operandType === "f64") {
        const id = ctx.scratchLocal();
        const ia = ctx.scratchLocal();
        buf.push(OP.f64_trunc);
        buf.push(OP.i32_trunc_f64_s);
        buf.push(OP.local_set);
        emitLEB128U(buf, id);
        buf.push(OP.f64_trunc);
        buf.push(OP.i32_trunc_f64_s);
        buf.push(OP.local_set);
        emitLEB128U(buf, ia);
        buf.push(OP.local_get);
        emitLEB128U(buf, ia);
        buf.push(OP.local_get);
        emitLEB128U(buf, id);
        buf.push(OP.i32_rem_s);
        buf.push(OP.f64_convert_i32_s);
      } else {
        emitBinOp(inst.operator, operandType, buf);
      }
      if (isComparisonOp(inst.operator) && local.type === "f64") {
        emitConvert("i32", "f64", buf);
      }
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "unaryop": {
      const local = ctx.locals.get(inst.target)!;
      // `!` is a BOOLEAN operator, and this is the same rule the `binop` case
      // above already states: the operand goes on the stack at the type the
      // OPERATOR wants, and the opcode is chosen from that, never from the
      // destination local.
      //
      // It matters because `derive` types a `!` result from its ARGUMENT, so
      // `!someCall()` gives an f64 local, and emitting at `local.type` put a
      // double on the stack under an `i32.eqz` that wants an i32:
      //
      //     i32.eqz[0] expected type i32, found local.get of type f64
      //
      // That is **10 of the 16** corpus modules the engine rejected, and the
      // corpus is full of `!` — nullish checks, negated calls, empty tests. The
      // `local.set` on the following line was wrong for the same reason: an i32
      // result stored into an f64 slot. So both sides are fixed: the operand and
      // the opcode at i32, and the 0/1 result converted to whatever the local is.
      const isLogical = inst.operator === "!";
      const operandType: WasmValType = isLogical ? "i32" : local.type;
      emitValue(inst.argument, ctx, operandType, buf);
      emitUnaryOp(inst.operator, operandType, buf);
      if (isLogical && local.type === "f64") emitConvert("i32", "f64", buf);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "declare": {
      if (inst.value) {
        const local = ctx.locals.get(inst.name)!;
        emitValue(inst.value, ctx, local.type, buf);
        buf.push(OP.local_set);
        emitLEB128U(buf, local.index);
      }
      break;
    }
    case "assign": {
      const local = ctx.locals.get(inst.target)!;
      emitValue(inst.value, ctx, local.type, buf);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "exctest": {
      // "Is an exception pending?" — the `if` a `try` is built on. An ordinary
      // `branch` from here is handled by the same `if/else` machinery as every
      // other conditional, so a `try` needs no emitter of its own.
      const local = ctx.locals.get(inst.target)!;
      buf.push(OP.i32_const);
      encodeI32(buf, EXCEPTION_SLOT);
      buf.push(OP.i32_load);
      emitU32MemArg(buf, 0, 0);
      buf.push(OP.i32_const, 0x00);
      buf.push(OP.i32_ne);
      // The flag lands in whatever local the lowering gave it, which is an f64
      // unless something pinned it — and a comparison is an i32.
      if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "excload": {
      // Reading the thrown value for the catch parameter.
      const local = ctx.locals.get(inst.target)!;
      buf.push(OP.i32_const);
      encodeI32(buf, EXCEPTION_SLOT);
      buf.push(OP.i32_load);
      emitU32MemArg(buf, 0, 0);
      if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "excclear": {
      // A `try` starts by clearing the slot, so a `throw` from an EARLIER,
      // already-handled failure cannot make this one catch it.
      buf.push(OP.i32_const);
      encodeI32(buf, EXCEPTION_SLOT);
      buf.push(OP.i32_const);
      encodeI32(buf, 0);
      buf.push(OP.i32_store);
      emitU32MemArg(buf, 0, 0);
      break;
    }
    case "excthrow": {
      // Park the value and leave. Every function in between propagates: a `throw`
      // that fell through would run the statements after it.
      const local = inst.target ? ctx.locals.get(inst.target) : undefined;
      buf.push(OP.i32_const);
      encodeI32(buf, EXCEPTION_SLOT);
      if (local && (inst as any).value) {
        emitValue((inst as any).value, ctx, "i32", buf);
      } else {
        // No value thrown: park a non-zero marker, since zero means "no
        // exception" and `throw` with nothing would be invisible.
        buf.push(OP.i32_const);
        encodeI32(buf, 1);
      }
      buf.push(OP.i32_store);
      emitU32MemArg(buf, 0, 0);
      // Where the control goes next is the LOWERING's decision: inside a `try`
      // body it is the slot test just outside, and at the top of a function it
      // is a return. Emitting the return here made a `throw` inside a `try` skip
      // its own `catch` and leave the function instead.
      break;
    }
    case "fnvalue": {
      // A function used as a VALUE is the ADDRESS of a closure record, and the
      // record's first word is the index of the thunk to call. Plain or not, the
      // call site reads that one word — there is no tag and nothing to interpret.
      const local = ctx.locals.get(inst.target)!;
      const name = (inst as any).fn ?? "";
      const idx = ctx.allFunctionNames.indexOf(name);
      const captures = idx >= 0 ? ctx.capturesByFunction[name] ?? [] : [];
      if (idx < 0 || captures.length === 0) {
        // Nothing captured: the record is immutable and lives in the static
        // image, shared by every reference to that function.
        buf.push(OP.i32_const);
        encodeI32(buf, idx >= 0 ? ctx.plainRecordAddress(idx) : 0);
        if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
        buf.push(OP.local_set);
        emitLEB128U(buf, local.index);
        break;
      }
      // With captures: one record per evaluation, on the same heap as
      // everything else.
      emitAlloc(ctx, buf, local.index, constantSize(CLOSURE_HEADER_BYTES + captures.length * 8), TAG_CLOSURE);
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      buf.push(OP.i32_const);
      encodeI32(buf, ctx.closureThunkIndex(idx));
      buf.push(OP.i32_store);
      emitU32MemArg(buf, 0, 0);
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      buf.push(OP.i32_const);
      encodeI32(buf, captures.length);
      buf.push(OP.i32_store);
      emitU32MemArg(buf, 0, 4);
      captures.forEach((captured, k) => {
        buf.push(OP.local_get);
        emitLEB128U(buf, local.index);
        buf.push(OP.i32_const);
        encodeI32(buf, CLOSURE_HEADER_BYTES + k * 8);
        buf.push(OP.i32_add);
        // A capture's width is its own: an address is an i32 and a number an
        // f64, and the lifted function's leading parameter was typed the same
        // way when it was compiled.
        const isAddress = ctx.moduleTypes.addressNames[ctx.current]?.has(captured) === true;
        emitValue({ kind: "ref", name: captured } as IRValue, ctx, isAddress ? "i32" : "f64", buf);
        buf.push(isAddress ? OP.i32_store : OP.f64_store);
        emitU32MemArg(buf, 0, 0);
      });
      // `emitAlloc` leaves the address in the local, not on the stack.
      if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "call": {
      if ((inst as any).indirect) {
        // **A function value is produced by a `fnvalue`, and by nothing else.**
        //
        // The lowering marks a call indirect whenever the callee is not a declared
        // function NAME, so a lambda and `fs.existsSync` arrive the same way — and
        // the emitter went on to read a funcref out of the second one, from an
        // address nothing had written. The result was a module that validated and
        // then trapped inside `call_indirect` about a TYPE, three functions from
        // anything to do with the cause.
        //
        // A member of a `require`d binding is a HOST call, and this backend has no
        // host to ask (the four corpus programs that import a package are the same
        // wall). So it is named instead of approximated. The reduced file that found
        // it is 34 lines and the whole of it is host calls.
        // The rule is deliberately NARROW: only a callee that came from a FIELD
        // READ is refused. A lambda bound to a name and called (`const h = fn()
        // {}; h()`) is a legitimate indirect call whose defining instruction is a
        // `declare`, and refusing on "not a `fnvalue`" broke eleven tests that
        // were right — the same shape of mistake as BUG-WASM-27's guard, which
        // refused lists of records.
        const calleeId =
          (inst as any).callee?.kind === "temp" ? (inst as any).callee.id : (inst as any).callee?.name;
        const def = calleeId ? ctx.defs.get(calleeId) : undefined;
        if (def?.op === "loadfield") {
          ctx.unsupported.add(
            `una llamada a un miembro ("${String((def as any).field)}") todavía no está soportada ` +
              `por el backend de WebAssembly: no hay host al que preguntar`,
          );
          const local = (inst as any).target ? ctx.locals.get((inst as any).target) : undefined;
          if (local) {
            if (local.type === "i32") { buf.push(OP.i32_const); encodeI32(buf, 0); }
            else { buf.push(OP.f64_const); encodeF64(buf, 0); }
            buf.push(OP.local_set);
            emitLEB128U(buf, local.index);
          }
          break;
        }
        emitIndirectCall(inst, ctx, buf);
        break;
      }
      const calleeName = inst.callee.kind === "ref" ? inst.callee.name : "";
      // The WHOLE function list, not the part compiled so far. A function
      // lifted from a lambda, or a list method lowered from its own source, is
      // appended last — so a partial lookup did not find it, the index was -1,
      // and the call was silently DROPPED: the destination kept its default and
      // the program answered 0 with no diagnostic.
      const funcIdx = ctx.allFunctionNames.indexOf(calleeName);
      if (funcIdx < 0) {
        // A call to a function this module does not define — almost always one
        // that lives in an imported file, because this backend has no module
        // system yet. It used to be DROPPED: nothing was emitted, the
        // destination's `local.set` then found an empty stack, and the engine
        // blamed a stack three functions away. Name it instead.
        ctx.unsupported.add(`llamada a "${calleeName}", que este módulo no define`);
        const local = inst.target ? ctx.locals.get(inst.target) : undefined;
        if (local) {
          if (local.type === "i32") {
            buf.push(OP.i32_const);
            encodeI32(buf, 0);
          } else {
            buf.push(OP.f64_const);
            encodeF64(buf, 0);
          }
          buf.push(OP.local_set);
          emitLEB128U(buf, local.index);
        }
        break;
      }
      {
        // **A lifted closure takes its captures as LEADING PARAMETERS**, so a
        // direct call to one has to hand them over before the written arguments.
        //
        // The lowering builds the lifted function as `fn name(capture, …) { … }`
        // and records the captures in `b.captures[name]`; what it cannot do is add
        // them at the CALL SITE, because at that point it is emitting an argument
        // list and has no idea a parameter is not written in the source.
        //
        // It can here, and it is the right place: the captures are names in the
        // scope AROUND the call, so they are in `ctx.locals` right now. Without
        // this, `fn inner(x) { return x + k }` inside a body that has `k` answers
        // with `k` unset, and the 8 recursive nested functions in the corpus —
        // which capture nothing but call themselves — lose an argument to a
        // parameter that was never written.
        const leading = ctx.capturesByFunction[calleeName] ?? [];
        for (const capture of leading) {
          const slot = ctx.locals.get(capture);
          const want = paramTypeAt(ctx.moduleTypes, calleeName, leading.indexOf(capture));
          emitValue({ kind: "ref", name: capture } as IRValue, ctx, want, buf);
          void slot;
        }
        // Arguments are emitted at the callee's parameter type, not blindly as
        // f64: a record passed to a function that takes a record must stay an
        // i32 address, and a number must stay a number.
        for (let ai = 0; ai < inst.args.length; ai++) {
          const want = paramTypeAt(ctx.moduleTypes, calleeName, ai + leading.length);
          emitValue(inst.args[ai], ctx, want, buf);
        }
        buf.push(OP.call);
        emitLEB128U(buf, funcIdx);
        if (inst.target && !ctx.voidFunctions.has(calleeName)) {
          const local = ctx.locals.get(inst.target)!;
          // The call's result type is the callee's, not the local's.
          const resultType = ctx.moduleTypes.returnsAddress[calleeName] ? "i32" : "f64";
          if (resultType !== local.type) emitConvert(resultType, local.type, buf);
          buf.push(OP.local_set);
          emitLEB128U(buf, local.index);
        } else {
          // A callee with no result pushed NOTHING, so there is nothing to store
          // and nothing to drop — a `drop` here would eat a value the call never
          // produced, and a `local.set` would read an empty stack. See
          // `voidFunctions`: this is the whole of BUG-WASM-25.
          if (!ctx.voidFunctions.has(calleeName)) buf.push(OP.drop);
        }
        // The callee may have thrown. The result is already stored, so this can
        // leave the function with it in place: a `throw` in a HELPER has to
        // reach the `try` in its CALLER, and the corpus has no `throw` inside
        // any `try` at all.
        //
        // …unless the call is INSIDE a `try` body, where leaving the function
        // would skip the very `catch` that is supposed to handle it. The
        // lowering says which, because only it knows.
        if (!(inst as any).inTry) emitExceptionCheck(ctx, buf);
      }
      break;
    }
    case "exprstmt": {
      emitValue(inst.value, ctx, "i32", buf);
      buf.push(OP.drop);
      break;
    }
    case "storeelement": {
      // `a[i] = v`. The address is built the same way the indexed READ builds
      // it, and the value is stored with the width the read would load.
      const isAddressArray = isAddressArrayValue(ctx, (inst as any).array);

      emitElementAddress((inst as any).array, (inst as any).index, ctx, buf);
      if (isAddressArray) {
        emitValue((inst as any).value, ctx, "i32", buf);
        buf.push(OP.i32_store);
      } else {
        emitValue((inst as any).value, ctx, "f64", buf);
        buf.push(OP.f64_store);
      }
      emitU32MemArg(buf, 0, 0);
      break;
    }
    case "arraypush": {
      // `a.push(x)`. `emitArrayPush` leaves the new LENGTH on the stack as an
      // i32 (that is what the header stores), so it is stored into an i32 slot.
      // The instruction's own temp was typed f64 by `producedKind` because push
      // "returns a number" to Nodeon code; converting here keeps the wasm local
      // consistent with what was actually pushed.
      emitArrayPush(ctx, buf, (inst as any).array, (inst as any).value);
      const slot = ctx.scratchLocal();
      buf.push(OP.local_set);
      emitLEB128U(buf, slot);
      const local = ctx.locals.get(inst.target);
      if (local) {
        buf.push(OP.local_get);
        emitLEB128U(buf, slot);
        if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
        buf.push(OP.local_set);
        emitLEB128U(buf, local.index);
      }
      break;
    }
    case "arraylit": {
      // An array literal is ALLOCATED AT RUN TIME, like a record. Interning it
      // into the static data image gave every `[]` in the program the same
      // address, so two calls to `makeGrid` shared one array: five cells of a
      // glider became six, and a second grid overwrote the first.
      //
      // The block is `[len: i32][cap: i32][element: 8 bytes]…`, so an element
      // lives at `base + 8 + i*8`.
      const local = ctx.locals.get(inst.target)!;
      const values: number[] = (inst as any).values ?? [];
      const asAddress = (inst as any).elementKind === "address";
      const cap = arrayCapacity(values.length);
      emitAlloc(ctx, buf, local.index, constantSize(ARRAY_HEADER_BYTES + cap * 8), TAG_ARRAY);

      // Header: the real length, then the capacity `push` grows up to.
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      buf.push(OP.i32_const);
      encodeI32(buf, values.length);
      buf.push(OP.i32_store);
      emitU32MemArg(buf, 0, 0);
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      buf.push(OP.i32_const);
      encodeI32(buf, cap);
      buf.push(OP.i32_store);
      emitU32MemArg(buf, 0, 4);

      // Elements. An element that is a RECORD is an address and is written
      // with `i32.store`; a number is an f64 slot.
      for (let i = 0; i < values.length; i++) {
        buf.push(OP.local_get);
        emitLEB128U(buf, local.index);
        buf.push(OP.i32_const);
        encodeI32(buf, ARRAY_HEADER_BYTES + i * 8);
        buf.push(OP.i32_add);
        if (asAddress) {
          buf.push(OP.i32_const);
          encodeI32(buf, 0);
          buf.push(OP.i32_store);
          emitU32MemArg(buf, 0, 0);
        } else {
          buf.push(OP.f64_const);
          encodeF64(buf, Number(values[i]));
          buf.push(OP.f64_store);
          emitU32MemArg(buf, 0, 0);
        }
      }
      // `emitAlloc` leaves the block's address in the target local.
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "allocblock": {
      // BUG-WASM-83. **This is `emitStringBlock` with an empty piece list.**
      //
      // A block of n bytes the program fills is the same allocation, the same
      // header and the same NUL as a block built out of concatenated strings; the
      // only difference is that the copy loop has nothing to copy. Writing that tail
      // a second time is what BUG-WASM-72 reverted — a hand-written source address
      // one `i32.add` short — so this is a reuse, and reusing is what makes the arity
      // question disappear.
      //
      // `emitStringBlock` wants the byte count in an I32 local (it adds it to a
      // constant), and the size here is a NUMBER in an f64 local. The conversion is
      // `emitValue`’s, not a new rule: it is `i32.trunc_f64_s`, which is what an f64
      // asked for as an i32 has always meant here. `local.set` consumes the value, so
      // nothing is left on the stack for the caller.
      const target = ctx.locals.get(inst.target)!;
      const sizeSlot = ctx.scratchLocal();
      emitValue((inst as any).size, ctx, "i32", buf);
      buf.push(OP.local_set);
      emitLEB128U(buf, sizeSlot);
      emitStringBlock(ctx, buf, sizeSlot, target, []);
      break;
    }
    case "storebyte": {
      // One `i32.store8`, and the address is the header rule every other read and
      // write of a string byte already uses: the block address points at `len`, so
      // the first byte is at +8. `emitElementAddress` with stride 1 is the same sum,
      // but spelled as one because the shift it would do is skipped entirely here.
      //
      // Value LAST: `i32.store8` pops the value from the top and the address beneath
      // it, the same order as every other store in this file.
      emitValue((inst as any).block, ctx, "i32", buf);
      buf.push(OP.i32_const);
      encodeI32(buf, ARRAY_HEADER_BYTES);
      buf.push(OP.i32_add);
      emitValue((inst as any).index, ctx, "i32", buf);
      buf.push(OP.i32_add);
      emitValue((inst as any).value, ctx, "i32", buf);
      buf.push(OP.i32_store8);
      emitU32MemArg(buf, 0, 0);
      break;
    }
    case "arraylength": {
      const local = ctx.locals.get(inst.target)!;
      emitValue((inst as any).array, ctx, "i32", buf);
      buf.push(OP.i32_load);
      emitU32MemArg(buf, 0, 0);
      if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "objlit": {
      // A record is bump-allocated in linear memory and filled field by field,
      // through the same allocator `arraylit` uses.
      const local = ctx.locals.get(inst.target)!;
      const fields: string[] = (inst as any).fields ?? [];
      const values: IRValue[] = (inst as any).values ?? [];
      // Every record reserves a slot for EVERY field name in the module, not
      // just its own: the offsets come from one shared index space, so a record
      // sized by its own field count could have its fields land past its end.
      const size = Math.max(1, ctx.recordLayout.fieldCount()) * 8;

      emitAlloc(ctx, buf, local.index, constantSize(size), TAG_RECORD);

      fields.forEach((field, i) => {
        const offset = ctx.recordLayout.declare(field);
        buf.push(OP.local_get);
        emitLEB128U(buf, local.index);
        buf.push(OP.i32_const);
        encodeI32(buf, offset);
        buf.push(OP.i32_add);
        if (i < values.length) {
          // An ADDRESS field is an i32 slot; everything else is an f64. The two
          // widths are not interchangeable — see `fieldIsAddress`.
          if (ctx.moduleTypes.fieldIsAddress.has(field)) {
            emitValue(values[i], ctx, "i32", buf);
            buf.push(OP.i32_store);
          } else {
            emitValue(values[i], ctx, "f64", buf);
            buf.push(OP.f64_store);
          }
        } else {
          buf.push(OP.f64_const);
          encodeF64(buf, 0);
          buf.push(OP.f64_store);
        }
        emitU32MemArg(buf, 0, 0);
      });
      // `emitAlloc` leaves the record's address in the target local.
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "storeelement": {
      // f64.store takes (address, value), so the element ADDRESS is built
      // first and the value second. The address uses the SAME helper as the
      // matching read, or a record written here would not be found there.
      //
      // The VALUE must be written with the same width the matching read uses.
      // An array of records holds i32 addresses, so the slot is written with
      // `i32.store`; writing it as an f64 stored the BITS of the double
      // 65536.0, and the `i32_load` that read it back saw the low 32 bits —
      // zero. A numeric array still holds f64 slots.
      const isAddressArray = isAddressArrayValue(ctx, (inst as any).array);

      emitElementAddress((inst as any).array, (inst as any).index, ctx, buf);
      if (isAddressArray) {
        emitValue((inst as any).value, ctx, "i32", buf);
        buf.push(OP.i32_store);
      } else {
        emitValue((inst as any).value, ctx, "f64", buf);
        buf.push(OP.f64_store);
      }
      emitU32MemArg(buf, 0, 0);
      break;
    }
    case "elementref": {
      // Read the element at `index`. A numeric array holds f64 slots; an array
      // of records holds i32 ADDRESSES. The lowering knows which and says so
      // with `asAddress` — reading an f64 slot as an i32 turned every value
      // into its raw bit pattern, and vice versa.
      const local = ctx.locals.get(inst.target)!;
      emitElementAddress((inst as any).array, (inst as any).index, ctx, buf);
      if ((inst as any).asAddress) {
        buf.push(OP.i32_load);
        emitU32MemArg(buf, 0, 0);
        if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
      } else {
        buf.push(OP.f64_load);
        emitU32MemArg(buf, 0, 0);
        emitConvert("f64", local.type, buf);
      }
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "loadfield": {
      const local = ctx.locals.get(inst.target)!;
      if (inst.computed && (inst as any).index) {
        // `a[i]`. The element's type is the ARRAY's: an f64 slot in a numeric
        // array, an i32 ADDRESS in an array of records. It does not come from
        // the destination local, which `inferLocals` typed f64 — so emitting
        // `f64_load` there re-read a record address as if its bits were a
        // double, and the field load that followed read garbage.
        const baseTemp = (inst as any).object;
        // The array may be referenced by the temp it was lowered to OR by the
        // name it was bound to (`xs` rather than `_t0`). Looking up only the
        // temp misses every named reference, which made an array of records
        // load as f64 and read the record address as a double.
        const isAddressArray = isAddressArrayValue(ctx, baseTemp);

        // **The refusal that belongs here is NOT written yet, and the reason is
        // worth more than the refusal would be.** It is three lines — see
        // BUG-WASM-27 — and it is WRONG today:
        //
        //     if (isRecordValue(ctx, inst.object)) ctx.unsupported.add(…)
        //
        // It fires correctly on a record bound with `let`, on one passed as a
        // parameter and on one reached through a field, and it also fires on a
        // LIST OF RECORDS, because "is this value a list" is not yet known for
        // every list: one the host wrote into memory, or one that arrives from a
        // helper, is an address and is not in `arrayNames`. Six tests went red on
        // that — `xs[i]` over records, `xs.map(fn(o) {…})` — and a guard that
        // refuses a working program is worse than the wrong number it replaces.
        //
        // So the fact has to be completed first, in one place, the way every other
        // cross-function fact in this backend is. Until then this reads the wrong
        // field out of a record, which is BUG-WASM-27's remaining half.

        // **A STRING is a third case: one byte per element, not eight.** It is asked
        // about the VALUE and not about a name, which is what `stringNames` is for —
        // a string, a list and a record are all i32.
        if (isStringValue(ctx, inst.object)) {
          emitElementAddress(inst.object, (inst as any).index, ctx, buf, 1);
          buf.push(OP.i32_load8_u);
          emitU32MemArg(buf, 0, 0);
          emitConvert("i32", local.type, buf);
          buf.push(OP.local_set);
          emitLEB128U(buf, local.index);
          break;
        }

        emitElementAddress(inst.object, (inst as any).index, ctx, buf);
        if (isAddressArray) {
          buf.push(OP.i32_load);
          emitU32MemArg(buf, 0, 0);
          if (local.type === "f64") buf.push(OP.f64_convert_i32_s);
        } else {
          buf.push(OP.f64_load);
          emitU32MemArg(buf, 0, 0);
          emitConvert("f64", local.type, buf);
        }
        buf.push(OP.local_set);
        emitLEB128U(buf, local.index);
        break;
      }

      // `.length` on a LIST is the LENGTH HEADER at offset 0, not a slot in the
      // record layout. Read as a field it got an ordinary field offset, so the
      // answer was whatever bytes sat there — a denormal double where a count
      // belongs. The lowering cannot catch this: `g.cells` is a field read, and
      // nothing there knows it holds a list. The backend can, because a value
      // used as the array of a `push`, a `length` or an index IS a list.
      // The list is the OBJECT of this read (`g.cells.length` reads a field of
      // the value `g.cells`), not the destination temp, which is the length
      // itself and is never a list.
      // A STRING's length is the header at offset 0 too — the same two words an array
      // has, which is why `"hola".length` went from 1634496360 to 4 once the header
      // existed. And a RECORD with a field called `length` has to keep reading that
      // field, so the question is asked of the VALUE and not of the name.
      if (inst.field === "length" && isStringValue(ctx, inst.object)) {
        emitValue(inst.object, ctx, "i32", buf);
        buf.push(OP.i32_load);
        emitU32MemArg(buf, 0, 0);
        emitConvert("i32", local.type, buf);
        buf.push(OP.local_set);
        emitLEB128U(buf, local.index);
        break;
      }
      // **A LIST returned by a call, read in one step: `g().length`.**
      //
      // The receiver is a TEMP, and no name in the module says what a temp holds — but
      // `returnsAddress` says the function gives an address, and for a list AND for a
      // string the header at offset 0 is the count (BUG-WASM-48 put it there). So the
      // answer is a four-byte read, and the branch that was taken instead is the RECORD
      // one, which reads eight bytes as a double and answers a denormal:
      //
      //     fn g() { return [1, 2, 3] }   →   g().length  =  1.6975966329e-313
      //
      // **Deliberately HERE and not inside `isListValue`, which `isRecordValue`
      // consults FIRST.** Measured on the whole family before this line existed:
      //
      //     g().v            = 5      PASS      g()[1]            = 2      PASS
      //     g().startsWith   = 1      PASS      g()[1] on a string = 111    PASS
      //     g().length on a string = 4  PASS      g().length on a list = denormal  WRONG
      //
      // Four of those five go through `isListValue` and are RIGHT. Teaching
      // `isListValue` about calls would take the record branch away from all four to fix
      // one — the shape of a fix that reads as a generalisation and is a regression.
      if (
        inst.field === "length" &&
        (isListValue(ctx, inst.object) || isCallToAnAddress(ctx, inst.object))
      ) {
        emitValue(inst.object, ctx, "i32", buf);
        buf.push(OP.i32_load);
        emitU32MemArg(buf, 0, 0);
        emitConvert("i32", local.type, buf);
        buf.push(OP.local_set);
        emitLEB128U(buf, local.index);
        break;
      }

      // A named field: the object address plus the field's slot offset. The
      // object is an ADDRESS and may sit in an f64 local, so it is narrowed
      // rather than numerically converted.
      emitAddressValue(inst.object, ctx, buf);
      const offset = ctx.recordLayout.declare(inst.field);
      buf.push(OP.i32_const);
      encodeI32(buf, offset);
      buf.push(OP.i32_add);
      if (local.type === "f64" && !ctx.moduleTypes.fieldIsAddress.has(inst.field)) {
        buf.push(OP.f64_load);
      } else {
        buf.push(OP.i32_load);
      }
      emitU32MemArg(buf, 0, 0);
      emitConvert(local.type === "f64" && !ctx.moduleTypes.fieldIsAddress.has(inst.field) ? "f64" : "i32", local.type, buf);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "storefield": {
      // f64.store takes (address, value), so push the slot address first.
      // An ADDRESS field is an i32 slot, and writing it as a double loses the
      // value: the low 32 bits of any address in this heap are zero.
      emitValue(inst.object, ctx, "i32", buf);
      const offset = ctx.recordLayout.declare(inst.field);
      buf.push(OP.i32_const);
      encodeI32(buf, offset);
      buf.push(OP.i32_add);
      if (ctx.moduleTypes.fieldIsAddress.has(inst.field)) {
        emitValue(inst.value, ctx, "i32", buf);
        buf.push(OP.i32_store);
      } else {
        emitValue(inst.value, ctx, "f64", buf);
        buf.push(OP.f64_store);
      }
      emitU32MemArg(buf, 0, 0);
      break;
    }
    default: {
      // Say so. A missing case used to emit nothing, and the engine blamed a
      // stack somewhere else entirely.
      ctx.unsupported.add(String((inst as any).op));
      const local = (inst as any).target ? ctx.locals.get((inst as any).target) : undefined;
      if (local) {
        // Keep the module's shape: something of the right width on the stack,
        // so the real failure is the diagnostic and not a later stack error.
        if (local.type === "i32") {
          buf.push(OP.i32_const);
          encodeI32(buf, 0);
        } else {
          buf.push(OP.f64_const);
          encodeF64(buf, 0);
        }
        buf.push(OP.local_set);
        emitLEB128U(buf, local.index);
      }
      break;
    }
  }
}

/**
 * Push an ADDRESS as an i32, whether it is held in an i32 or an f64 local.
 *
 * WebAssembly has no `i32.reinterpret_f64` — the opcode table was checked
 * against the engine and the only "reinterpret" opcodes are f32/i64 pairs — so
 * an address held in an f64 is narrowed with `i32.trunc_f64_s`. An address is
 * always a small integer well inside the exact range of a double, so this is
 * lossless in practice.
 */
function emitAddressValue(v: IRValue, ctx: CompileCtx, buf: number[]): void {
  if (v.kind === "lit") {
    buf.push(OP.i32_const);
    encodeI32(buf, Number(v.value) || 0);
    return;
  }
  const name = v.kind === "ref" ? v.name : v.kind === "temp" ? v.id : "";
  const local = ctx.locals.get(name);
  if (!local) {
    buf.push(OP.i32_const);
    encodeI32(buf, 0);
    return;
  }
  buf.push(OP.local_get);
  emitLEB128U(buf, local.index);
  if (local.type === "f64") buf.push(OP.i32_trunc_f64_s);
}

/**
 * Push `base + ARRAY_HEADER_BYTES + index * 8`, the address of an element.
 *
 * Both the indexed read and the indexed write used to build this sum in a
 * different ORDER — `(base + i*8) + 8` versus `(base + 8) + i*8` — and an
 * intermediate was widened to f64 and truncated back in one of them, so a
 * record read inside a loop landed on a different address than the one the
 * write used. Integer addition is commutative but the conversions along the
 * way are not, so there is exactly one place that computes it.
 */
/**
 * The address of element `index` of the block whose base is `base`:
 * `base + 8 + index * stride`.
 *
 * **The stride is not always eight.** A list or a record element is eight bytes;
 * a string's BYTE is one. With eight for a string, `"hola"[1]` was read from
 * `base + 8 + 8` instead of `base + 8 + 1` and found nothing that looks like a
 * character — while `"hola"[0]` was right, because `0 << 3` and `0 << 0` are both
 * zero. **That is why a stride bug looks like a first-element-only bug**, and it
 * has now looked like one three times in this project.
 */
function emitElementAddress(
  base: IRValue,
  index: number | IRValue,
  ctx: CompileCtx,
  buf: number[],
  /** Bytes per element: eight for a list or a record, ONE for a string. */
  stride: number = 8,
): void {
  emitValue(base, ctx, "i32", buf);
  buf.push(OP.i32_const);
  encodeI32(buf, ARRAY_HEADER_BYTES);
  buf.push(OP.i32_add);
  if (typeof index === "number") {
    buf.push(OP.i32_const);
    encodeI32(buf, index);
  } else {
    emitValue(index, ctx, "i32", buf);
  }
  if (stride !== 1) {
    buf.push(OP.i32_const);
    encodeI32(buf, 3);
    buf.push(OP.i32_shl); // index * 8
  }
  buf.push(OP.i32_add);
}

function emitValue(v: IRValue, ctx: CompileCtx, targetType: WasmValType, buf: number[]): void {
  if (v.kind === "lit") {
    emitLitValue(v.value, v.litType, targetType, buf, ctx.strings);
    return;
  }

  if (v.kind === "ref" || v.kind === "temp") {
    const name = v.kind === "ref" ? v.name : v.id;
    const local = ctx.locals.get(name);
    if (local) {
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      emitConvert(local.type, targetType, buf);
      return;
    }
    if (targetType === "f64") {
      buf.push(OP.f64_const);
      encodeF64(buf, 0.0);
    } else {
      buf.push(OP.i32_const);
      encodeI32(buf, 0);
    }
    return;
  }

  buf.push(OP.i32_const);
  encodeI32(buf, 0);
}

function emitLitValue(
  value: any,
  kind: string,
  targetType: WasmValType,
  buf: number[],
  strings?: StringTable,
): void {
  // A string has no numeric value: it is interned in memory and the expression
  // evaluates to its i32 ADDRESS. Emitting it as a number produced NaN.
  if (kind === "string" || kind === "char") {
    const address = strings ? strings.intern(String(value)) : 0;
    buf.push(OP.i32_const);
    encodeI32(buf, address);
    if (targetType === "f64") buf.push(OP.f64_convert_i32_s);
    return;
  }

  const srcType = inferLitType(value, kind);
  const numVal = kind === "boolean" ? (value ? 1 : 0) : Number(value);

  if (srcType === "i32") {
    buf.push(OP.i32_const);
    encodeI32(buf, Math.trunc(numVal));
    emitConvert("i32", targetType, buf);
  } else {
    buf.push(OP.f64_const);
    encodeF64(buf, numVal);
    emitConvert("f64", targetType, buf);
  }
}

function emitConvert(from: WasmValType, to: WasmValType, buf: number[]): void {
  if (from === to) return;
  if (from === "i32" && to === "f64") buf.push(OP.f64_convert_i32_s);
  if (from === "f64" && to === "i32") buf.push(OP.i32_trunc_f64_s);
}

function emitBinOp(op: string, type: WasmValType, buf: number[]): void {
  buf.push(getBinOpcode(op, type));
}

function emitUnaryOp(op: string, type: WasmValType, buf: number[]): void {
  // BUG-WASM-80. `Math.floor`/`trunc`/`round`/`sqrt` arrive as a unary operator, and
  // each is ONE opcode. They cannot be a method written in the language — that is
  // the whole reason they are here rather than in `MATH_METHODS`.
  if (op === "floor" || op === "trunc" || op === "round" || op === "sqrt") {
    if (type === "f64") {
      if (op === "floor") buf.push(OP.f64_floor);
      else if (op === "trunc") buf.push(OP.f64_trunc);
      else if (op === "round") buf.push(OP.f64_nearest);
      else buf.push(OP.f64_sqrt);
    }
    return;
  }
  if (op === "-") {
    if (type === "f64") {
      buf.push(OP.f64_neg);
    } else {
      buf.push(OP.i32_const);
      encodeI32(buf, -1);
      buf.push(OP.i32_mul);
    }
  } else if (op === "!") {
    buf.push(OP.i32_eqz);
  }
}

function getBinOpcode(op: string, type: WasmValType): number {
  if (type === "f64") {
    switch (op) {
      case "+": return OP.f64_add;
      case "-": return OP.f64_sub;
      case "*": return OP.f64_mul;
      case "/": return OP.f64_div;
      case "===": case "==": return OP.f64_eq;
      case "!==": case "!=": return OP.f64_ne;
      case "<": return OP.f64_lt;
      case ">": return OP.f64_gt;
      case "<=": return OP.f64_le;
      case ">=": return OP.f64_ge;
      // `&&`, `||` and the bitwise ops are INTEGER in wasm. They used to fall
      // through to `default: f64_add`, so `a && b` on two f64s produced a float
      // sum that was then stored where an i32 was expected.
      case "&&": case "&": return OP.i32_and;
      case "||": case "|": return OP.i32_or;
      case "^": return OP.i32_xor;
      case "<<": return OP.i32_shl;
      case ">>": return OP.i32_shr_s;
      case ">>>": return OP.i32_shr_u;
      default: return OP.f64_add;
    }
  }
  switch (op) {
    case "+": return OP.i32_add;
    case "-": return OP.i32_sub;
    case "*": return OP.i32_mul;
    case "/": return OP.i32_div_s;
    case "%": return OP.i32_rem_s;
    case "===": case "==": return OP.i32_eq;
    case "!==": case "!=": return OP.i32_ne;
    case "<": return OP.i32_lt_s;
    case ">": return OP.i32_gt_s;
    case "<=": return OP.i32_le_s;
    case ">=": return OP.i32_ge_s;
    case "&": case "&&": return OP.i32_and;
    case "|": case "||": return OP.i32_or;
    case "^": return OP.i32_xor;
    case "<<": return OP.i32_shl;
    case ">>": return OP.i32_shr_s;
    case ">>>": return OP.i32_shr_u;
    default: return OP.i32_add;
  }
}

// ── LEB128 Encoding ─────────────────────────────────────────────────

function emitLEB128U(buf: number[], value: number): void {
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    buf.push(byte);
  } while (value !== 0);
}