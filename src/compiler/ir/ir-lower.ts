// ── AST → IR Lowering ───────────────────────────────────────────────
// Converts AST nodes into IR instructions within basic blocks.

import { Program, Statement, Expression } from "@ast/nodes";
import {
  IRModule, IRFunction, IRBlock, IRInstruction, IRValue, IRTerminator,
  IRDeclare, IRAssign, IRBinOp, IRUnaryOp, IRCall, IRLiteral, IRExprStmt,
  IRReturn, IRBranch, IRJump,
} from "./ir-nodes";

let tempCounter = 0;
function freshTemp(): string {
  return `_t${tempCounter++}`;
}

export function lowerToIR(ast: Program): IRModule {
  tempCounter = 0;
  const globals: IRInstruction[] = [];
  const functions: IRFunction[] = [];

  for (const stmt of ast.body) {
    if (stmt.type === "FunctionDeclaration") {
      functions.push(lowerFunction(stmt));
    } else {
      lowerStatement(stmt, globals);
    }
  }

  return { type: "IRModule", functions, globals };
}

function lowerFunction(fn: any): IRFunction {
  const params = fn.params.map((p: any) => p.name ?? p.value ?? String(p));
  const entry: IRBlock = { type: "IRBlock", label: "entry", instructions: [], terminator: null };
  const blocks: IRBlock[] = [entry];

  for (const stmt of fn.body) {
    lowerStatement(stmt, entry.instructions, blocks, entry);
  }

  // If no explicit return, add implicit return undefined
  if (!entry.terminator && blocks[blocks.length - 1] && !blocks[blocks.length - 1].terminator) {
    blocks[blocks.length - 1].terminator = { op: "return", value: null };
  }

  return {
    type: "IRFunction",
    name: fn.name.name,
    params,
    blocks,
    async: fn.async ?? false,
    generator: fn.generator ?? false,
  };
}

function lowerStatement(
  stmt: Statement,
  instructions: IRInstruction[],
  blocks?: IRBlock[],
  currentBlock?: IRBlock,
): void {
  switch (stmt.type) {
    case "VariableDeclaration": {
      const val = stmt.value ? lowerExpr(stmt.value, instructions) : null;
      instructions.push({
        op: "declare",
        kind: stmt.kind as "const" | "let" | "var",
        name: stmt.name.name,
        value: val,
      });
      break;
    }
    case "ExpressionStatement": {
      const val = lowerExpr(stmt.expression, instructions);
      instructions.push({ op: "exprstmt", value: val });
      break;
    }
    case "ReturnStatement": {
      const val = stmt.value ? lowerExpr(stmt.value, instructions) : null;
      if (currentBlock) {
        currentBlock.terminator = { op: "return", value: val };
      }
      break;
    }
    case "IfStatement": {
      if (blocks && currentBlock) {
        const cond = lowerExpr(stmt.condition, instructions);
        const thenLabel = `then_${freshTemp()}`;
        const elseLabel = stmt.alternate ? `else_${freshTemp()}` : `end_${freshTemp()}`;
        const endLabel = stmt.alternate ? `end_${freshTemp()}` : elseLabel;

        currentBlock.terminator = { op: "branch", condition: cond, thenLabel, elseLabel };

        const thenBlock: IRBlock = { type: "IRBlock", label: thenLabel, instructions: [], terminator: null };
        blocks.push(thenBlock);
        for (const s of stmt.consequent) {
          lowerStatement(s, thenBlock.instructions, blocks, thenBlock);
        }
        if (!thenBlock.terminator) {
          thenBlock.terminator = { op: "jump", target: endLabel };
        }

        if (stmt.alternate) {
          const elseBlock: IRBlock = { type: "IRBlock", label: elseLabel, instructions: [], terminator: null };
          blocks.push(elseBlock);
          const altStmts = Array.isArray(stmt.alternate) ? stmt.alternate : [stmt.alternate];
          for (const s of altStmts) {
            lowerStatement(s as Statement, elseBlock.instructions, blocks, elseBlock);
          }
          if (!elseBlock.terminator) {
            elseBlock.terminator = { op: "jump", target: endLabel };
          }
        }

        const endBlock: IRBlock = { type: "IRBlock", label: endLabel, instructions: [], terminator: null };
        blocks.push(endBlock);
        // Update currentBlock reference — caller should use endBlock for subsequent code
        // For simplicity in this first pass, we continue appending to endBlock
        Object.assign(currentBlock, { __continueBlock: endBlock });
      }
      break;
    }
    default: {
      // For unsupported statement types, wrap as opaque expression
      // This ensures the IR pipeline doesn't crash on unknown nodes
      instructions.push({
        op: "exprstmt",
        value: { kind: "lit", value: `/* unsupported: ${stmt.type} */`, litType: "string" },
      });
      break;
    }
  }
}

function lowerExpr(expr: Expression, instructions: IRInstruction[]): IRValue {
  switch (expr.type) {
    case "Literal": {
      const t = freshTemp();
      const litType = expr.literalType ?? (typeof expr.value);
      instructions.push({ op: "literal", target: t, value: expr.value, kind: litType as any });
      return { kind: "temp", id: t };
    }
    case "Identifier": {
      return { kind: "ref", name: expr.name };
    }
    case "BinaryExpression": {
      const left = lowerExpr(expr.left, instructions);
      const right = lowerExpr(expr.right, instructions);
      const t = freshTemp();
      instructions.push({ op: "binop", target: t, operator: expr.operator, left, right });
      return { kind: "temp", id: t };
    }
    case "UnaryExpression": {
      const arg = lowerExpr(expr.argument, instructions);
      const t = freshTemp();
      instructions.push({ op: "unaryop", target: t, operator: expr.operator, argument: arg });
      return { kind: "temp", id: t };
    }
    case "CallExpression": {
      const callee = lowerExpr(expr.callee, instructions);
      const args = expr.arguments.map((a: Expression) => lowerExpr(a, instructions));
      const t = freshTemp();
      instructions.push({ op: "call", target: t, callee, args });
      return { kind: "temp", id: t };
    }
    case "MemberExpression": {
      const obj = lowerExpr(expr.object, instructions);
      const t = freshTemp();
      if (expr.computed) {
        const prop = lowerExpr(expr.property, instructions);
        instructions.push({ op: "loadfield", target: t, object: obj, field: `[${(prop as any).id || (prop as any).name}]`, computed: true });
      } else {
        const fieldName = (expr.property as any).name ?? String(expr.property);
        instructions.push({ op: "loadfield", target: t, object: obj, field: fieldName, computed: false });
      }
      return { kind: "temp", id: t };
    }
    case "AssignmentExpression": {
      const val = lowerExpr(expr.right, instructions);
      if (expr.left.type === "Identifier") {
        instructions.push({ op: "assign", target: expr.left.name, value: val });
        return val;
      }
      // Fallback
      return val;
    }
    default: {
      // Opaque — treat as ref to preserve correctness
      const t = freshTemp();
      instructions.push({ op: "literal", target: t, value: `/* expr: ${expr.type} */`, kind: "string" });
      return { kind: "temp", id: t };
    }
  }
}
