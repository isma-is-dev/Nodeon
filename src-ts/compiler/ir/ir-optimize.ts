// ── IR Optimization Passes ──────────────────────────────────────────
// Transforms applied to IR before emission.

import { IRModule, IRFunction, IRBlock, IRInstruction, IRValue } from "./ir-nodes";

export function optimizeIR(mod: IRModule): IRModule {
  return {
    type: "IRModule",
    functions: mod.functions.map(optimizeFunction),
    globals: constantFold(mod.globals),
  };
}

function optimizeFunction(fn: IRFunction): IRFunction {
  return {
    ...fn,
    blocks: fn.blocks.map((b) => ({
      ...b,
      instructions: constantFold(b.instructions),
    })),
  };
}

// ── Pass 1: Constant Folding ────────────────────────────────────────
// Evaluates binary operations on known literals at compile time.

function constantFold(instructions: IRInstruction[]): IRInstruction[] {
  const known = new Map<string, any>(); // temp → resolved literal value
  const result: IRInstruction[] = [];

  for (const inst of instructions) {
    if (inst.op === "literal") {
      known.set(inst.target, inst.value);
      result.push(inst);
      continue;
    }

    if (inst.op === "binop") {
      const leftVal = resolveValue(inst.left, known);
      const rightVal = resolveValue(inst.right, known);

      if (leftVal !== undefined && rightVal !== undefined) {
        const folded = evalBinOp(inst.operator, leftVal, rightVal);
        if (folded !== undefined) {
          const kind = typeof folded as "number" | "string" | "boolean";
          known.set(inst.target, folded);
          result.push({ op: "literal", target: inst.target, value: folded, kind });
          continue;
        }
      }
    }

    if (inst.op === "unaryop") {
      const argVal = resolveValue(inst.argument, known);
      if (argVal !== undefined) {
        const folded = evalUnaryOp(inst.operator, argVal);
        if (folded !== undefined) {
          const kind = typeof folded as "number" | "string" | "boolean";
          known.set(inst.target, folded);
          result.push({ op: "literal", target: inst.target, value: folded, kind });
          continue;
        }
      }
    }

    result.push(inst);
  }

  return result;
}

function resolveValue(v: IRValue, known: Map<string, any>): any {
  if (v.kind === "lit") return v.value;
  if (v.kind === "temp" && known.has(v.id)) return known.get(v.id);
  return undefined;
}

function evalBinOp(op: string, left: any, right: any): any {
  switch (op) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return right !== 0 ? left / right : undefined;
    case "%": return right !== 0 ? left % right : undefined;
    case "**": return left ** right;
    case "===": return left === right;
    case "!==": return left !== right;
    case "==": return left === right; // Nodeon == compiles to ===
    case "!=": return left !== right;
    case "<": return left < right;
    case ">": return left > right;
    case "<=": return left <= right;
    case ">=": return left >= right;
    case "&&": return left && right;
    case "||": return left || right;
    case "??": return left ?? right;
    case "&": return left & right;
    case "|": return left | right;
    case "^": return left ^ right;
    case "<<": return left << right;
    case ">>": return left >> right;
    case ">>>": return left >>> right;
    default: return undefined;
  }
}

function evalUnaryOp(op: string, arg: any): any {
  switch (op) {
    case "-": return -arg;
    case "+": return +arg;
    case "!": return !arg;
    case "~": return ~arg;
    case "typeof": return typeof arg;
    default: return undefined;
  }
}

// ── Pass 2: Dead Code Elimination ───────────────────────────────────
// Removes temporaries that are assigned but never referenced.

export function eliminateDeadCode(mod: IRModule): IRModule {
  return {
    type: "IRModule",
    functions: mod.functions.map(elimDeadInFunction),
    globals: elimDeadInstructions(mod.globals),
  };
}

function elimDeadInFunction(fn: IRFunction): IRFunction {
  // Collect refs from ALL terminators first so temps used in return/branch survive
  const terminatorRefs = new Set<string>();
  for (const b of fn.blocks) {
    if (b.terminator) collectTerminatorRefs(b.terminator, terminatorRefs);
  }
  return {
    ...fn,
    blocks: fn.blocks.map((b) => ({
      ...b,
      instructions: elimDeadInstructions(b.instructions, terminatorRefs),
    })),
  };
}

function elimDeadInstructions(instructions: IRInstruction[], extraRefs?: Set<string>): IRInstruction[] {
  // Collect all referenced names/temps
  const referenced = new Set<string>();
  if (extraRefs) for (const r of extraRefs) referenced.add(r);
  for (const inst of instructions) {
    collectRefs(inst, referenced);
  }

  // Keep instructions that either:
  // 1. Have side effects (call, exprstmt, declare, assign, storefield)
  // 2. Define a referenced temp
  return instructions.filter((inst) => {
    if (inst.op === "call" || inst.op === "exprstmt" || inst.op === "declare" ||
        inst.op === "assign" || inst.op === "storefield") {
      return true;
    }
    if ("target" in inst && typeof inst.target === "string") {
      return referenced.has(inst.target);
    }
    return true;
  });
}

function collectTerminatorRefs(term: IRTerminator, refs: Set<string>): void {
  const collectValue = (v: IRValue) => {
    if (v.kind === "ref") refs.add(v.name);
    if (v.kind === "temp") refs.add(v.id);
  };
  switch (term.op) {
    case "return":
      if (term.value) collectValue(term.value);
      break;
    case "branch":
      collectValue(term.condition);
      break;
  }
}

function collectRefs(inst: IRInstruction, refs: Set<string>): void {
  const collectValue = (v: IRValue) => {
    if (v.kind === "ref") refs.add(v.name);
    if (v.kind === "temp") refs.add(v.id);
  };

  switch (inst.op) {
    case "assign":
      collectValue(inst.value);
      break;
    case "binop":
      collectValue(inst.left);
      collectValue(inst.right);
      break;
    case "unaryop":
      collectValue(inst.argument);
      break;
    case "call":
      collectValue(inst.callee);
      inst.args.forEach(collectValue);
      break;
    case "loadfield":
      collectValue(inst.object);
      break;
    case "storefield":
      collectValue(inst.object);
      collectValue(inst.value);
      break;
    case "declare":
      if (inst.value) collectValue(inst.value);
      break;
    case "exprstmt":
      collectValue(inst.value);
      break;
  }
}
