// ── IR → WASM Binary Compiler ───────────────────────────────────────
// Converts optimized IR directly to WASM binary bytecode.
// Uses the wasm-binary encoder for byte generation.

import {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
} from "./ir-nodes";
import {
  WasmModuleDesc, WasmFunc, WasmFuncType, WasmValType,
  encodeWasmModule, encodeI32, encodeF64, OP,
} from "./wasm-binary";

// ── Type Inference ──────────────────────────────────────────────────

function inferLitType(value: any, kind: string): WasmValType {
  if (kind === "number") return Number.isInteger(value) ? "i32" : "f64";
  if (kind === "boolean") return "i32";
  return "i32";
}

function inferBinOpType(op: string, lt: WasmValType, rt: WasmValType): WasmValType {
  if (lt === "f64" || rt === "f64") return "f64";
  if (["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(op)) return "i32";
  if (op === "/") return "f64";
  return "i32";
}

// ── Main Entry ──────────────────────────────────────────────────────

export function compileIRToWasmBinary(mod: IRModule): Uint8Array {
  const desc = compileIRToWasmDesc(mod);
  return encodeWasmModule(desc);
}

export function compileIRToWasmDesc(mod: IRModule): WasmModuleDesc {
  const functions: WasmFunc[] = [];
  const funcNames: string[] = [];

  for (const fn of mod.functions) {
    functions.push(compileFn(fn, funcNames));
    funcNames.push(fn.name);
  }

  const exports = functions.map((f, i) => ({ name: f.name, funcIndex: i }));
  return { functions, exports };
}

// ── Function Compilation ────────────────────────────────────────────

interface CompileCtx {
  locals: Map<string, { index: number; type: WasmValType }>;
  funcNames: string[];
  nextLocal: number;
}

function compileFn(fn: IRFunction, funcNames: string[]): WasmFunc {
  const ctx: CompileCtx = {
    locals: new Map(),
    funcNames: [...funcNames, fn.name],
    nextLocal: 0,
  };

  // Register params
  const paramTypes: WasmValType[] = [];
  for (const p of fn.params) {
    const typ = inferParamType(fn, p);
    paramTypes.push(typ);
    ctx.locals.set(p, { index: ctx.nextLocal++, type: typ });
  }

  // First pass: collect all locals/temps and infer types
  const localTypes: WasmValType[] = [];
  collectLocals(fn, ctx, localTypes);

  // Determine return type
  let resultType: WasmValType | null = null;
  for (const block of fn.blocks) {
    if (block.terminator?.op === "return" && block.terminator.value) {
      resultType = resolveType(block.terminator.value, ctx);
      break;
    }
  }

  // Second pass: emit bytecode
  const body: number[] = [];
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      emitInst(inst, ctx, body);
    }
    if (block.terminator) {
      emitTerm(block.terminator, ctx, body, resultType);
    }
  }

  return {
    name: fn.name,
    type: {
      params: paramTypes,
      results: resultType ? [resultType] : [],
    },
    locals: localTypes,
    body,
  };
}

function inferParamType(fn: IRFunction, paramName: string): WasmValType {
  // Scan function body for usage hints
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.op === "binop") {
        if ((inst.left.kind === "ref" && inst.left.name === paramName) ||
            (inst.right.kind === "ref" && inst.right.name === paramName)) {
          // Check if the other operand is f64
          const other = inst.left.kind === "ref" && inst.left.name === paramName
            ? inst.right : inst.left;
          if (other.kind === "lit" && !Number.isInteger(other.value)) return "f64";
        }
      }
    }
  }
  return "f64"; // default to f64 for flexibility
}

function collectLocals(fn: IRFunction, ctx: CompileCtx, localTypes: WasmValType[]): void {
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      switch (inst.op) {
        case "literal": {
          if (!ctx.locals.has(inst.target)) {
            const typ = inferLitType(inst.value, inst.kind);
            localTypes.push(typ);
            ctx.locals.set(inst.target, { index: ctx.nextLocal++, type: typ });
          }
          break;
        }
        case "binop": {
          if (!ctx.locals.has(inst.target)) {
            const lt = resolveType(inst.left, ctx);
            const rt = resolveType(inst.right, ctx);
            const typ = inferBinOpType(inst.operator, lt, rt);
            localTypes.push(typ);
            ctx.locals.set(inst.target, { index: ctx.nextLocal++, type: typ });
          }
          break;
        }
        case "unaryop": {
          if (!ctx.locals.has(inst.target)) {
            const typ = resolveType(inst.argument, ctx);
            localTypes.push(typ);
            ctx.locals.set(inst.target, { index: ctx.nextLocal++, type: typ });
          }
          break;
        }
        case "declare": {
          if (!ctx.locals.has(inst.name)) {
            const typ = inst.value ? resolveType(inst.value, ctx) : "i32";
            localTypes.push(typ);
            ctx.locals.set(inst.name, { index: ctx.nextLocal++, type: typ });
          }
          break;
        }
        case "assign": {
          if (!ctx.locals.has(inst.target)) {
            const typ = resolveType(inst.value, ctx);
            localTypes.push(typ);
            ctx.locals.set(inst.target, { index: ctx.nextLocal++, type: typ });
          }
          break;
        }
        case "call": {
          if (inst.target && !ctx.locals.has(inst.target)) {
            localTypes.push("f64");
            ctx.locals.set(inst.target, { index: ctx.nextLocal++, type: "f64" });
          }
          break;
        }
      }
    }
  }
}

