// ── WASM Binary Encoder ─────────────────────────────────────────────
// Generates .wasm binary bytes directly from a simple module description.
// No external dependencies — pure TypeScript implementation.

// ── WASM Section IDs ────────────────────────────────────────────────
const SECTION_TYPE = 1;
const SECTION_TABLE = 4;
const SECTION_FUNCTION = 3;
const SECTION_MEMORY = 5;
const SECTION_EXPORT = 7;
const SECTION_CODE = 10;
const SECTION_ELEMENT = 9;
const SECTION_DATA = 11;

// ── WASM Type Constants ─────────────────────────────────────────────
const WASM_I32 = 0x7f;
const WASM_F64 = 0x7c;
const FUNC_TYPE = 0x60;
const EXPORT_FUNC = 0x00;
const EXPORT_MEM = 0x02;
const LIMITS_MIN_ONLY = 0x00;

// ── WASM Opcodes ────────────────────────────────────────────────────
export const OP = {
  // Control
  unreachable: 0x00,
  nop: 0x01,
  block: 0x02,
  loop: 0x03,
  if: 0x04,
  else: 0x05,
  end: 0x0b,
  br: 0x0c,
  br_if: 0x0d,
  return: 0x0f,
  call: 0x10,
  call_indirect: 0x11,
  drop: 0x1a,

  // Locals
  local_get: 0x20,
  local_set: 0x21,
  local_tee: 0x22,

  // i32 operations
  i32_const: 0x41,
  i32_eqz: 0x45,
  i32_eq: 0x46,
  i32_ne: 0x47,
  i32_lt_s: 0x48,
  i32_gt_s: 0x4a,
  // The UNSIGNED comparisons. A byte scan asks `i >= n` about a LENGTH, and the
  // signed ones do not answer that: a length above 2^31 is negative, and a
  // negative `i` passes `< n` for every `n`. `i32_gt_u` was already here and
  // correct against the spec; these three are the rest of the family.
  i32_lt_u: 0x49,
  i32_gt_u: 0x4b,
  i32_le_u: 0x4d,
  i32_ge_u: 0x4f,
  i32_le_s: 0x4c,
  i32_ge_s: 0x4e,
  i32_add: 0x6a,
  i32_sub: 0x6b,
  i32_mul: 0x6c,
  i32_div_s: 0x6d,
  i32_rem_s: 0x6f,
  i32_and: 0x71,
  i32_or: 0x72,
  i32_xor: 0x73,
  i32_shl: 0x74,
  i32_shr_s: 0x75,
  i32_shr_u: 0x76,

  // f64 operations
  f64_const: 0x44,
  f64_eq: 0x61,
  f64_ne: 0x62,
  f64_lt: 0x63,
  f64_gt: 0x64,
  f64_le: 0x65,
  f64_ge: 0x66,
  f64_add: 0xa0,
  f64_sub: 0xa1,
  f64_mul: 0xa2,
  f64_div: 0xa3,
  f64_neg: 0x9a,

  // Conversions
  i32_trunc_f64_s: 0xaa,
  // The unsigned readings. A record address is a small positive number, so the
  // unsigned form is the exact one for everything the heap can hold, while
  // `trunc_f64_s` reads a value above 2^31 as a negative one.
  // 0xab, not 0xad: 0xad is `i64.extend_i32_u`. Nothing called this, which is the
  // only reason a wrong opcode in the table survived this long.
  i32_trunc_f64_u: 0xab,
  // `f64.trunc`, and the reason `%` can be a truncating remainder at all:
  // WebAssembly has NO `f64.rem` — remainder is an integer opcode — so a float
  // remainder is trunc, to an integer, `i32.rem_s`, and back.
  f64_trunc: 0x9d,
  // BUG-WASM-80. Its three neighbours, which `Math` needs and no program in this
  // language can express. A number here is an f64, so these are the only way to
  // reach an integer — and `Math.trunc` is what makes a digit recoverable, which is
  // what the text layer was waiting on.
  f64_floor: 0x9c,
  f64_nearest: 0x9e,
  f64_sqrt: 0x9f,
  f64_convert_i32_s: 0xb7,
  // 0xb9 is f64.convert_i64_s. Using it looked right — it is in the same
  // family and one above — and the engine said "expected type i64".
  f64_convert_i32_u: 0xb8,

  // ── Memory access ────────────────────────────────────────────────
  // Without these there is nowhere to put a string, an array element or an
  // object field: every such expression lowered to an unresolved reference
  // that encoded as a zero constant.
  i32_load: 0x28,
  f64_load: 0x2b,
  i32_load8_s: 0x2c,
  i32_load8_u: 0x2d,
  i32_load16_s: 0x2e,
  i32_load16_u: 0x2f,
  i32_store: 0x36,
  f64_store: 0x39,
  i32_store8: 0x3a,
  // `select` pops a condition and two values of the same type and pushes one. It is
  // the branch-free `a < b ? b : a` a CLAMP needs, and there is no other way to write
  // one here: the `i32_const / if / else` form would have to carry the value through
  // both arms in a local. Used by the string slice's range clamps.
  select: 0x1b,
  i32_store16: 0x3b,
  memory_size: 0x3f,
  memory_grow: 0x40,

  // Sign-extension
  i32_extend8_s: 0xc0,
  i32_extend16_s: 0xc1,

  // Reinterpretation (exact, unlike a numeric convert)
  // 0xbc is i32.reinterpret_f32; the f64 form is 0xbd.
  i32_reinterpret_f64: 0xbd,
  f64_reinterpret_i32: 0xbe,
} as const;

