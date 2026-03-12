import {
  Program,
  Statement,
  FunctionDeclaration,
  VariableDeclaration,
  ExpressionStatement,
  Expression,
  CallExpression,
  BinaryExpression,
  Identifier,
  Literal,
  TemplateLiteral,
  TemplatePartExpression,
  TemplatePartText,
} from "@ast/nodes";

const BIN_PRECEDENCE: Record<string, number> = {
  "*": 2,
  "/": 2,
  "+": 1,
  "-": 1,
};

export function generateJS(program: Program): string {
  const lines = program.body.map((stmt) => emitStatement(stmt));
  return lines.join("\n");
}

function emitStatement(stmt: Statement): string {
  switch (stmt.type) {
    case "FunctionDeclaration":
      return emitFunction(stmt);
    case "VariableDeclaration":
      return emitVariable(stmt);
    case "ExpressionStatement":
      return emitExpression(stmt.expression) + ";";
    default:
      throw new Error(`Unsupported statement type: ${(stmt as any).type}`);
  }
}

function emitFunction(fn: FunctionDeclaration): string {
  const params = fn.params.map((p) => p.name).join(", ");
  const bodyLines = fn.body.map((s) => emitStatement(s));

  // regla de return implícito si solo hay una expresión
  let body: string;
  if (fn.body.length === 1 && fn.body[0].type === "ExpressionStatement") {
    body = `return ${emitExpression((fn.body[0] as ExpressionStatement).expression)};`;
  } else {
    body = bodyLines.join("\n");
  }

  return `function ${fn.name.name}(${params}) {\n${indent(body)}\n}`;
}

function emitVariable(v: VariableDeclaration): string {
  return `let ${v.name.name} = ${emitExpression(v.value)};`;
}

function emitExpression(expr: Expression): string {
  switch (expr.type) {
    case "Identifier":
      return expr.name;
    case "Literal":
      return expr.literalType === "number" ? String(expr.value) : JSON.stringify(expr.value);
    case "CallExpression":
      return emitCall(expr);
    case "BinaryExpression":
      return emitBinary(expr);
    case "TemplateLiteral":
      return emitTemplate(expr);
    default:
      throw new Error(`Unsupported expression type: ${(expr as any).type}`);
  }
}

function emitCall(call: CallExpression): string {
  const callee = call.callee.name === "print" ? "console.log" : call.callee.name;
  const args = call.arguments.map((a) => emitExpression(a)).join(", ");
  return `${callee}(${args})`;
}

function emitBinary(bin: BinaryExpression): string {
  const prec = BIN_PRECEDENCE[bin.operator] ?? 0;
  const left = parenthesizeIfNeeded(bin.left, prec);
  const right = parenthesizeIfNeeded(bin.right, prec - 0.1);
  return `${left} ${bin.operator} ${right}`;
}

function parenthesizeIfNeeded(expr: Expression, parentPrec: number): string {
  if (expr.type !== "BinaryExpression") return emitExpression(expr);
  const prec = BIN_PRECEDENCE[expr.operator] ?? 0;
  const inner = emitBinary(expr);
  return prec < parentPrec ? `(${inner})` : inner;
}

function emitTemplate(t: TemplateLiteral): string {
  const parts = t.parts
    .map((p) =>
      p.kind === "Text"
        ? escapeBackticks(p)
        : `${emitIdentifier((p as TemplatePartExpression).expression)}`
    )
    .join("");
  // replace placeholders expr with ${expr}
  const final = parts.replace(/\u001b([^\u001b]+)\u001b/g, "${$1}");
  return "`" + final + "`";
}

function emitIdentifier(id: Identifier): string {
  return id.name;
}

function escapeBackticks(p: TemplatePartText): string {
  return p.value.replace(/`/g, "\\`");
}

function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim().length ? pad + line : line))
    .join("\n");
}