function resolveType(v: IRValue, ctx: CompileCtx): WasmValType {
  if (v.kind === "lit") return inferLitType(v.value, v.litType);
  if (v.kind === "ref") return ctx.locals.get(v.name)?.type ?? "f64";
  if (v.kind === "temp") return ctx.locals.get(v.id)?.type ?? "f64";
  return "f64";
}

// ── Bytecode Emission ───────────────────────────────────────────────

function emitInst(inst: IRInstruction, ctx: CompileCtx, buf: number[]): void {
  switch (inst.op) {
    case "literal": {
      const local = ctx.locals.get(inst.target)!;
      emitLitValue(inst.value, inst.kind, local.type, buf);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "binop": {
      const local = ctx.locals.get(inst.target)!;
      emitValue(inst.left, ctx, local.type, buf);
      emitValue(inst.right, ctx, local.type, buf);
      emitBinOp(inst.operator, local.type, buf);
      buf.push(OP.local_set);
      emitLEB128U(buf, local.index);
      break;
    }
    case "unaryop": {
      const local = ctx.locals.get(inst.target)!;
      emitValue(inst.argument, ctx, local.type, buf);
      emitUnaryOp(inst.operator, local.type, buf);
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
    case "call": {
      const calleeName = inst.callee.kind === "ref" ? inst.callee.name : "";
      const funcIdx = ctx.funcNames.indexOf(calleeName);
      if (funcIdx >= 0) {
        for (const arg of inst.args) {
          emitValue(arg, ctx, "f64", buf);
        }
        buf.push(OP.call);
        emitLEB128U(buf, funcIdx);
        if (inst.target) {
          const local = ctx.locals.get(inst.target)!;
          buf.push(OP.local_set);
          emitLEB128U(buf, local.index);
        } else {
          buf.push(OP.drop);
        }
      }
      break;
    }
    case "exprstmt": {
      emitValue(inst.value, ctx, "i32", buf);
      buf.push(OP.drop);
      break;
    }
  }
}

function emitTerm(
  term: IRTerminator,
  ctx: CompileCtx,
  buf: number[],
  returnType: WasmValType | null,
): void {
  switch (term.op) {
    case "return": {
      if (term.value && returnType) {
        emitValue(term.value, ctx, returnType, buf);
      }
      buf.push(OP.return);
      break;
    }
    case "branch": {
      emitValue(term.condition, ctx, "i32", buf);
      buf.push(OP.if, 0x40); // void block type
      buf.push(OP.end);
      break;
    }
    case "jump":
      break;
  }
}

function emitValue(v: IRValue, ctx: CompileCtx, targetType: WasmValType, buf: number[]): void {
  if (v.kind === "lit") {
    emitLitValue(v.value, v.litType, targetType, buf);
    return;
  }

  if (v.kind === "ref" || v.kind === "temp") {
    const name = v.kind === "ref" ? v.name : v.id;
    const local = ctx.locals.get(name);
    if (local) {
      buf.push(OP.local_get);
      emitLEB128U(buf, local.index);
      emitConvert(local.type, targetType, buf);
    } else {
      // Unknown ref — push 0
      if (targetType === "f64") {
        buf.push(OP.f64_const);
        encodeF64(buf, 0.0);
      } else {
        buf.push(OP.i32_const);
        encodeI32(buf, 0);
      }
    }
    return;
  }

  // Fallback
  buf.push(OP.i32_const);
  encodeI32(buf, 0);
}

function emitLitValue(value: any, kind: string, targetType: WasmValType, buf: number[]): void {
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
  const opcode = getBinOpcode(op, type);
  buf.push(opcode);
}

function emitUnaryOp(op: string, type: WasmValType, buf: number[]): void {
  if (op === "-") {
    if (type === "f64") {
      buf.push(OP.f64_neg);
    } else {
      // i32 negate: 0 - value (value is already on stack, need to swap)
      // Simpler: push the value, then do i32.const 0, swap... 
      // Actually the argument is already on the stack, so:
      // Stack: [arg] → need [0, arg] → i32.sub
      // We need to restructure: emit 0 first, then arg, then sub
      // But arg is already emitted. Use a different approach:
      // (i32.sub (i32.const 0) arg) — but arg is on stack already
      // Trick: multiply by -1
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