// ── Module Description ──────────────────────────────────────────────

export type WasmValType = "i32" | "f64";

export interface WasmFuncType {
  params: WasmValType[];
  results: WasmValType[];
}

export interface WasmFunc {
  name: string;
  type: WasmFuncType;
  locals: WasmValType[];
  body: number[]; // raw opcodes
}

export interface WasmModuleDesc {
  functions: WasmFunc[];
  exports: { name: string; funcIndex: number }[];
  /**
   * Linear memory in bytes. The module gets exactly one memory, exported as
   * `memory`, and data segments are placed at `dataOffset`.
   */
  memoryPages?: number;
  /** Page index the runtime heap starts on (default 2 = address 131072). */
  heapStartPage?: number;
  /** Initial contents, at address 0. */
  data?: Uint8Array;
  /**
   * True when any function VALUE exists, which is what needs the funcref table
   * and the element segment. A module with only direct calls does not get
   * them, so its size is unchanged.
   */
  usesFunctionValues?: boolean;
  /**
   * The function's index, so a `call_indirect` can name the right type. Filled
   * in by the encoder from the order of `functions`; the emitter asks for it
   * through `funcIndexOf`.
   */
  index?: number;
  /**
   * Every distinct signature in the module, in type-index order. The emitter
   * needs the SAME list to name a type in a `call_indirect`, and two copies of
   * the dedup would eventually disagree — which is what happened when the
   * signature, the local map and the result classification each decided for
   * themselves.
   */
  typeSignatures?: string[];
}

// ── Binary Encoding ─────────────────────────────────────────────────

