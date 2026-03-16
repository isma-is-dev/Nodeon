// ── WASM Binary Encoder ─────────────────────────────────────────────
// Generates .wasm binary bytes directly from a simple module description.
// No external dependencies — pure TypeScript implementation.

// ── WASM Section IDs ────────────────────────────────────────────────
const SECTION_TYPE = 1;
const SECTION_FUNCTION = 3;
const SECTION_EXPORT = 7;
const SECTION_CODE = 10;

// ── WASM Type Constants ─────────────────────────────────────────────
const WASM_I32 = 0x7f;
const WASM_F64 = 0x7c;
const FUNC_TYPE = 0x60;
const EXPORT_FUNC = 0x00;

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
  f64_convert_i32_s: 0xb7,
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
}

// ── Binary Encoding ─────────────────────────────────────────────────

export function encodeWasmModule(desc: WasmModuleDesc): Uint8Array {
  const bytes: number[] = [];

  // Magic number + version
  bytes.push(0x00, 0x61, 0x73, 0x6d); // \0asm
  bytes.push(0x01, 0x00, 0x00, 0x00); // version 1

  // Collect unique function types
  const typeSignatures: string[] = [];
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

  // Export section
  const exportSection: number[] = [];
  encodeU32(exportSection, desc.exports.length);
  for (const exp of desc.exports) {
    encodeString(exportSection, exp.name);
    exportSection.push(EXPORT_FUNC);
    encodeU32(exportSection, exp.funcIndex);
  }
  writeSection(bytes, SECTION_EXPORT, exportSection);

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
  // LEB128 signed encoding
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) {
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
  buf.push(...content);
}

function valTypeByte(t: WasmValType): number {
  return t === "i32" ? WASM_I32 : WASM_F64;
}

function serializeType(t: WasmFuncType): string {
  return `${t.params.join(",")}=>${t.results.join(",")}`;
}

function deserializeType(sig: string): WasmFuncType {
  const [paramStr, resultStr] = sig.split("=>");
  const params = paramStr ? paramStr.split(",").filter(Boolean) as WasmValType[] : [];
  const results = resultStr ? resultStr.split(",").filter(Boolean) as WasmValType[] : [];
  return { params, results };
}
