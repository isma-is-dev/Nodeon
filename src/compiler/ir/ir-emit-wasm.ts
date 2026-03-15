// ── IR → WAT (WebAssembly Text Format) Emission ────────────────────
// Converts optimized IR into WAT text format for numeric functions.
// Supports i32/f64 operations, locals, if/else, function calls.

import {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
} from "./ir-nodes";

// ── WASM Type Inference ─────────────────────────────────────────────

type WasmType = "i32" | "f64" | "void";

function inferLiteralType(value: any, kind: string): WasmType {
  if (kind === "number") {
    return Number.isInteger(value) ? "i32" : "f64";
  }
  if (kind === "boolean") return "i32";
  return "i32"; // default
}

function inferBinOpResult(op: string, leftType: WasmType, rightType: WasmType): WasmType {
  // If either operand is f64, result is f64
  if (leftType === "f64" || rightType === "f64") return "f64";
  // Comparison operators always return i32
  if (["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(op)) return "i32";
  // Division produces f64
  if (op === "/") return "f64";
  return "i32";
}

// ── WAT Emission ────────────────────────────────────────────────────

export interface WasmEmitResult {
  wat: string;
  exports: string[];
}

export function emitWasm(mod: IRModule): WasmEmitResult {
  const lines: string[] = [];
  const exports: string[] = [];

  lines.push("(module");

  // Emit functions
  for (const fn of mod.functions) {
    const result = emitWasmFunction(fn);
    lines.push(result.wat);
    exports.push(fn.name);
  }

  // Emit global initializers as $__init function if any globals exist
  if (mod.globals.length > 0) {
    const initResult = emitGlobalInit(mod.globals);
    if (initResult) {
      lines.push(initResult);
      exports.push("__init");
    }
  }

  // Export all functions
  for (const name of exports) {
    lines.push(`  (export "${name}" (func $${name}))`);
  }

  lines.push(")");
  return { wat: lines.join("\n"), exports };
}

function emitWasmFunction(fn: IRFunction): { wat: string } {
  const lines: string[] = [];
  const locals = new Map<string, WasmType>(); // name → type
  const tempTypes = new Map<string, WasmType>(); // temp → type

  // First pass: collect all locals and infer types
  for (const block of fn.blocks) {
    inferBlockTypes(block, locals, tempTypes);
  }

  // Build param list — default to f64 for flexibility
  const params = fn.params.map((p) => {
    const typ = locals.get(p) ?? "f64";
    locals.set(p, typ);
    return `(param $${p} ${typ})`;
  }).join(" ");

  // Determine return type from first return terminator
  let returnType: WasmType = "void";
  for (const block of fn.blocks) {
    if (block.terminator?.op === "return" && block.terminator.value) {
      returnType = resolveValueType(block.terminator.value, locals, tempTypes);
      break;
    }
  }
  const resultClause = returnType !== "void" ? `(result ${returnType})` : "";

  // Build local declarations (exclude params)
  const paramSet = new Set(fn.params);
  const localDecls: string[] = [];
  for (const [name, typ] of locals) {
    if (!paramSet.has(name)) {
      localDecls.push(`    (local $${name} ${typ})`);
    }
  }
  for (const [id, typ] of tempTypes) {
    localDecls.push(`    (local $${id} ${typ})`);
  }

  lines.push(`  (func $${fn.name} ${params} ${resultClause}`);
  lines.push(...localDecls);

  // Emit instructions for each block
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      const code = emitInstruction(inst, locals, tempTypes);
      if (code) lines.push(`    ${code}`);
    }
    if (block.terminator) {
      const code = emitTerminator(block.terminator, locals, tempTypes);
      if (code) lines.push(`    ${code}`);
    }
  }

  lines.push("  )");
  return { wat: lines.join("\n") };
}

function emitGlobalInit(globals: IRInstruction[]): string | null {
  const lines: string[] = [];
  const locals = new Map<string, WasmType>();
  const tempTypes = new Map<string, WasmType>();

  // Infer types
  for (const inst of globals) {
    inferInstructionTypes(inst, locals, tempTypes);
  }

  const localDecls: string[] = [];
  for (const [name, typ] of locals) {
    localDecls.push(`    (local $${name} ${typ})`);
  }
  for (const [id, typ] of tempTypes) {
    localDecls.push(`    (local $${id} ${typ})`);
  }

  lines.push("  (func $__init");
  lines.push(...localDecls);

  for (const inst of globals) {
    const code = emitInstruction(inst, locals, tempTypes);
    if (code) lines.push(`    ${code}`);
  }

  lines.push("  )");
  return lines.join("\n");
}