export function encodeWasmModule(desc: WasmModuleDesc): Uint8Array {
  const bytes: number[] = [];

  // Magic number + version
  bytes.push(0x00, 0x61, 0x73, 0x6d); // \0asm
  bytes.push(0x01, 0x00, 0x00, 0x00); // version 1

  // Collect unique function types
  const typeSignatures: string[] = desc.typeSignatures ? [...desc.typeSignatures] : [];
  const funcTypeIndices: number[] = [];

  for (const fn of desc.functions) {
    const sig = serializeType(fn.type);
    let idx = typeSignatures.indexOf(sig);
    if (idx === -1) {
      idx = typeSignatures.length;
      typeSignatures.push(sig);
    }
    funcTypeIndices.push(idx);
  }

  // Type section
  const typeSection: number[] = [];
  encodeU32(typeSection, typeSignatures.length);
  for (const sig of typeSignatures) {
    const type = deserializeType(sig);
    typeSection.push(FUNC_TYPE);
    encodeU32(typeSection, type.params.length);
    for (const p of type.params) typeSection.push(valTypeByte(p));
    encodeU32(typeSection, type.results.length);
    for (const r of type.results) typeSection.push(valTypeByte(r));
  }
  writeSection(bytes, SECTION_TYPE, typeSection);

  // Function section (maps func index → type index)
  const funcSection: number[] = [];
  encodeU32(funcSection, desc.functions.length);
  for (const idx of funcTypeIndices) {
    encodeU32(funcSection, idx);
  }
  writeSection(bytes, SECTION_FUNCTION, funcSection);

  // Table section — one funcref table holding EVERY function.
  //
  // A function VALUE is a function's index in this table, so an index that is
  // not in it is not a trap you can catch: the call lands on whatever sits
  // there. Putting all of them in makes an index always mean what it says.
  // The table is only emitted when a function value is possible, so a module
  // with no indirect call stays exactly as small as before.
  if (desc.functions.length > 0 && desc.usesFunctionValues) {
    const tableSection: number[] = [];
    encodeU32(tableSection, 1); // one table
    tableSection.push(0x70); // funcref
    tableSection.push(LIMITS_MIN_ONLY);
    encodeU32(tableSection, desc.functions.length);
    writeSection(bytes, SECTION_TABLE, tableSection);
  }

  // Memory section — one memory, sized to hold the static data AND the runtime
  // heap. The heap starts at 65536, so the memory must have at least two pages
  // whenever the data section reaches into the first one: with a single page
  // every store into the heap is out of bounds, the engine discards it, the
  // allocator never advances, and every record reads back as 0.
  const dataBytes = desc.data ? desc.data.length : 0;
  const heapPages = desc.heapStartPage ?? 2; // heap begins on page 2
  const neededPages = Math.max(
    1,
    desc.memoryPages ?? 0,
    Math.ceil((dataBytes + 64) / 65536),
    heapPages,
  );
  const memSection: number[] = [];
  encodeU32(memSection, 1); // one memory
  memSection.push(LIMITS_MIN_ONLY);
  encodeU32(memSection, neededPages);
  writeSection(bytes, SECTION_MEMORY, memSection);

  // Export section — functions, then the memory so the host can read it.
  const exportSection: number[] = [];
  encodeU32(exportSection, desc.exports.length + 1);
  for (const exp of desc.exports) {
    encodeString(exportSection, exp.name);
    exportSection.push(EXPORT_FUNC);
    encodeU32(exportSection, exp.funcIndex);
  }
  encodeString(exportSection, "memory");
  exportSection.push(EXPORT_MEM);
  encodeU32(exportSection, 0);
  writeSection(bytes, SECTION_EXPORT, exportSection);

  // Element section — one active segment of function indices at table slot 0,
  // so a function value is simply the function's index.
  //
  // Section ORDER is part of the format: element (9) has to precede code (10),
  // and the engine says "unexpected section <Element>" rather than naming the
  // ordering rule.
  //
  // Segment flags 0 is the MVP form: table index, offset expression, then a
  // vector of function indices. The newer bulk-memory encoding would be flags 2
  // with an element kind byte first, and the two are not interchangeable.
  if (desc.functions.length > 0 && desc.usesFunctionValues) {
    const elemSection: number[] = [];
    encodeU32(elemSection, 1); // one segment
    encodeU32(elemSection, 0); // table 0
    elemSection.push(OP.i32_const);
    encodeI32(elemSection, 0); // offset 0
    elemSection.push(OP.end);
    encodeU32(elemSection, desc.functions.length);
    for (let i = 0; i < desc.functions.length; i++) encodeU32(elemSection, i);
    writeSection(bytes, SECTION_ELEMENT, elemSection);
  }

  // Every emitted byte must be a real byte.
  //
  // A missing entry in the `OP` table used to reach the encoder as `undefined`,
  // and `Buffer`-style coercion turned it into a zero byte — the `unreachable`
  // opcode. The module then validated and trapped at run time, pointing at
  // nothing: a name that does not exist in the table is a mistake in the
  // emitter, and it has to say so where it happened.
  for (const fn of desc.functions) {
    for (let i = 0; i < fn.body.length; i++) {
      const byte = fn.body[i];
      if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new Error(
          `opcode no válido (${String(byte)}) en ${fn.name}, offset ${i}: ` +
            `el nombre no está en la tabla OP`,
        );
      }
    }
  }

  // Code section
  const codeSection: number[] = [];
  encodeU32(codeSection, desc.functions.length);
  for (const fn of desc.functions) {
    const funcBody: number[] = [];

    // Local declarations — group consecutive same-type locals
    const localGroups: { count: number; type: WasmValType }[] = [];
    for (const local of fn.locals) {
      if (localGroups.length > 0 && localGroups[localGroups.length - 1].type === local) {
        localGroups[localGroups.length - 1].count++;
      } else {
        localGroups.push({ count: 1, type: local });
      }
    }
    encodeU32(funcBody, localGroups.length);
    for (const group of localGroups) {
      encodeU32(funcBody, group.count);
      funcBody.push(valTypeByte(group.type));
    }

    // Body opcodes
    funcBody.push(...fn.body);
    funcBody.push(OP.end); // function end

    // Write func body with size prefix
    encodeU32(codeSection, funcBody.length);
    codeSection.push(...funcBody);
  }
  writeSection(bytes, SECTION_CODE, codeSection);

  // Data section — seeds linear memory with the module's constant data
  // (string literals, static arrays). Must come after the code section.
  if (dataBytes > 0 && desc.data) {
    const dataSection: number[] = [];
    encodeU32(dataSection, 1); // one active segment
    // Segment header: memory index 0, offset expression.
    encodeU32(dataSection, 0); // flags: active, memory 0
    dataSection.push(OP.i32_const);
    encodeI32(dataSection, 0); // offset 0
    dataSection.push(OP.end);
    encodeU32(dataSection, dataBytes);
    for (let i = 0; i < dataBytes; i++) dataSection.push(desc.data[i]);
    writeSection(bytes, SECTION_DATA, dataSection);
  }

  return new Uint8Array(bytes);
}

