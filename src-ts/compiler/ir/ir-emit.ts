// ── IR → JS Emission ────────────────────────────────────────────────
// Converts IR instructions back into JavaScript source code.

import {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
} from "./ir-nodes";

export function emitIR(mod: IRModule, minify = false): string {
  const sp = minify ? "" : " ";
  const nl = minify ? "" : "\n";
  const indent = minify ? "" : "  ";
  const lines: string[] = [];

  // Emit globals
  for (const inst of mod.globals) {
    lines.push(emitInstruction(inst, sp, ""));
  }

  // Emit functions
  for (const fn of mod.functions) {
    lines.push(emitFunction(fn, sp, nl, indent));
  }

  return lines.join(nl);
}

function emitFunction(fn: IRFunction, sp: string, nl: string, indent: string): string {
  const asyncPrefix = fn.async ? "async " : "";
  const star = fn.generator ? "*" : "";
  const params = fn.params.join("," + sp);
  const lines: string[] = [];

  for (const block of fn.blocks) {
    // Skip label for entry block
    if (block.label !== "entry") {
      lines.push(`${indent}// ${block.label}:`);
    }
    for (const inst of block.instructions) {
      lines.push(indent + emitInstruction(inst, sp, indent));
    }
    if (block.terminator) {
      lines.push(indent + emitTerminator(block.terminator, sp));
    }
  }

  const body = lines.join(nl);
  return `${asyncPrefix}function${star}${sp}${fn.name}(${params})${sp}{${nl}${body}${nl}}`;
}

function emitInstruction(inst: IRInstruction, sp: string, indent: string): string {
  switch (inst.op) {
    case "literal": {
      const val = serializeLiteral(inst.value, inst.kind);
      return `const ${inst.target}${sp}=${sp}${val};`;
    }
    case "declare": {
      if (inst.value) {
        return `${inst.kind} ${inst.name}${sp}=${sp}${emitValue(inst.value)};`;
      }
      return `${inst.kind} ${inst.name};`;
    }
    case "assign":
      return `${inst.target}${sp}=${sp}${emitValue(inst.value)};`;
    case "binop":
      return `const ${inst.target}${sp}=${sp}${emitValue(inst.left)}${sp}${inst.operator}${sp}${emitValue(inst.right)};`;
    case "unaryop":
      return `const ${inst.target}${sp}=${sp}${inst.operator}${emitValue(inst.argument)};`;
    case "call": {
      const args = inst.args.map(emitValue).join("," + sp);
      const callExpr = `${emitValue(inst.callee)}(${args})`;
      if (inst.target) {
        return `const ${inst.target}${sp}=${sp}${callExpr};`;
      }
      return `${callExpr};`;
    }
    case "loadfield": {
      if (inst.computed) {
        return `const ${inst.target}${sp}=${sp}${emitValue(inst.object)}[${inst.field}];`;
      }
      return `const ${inst.target}${sp}=${sp}${emitValue(inst.object)}.${inst.field};`;
    }
    case "storefield":
      return `${emitValue(inst.object)}.${inst.field}${sp}=${sp}${emitValue(inst.value)};`;
    case "exprstmt":
      return `${emitValue(inst.value)};`;
    default:
      return `/* unknown IR op: ${(inst as any).op} */`;
  }
}

function emitTerminator(term: IRTerminator, sp: string): string {
  switch (term.op) {
    case "return":
      if (term.value) return `return ${emitValue(term.value)};`;
      return "return;";
    case "branch":
      return `if${sp}(${emitValue(term.condition)})${sp}{${sp}/* goto ${term.thenLabel} */${sp}}${sp}else${sp}{${sp}/* goto ${term.elseLabel} */${sp}}`;
    case "jump":
      return `/* goto ${term.target} */`;
  }
}

function emitValue(v: IRValue): string {
  switch (v.kind) {
    case "ref": return v.name;
    case "lit": return serializeLiteral(v.value, v.litType);
    case "temp": return v.id;
  }
}

function serializeLiteral(value: any, kind: string): string {
  switch (kind) {
    case "number": return String(value);
    case "string": return JSON.stringify(value);
    case "boolean": return String(value);
    case "null": return "null";
    case "undefined": return "undefined";
    default: return JSON.stringify(value);
  }
}