// ── Type Inference Helpers ──────────────────────────────────────────

function inferBlockTypes(
  block: IRBlock,
  locals: Map<string, WasmType>,
  tempTypes: Map<string, WasmType>,
): void {
  for (const inst of block.instructions) {
    inferInstructionTypes(inst, locals, tempTypes);
  }
}

function inferInstructionTypes(
  inst: IRInstruction,
  locals: Map<string, WasmType>,
  tempTypes: Map<string, WasmType>,
): void {
  switch (inst.op) {
    case "literal": {
      const typ = inferLiteralType(inst.value, inst.kind);
      tempTypes.set(inst.target, typ);
      break;
    }
    case "binop": {
      const lt = resolveValueType(inst.left, locals, tempTypes);
      const rt = resolveValueType(inst.right, locals, tempTypes);
      const result = inferBinOpResult(inst.operator, lt, rt);
      tempTypes.set(inst.target, result);
      break;
    }
    case "unaryop": {
      const at = resolveValueType(inst.argument, locals, tempTypes);
      tempTypes.set(inst.target, at);
      break;
    }
    case "declare": {
      const typ = inst.value ? resolveValueType(inst.value, locals, tempTypes) : "i32";
      locals.set(inst.name, typ);
      break;
    }
    case "assign": {
      const typ = resolveValueType(inst.value, locals, tempTypes);
      locals.set(inst.target, typ);
      break;
    }
    case "call": {
      if (inst.target) tempTypes.set(inst.target, "f64"); // default call result
      break;
    }
    case "loadfield":
      tempTypes.set(inst.target, "f64");
      break;
  }
}

function resolveValueType(
  v: IRValue,
  locals: Map<string, WasmType>,
  tempTypes: Map<string, WasmType>,
): WasmType {
  if (v.kind === "lit") return inferLiteralType(v.value, v.litType);
  if (v.kind === "ref") return locals.get(v.name) ?? "f64";
  if (v.kind === "temp") return tempTypes.get(v.id) ?? "f64";
  return "f64";
}

// ── Instruction Emission ────────────────────────────────────────────

function emitInstruction(
  inst: IRInstruction,
  locals: Map<string, WasmType>,
  tempTypes: Map<string, WasmType>,
): string {
  switch (inst.op) {
    case "literal": {
      const typ = tempTypes.get(inst.target) ?? "i32";
      const val = inst.kind === "boolean" ? (inst.value ? 1 : 0) : inst.value;
      if (typ === "f64") {
        return `(local.set $${inst.target} (f64.const ${Number(val)}))`;
      }
      return `(local.set $${inst.target} (i32.const ${Math.trunc(Number(val))}))`;
    }
    case "binop": {
      const resultType = tempTypes.get(inst.target) ?? "i32";
      const leftCode = emitValueGet(inst.left, locals, tempTypes, resultType);
      const rightCode = emitValueGet(inst.right, locals, tempTypes, resultType);
      const wasmOp = mapBinOp(inst.operator, resultType);
      return `(local.set $${inst.target} (${wasmOp} ${leftCode} ${rightCode}))`;
    }
    case "unaryop": {
      const argType = tempTypes.get(inst.target) ?? "i32";
      const argCode = emitValueGet(inst.argument, locals, tempTypes, argType);
      if (inst.operator === "-") {
        if (argType === "f64") {
          return `(local.set $${inst.target} (f64.neg ${argCode}))`;
        }
        return `(local.set $${inst.target} (i32.sub (i32.const 0) ${argCode}))`;
      }
      if (inst.operator === "!") {
        return `(local.set $${inst.target} (i32.eqz ${argCode}))`;
      }
      return `(local.set $${inst.target} ${argCode})`;
    }
    case "declare": {
      if (!inst.value) return "";
      const typ = locals.get(inst.name) ?? "i32";
      const valCode = emitValueGet(inst.value, locals, tempTypes, typ);
      return `(local.set $${inst.name} ${valCode})`;
    }
    case "assign": {
      const typ = locals.get(inst.target) ?? "i32";
      const valCode = emitValueGet(inst.value, locals, tempTypes, typ);
      return `(local.set $${inst.target} ${valCode})`;
    }
    case "call": {
      const args = inst.args.map((a) => emitValueGet(a, locals, tempTypes, "f64")).join(" ");
      const calleeName = inst.callee.kind === "ref" ? inst.callee.name : "unknown";
      const callExpr = `(call $${calleeName}${args ? " " + args : ""})`;
      if (inst.target) {
        return `(local.set $${inst.target} ${callExpr})`;
      }
      return callExpr;
    }
    case "exprstmt":
      // Expression statements with side effects — drop result if any
      return `(drop ${emitValueGet(inst.value, locals, tempTypes, "i32")})`;
    default:
      return `;; unsupported: ${(inst as any).op}`;
  }
}