// ── Encoding Helpers ────────────────────────────────────────────────

function encodeU32(buf: number[], value: number): void {
  // LEB128 unsigned encoding
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    buf.push(byte);
  } while (value !== 0);
}

export function encodeI32(buf: number[], value: number): void {
  // LEB128 **signed** encoding.
  //
  // The last byte is the one where the remaining value is 0 AND this byte's
  // sign bit (0x40) is CLEAR. A set sign bit always requires another byte, even
  // when the remaining value is -1 — that is what makes -8 encode as
  //  xF8 0x7F and not as a single  x78.
  //
  // Stopping at  x78 is the trap: the engine then reads **120**, not -8. The
  // alignment mask became x & 120, the heap pointer was never aligned, and
  // every record landed on a wrong address.
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7; // arithmetic shift preserves the sign
    const signBitSet = (byte & 0x40) !== 0;
    // Two stopping conditions, and BOTH are needed. Stopping only on
    // `value === 0` makes a negative value whose sign bit is set loop forever:
    // `(-1 & 0x7f)` is 0x7f, whose sign bit is set, so it would always ask
    // for another byte. Stopping only on `value === -1` mis-encodes `-8` as the
    // single byte 0x78, which the engine reads as 120.
    if ((value === 0 && !signBitSet) || (value === -1 && signBitSet)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    buf.push(byte);
  }
}

export function encodeF64(buf: number[], value: number): void {
  const float = new Float64Array([value]);
  const bytes = new Uint8Array(float.buffer);
  for (let i = 0; i < 8; i++) buf.push(bytes[i]);
}

function encodeString(buf: number[], str: string): void {
  const encoded = new TextEncoder().encode(str);
  encodeU32(buf, encoded.length);
  for (let i = 0; i < encoded.length; i++) buf.push(encoded[i]);
}

function writeSection(buf: number[], id: number, content: number[]): void {
  buf.push(id);
  encodeU32(buf, content.length);
  // Not `buf.push(...content)`: a data section can carry tens of thousands of
  // bytes, and spreading that many arguments overflows the call and throws
  // "Invalid array length".
  for (let i = 0; i < content.length; i++) buf.push(content[i]);
}

function valTypeByte(t: WasmValType): number {
  return t === "i32" ? WASM_I32 : WASM_F64;
}

/**
 * The one text form of a signature, in type-index order.
 *
 * Exported because the emitter has to build the SAME list to name a type in a
 * `call_indirect`. A second format invented in the emitter deserialised into a
 * type with the wrong parameter count, and the engine blamed the call site for
 * not pushing enough arguments when it had pushed exactly the right nine.
 */
export function serializeType(t: WasmFuncType): string {
  return `${t.params.join(",")}=>${t.results.join(",")}`;
}

function deserializeType(sig: string): WasmFuncType {
  const [paramStr, resultStr] = sig.split("=>");
  const params = paramStr ? paramStr.split(",").filter(Boolean) as WasmValType[] : [];
  const results = resultStr ? resultStr.split(",").filter(Boolean) as WasmValType[] : [];
  return { params, results };
}