function emitTerminator(
  term: IRTerminator,
  locals: Map<string, WasmType>,
  tempTypes: Map<string, WasmType>,
): string {
  switch (term.op) {
    case "return": {
      if (!term.value) return "return";
      const retType = resolveValueType(term.value, locals, tempTypes);
      return `(return ${emitValueGet(term.value, locals, tempTypes, retType)})`;
    }
    case "branch": {
      const cond = emitValueGet(term.condition, locals, tempTypes, "i32");
      return `(if ${cond} (then) (else))`;
    }
    case "jump":
      return ``;
  }
}

// ── Value Emission ──────────────────────────────────────────────────

function emitValueGet(
  v: IRValue,
  locals: Map<string, WasmType>,
  tempTypes: Map<string, WasmType>,
  targetType: WasmType,
): string {
  if (v.kind === "lit") {
    const litType = inferLiteralType(v.value, v.litType);
    const val = v.litType === "boolean" ? (v.value ? 1 : 0) : v.value;
    if (targetType === "f64" && litType === "i32") {
      return `(f64.convert_i32_s (i32.const ${Math.trunc(Number(val))}))`;
    }
    if (targetType === "i32" && litType === "f64") {
      return `(i32.trunc_f64_s (f64.const ${Number(val)}))`;
    }
    if (targetType === "f64") {
      return `(f64.const ${Number(val)})`;
    }
    return `(i32.const ${Math.trunc(Number(val))})`;
  }

  if (v.kind === "ref") {
    const refType = locals.get(v.name) ?? "f64";
    const get = `(local.get $${v.name})`;
    return maybeConvert(get, refType, targetType);
  }

  if (v.kind === "temp") {
    const tmpType = tempTypes.get(v.id) ?? "f64";
    const get = `(local.get $${v.id})`;
    return maybeConvert(get, tmpType, targetType);
  }

  return `(i32.const 0)`;
}

function maybeConvert(expr: string, from: WasmType, to: WasmType): string {
  if (from === to) return expr;
  if (from === "i32" && to === "f64") return `(f64.convert_i32_s ${expr})`;
  if (from === "f64" && to === "i32") return `(i32.trunc_f64_s ${expr})`;
  return expr;
}

// ── Operator Mapping ────────────────────────────────────────────────

function mapBinOp(op: string, type: WasmType): string {
  const prefix = type === "f64" ? "f64" : "i32";
  switch (op) {
    case "+": return `${prefix}.add`;
    case "-": return `${prefix}.sub`;
    case "*": return `${prefix}.mul`;
    case "/": return type === "f64" ? "f64.div" : "i32.div_s";
    case "%": return type === "f64" ? "f64.copysign" : "i32.rem_s"; // f64 has no rem
    case "**": return `${prefix}.mul`; // simplified — real pow needs runtime
    case "===": case "==": return `${prefix}.eq`;
    case "!==": case "!=": return `${prefix}.ne`;
    case "<": return type === "f64" ? "f64.lt" : "i32.lt_s";
    case ">": return type === "f64" ? "f64.gt" : "i32.gt_s";
    case "<=": return type === "f64" ? "f64.le" : "i32.le_s";
    case ">=": return type === "f64" ? "f64.ge" : "i32.ge_s";
    case "&": return "i32.and";
    case "|": return "i32.or";
    case "^": return "i32.xor";
    case "<<": return "i32.shl";
    case ">>": return "i32.shr_s";
    case ">>>": return "i32.shr_u";
    case "&&": return "i32.and";
    case "||": return "i32.or";
    default: return `${prefix}.add`; // fallback
  }
}
