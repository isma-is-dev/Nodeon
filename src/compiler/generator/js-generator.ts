import {
  Program,
  Statement,
  FunctionDeclaration,
  VariableDeclaration,
  ExpressionStatement,
  Expression,
  CallExpression,
  BinaryExpression,
  UnaryExpression,
  Identifier,
  Literal,
  TemplateLiteral,
  TemplatePartExpression,
  TemplatePartText,
  IfStatement,
  ForStatement,
  WhileStatement,
  ReturnStatement,
  ImportDeclaration,
  ExportDeclaration,
  ClassDeclaration,
  ClassMethod,
  TryCatchStatement,
  ThrowStatement,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  ArrowFunction,
  AssignmentExpression,
  NewExpression,
  AwaitExpression,
  SpreadExpression,
  TernaryExpression,
  Param,
} from "@ast/nodes";

const BIN_PRECEDENCE: Record<string, number> = {
  "..": 1,
  "||": 2,
  "&&": 3,
  "==": 4, "!=": 4,
  "<": 5, ">": 5, "<=": 5, ">=": 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "%": 7,
};

// ── Public API ─────────────────────────────────────────────────────

export function generateJS(program: Program, minify = false): string {
  const nl = minify ? "" : "\n";
  const sp = minify ? "" : " ";
  const ctx: GenContext = { minify, nl, sp, indentLevel: 0, indentSize: 2, declaredVars: new Set() };
  const lines = program.body.map((stmt) => emitStatement(stmt, ctx));
  return lines.join(nl);
}

type GenContext = {
  minify: boolean;
  nl: string;
  sp: string;
  indentLevel: number;
  indentSize: number;
  declaredVars: Set<string>;
};

function pad(ctx: GenContext): string {
  if (ctx.minify) return "";
  return " ".repeat(ctx.indentLevel * ctx.indentSize);
}

function indented(ctx: GenContext): GenContext {
  return { ...ctx, indentLevel: ctx.indentLevel + 1 };
}

function childScope(ctx: GenContext): GenContext {
  return { ...ctx, declaredVars: new Set(ctx.declaredVars) };
}

// ── Statements ─────────────────────────────────────────────────────

function emitStatement(stmt: Statement, ctx: GenContext): string {
  switch (stmt.type) {
    case "FunctionDeclaration":
      return emitFunction(stmt, ctx);
    case "VariableDeclaration":
      return emitVariable(stmt, ctx);
    case "ExpressionStatement":
      return emitExpression(stmt.expression, ctx) + ";";
    case "IfStatement":
      return emitIf(stmt, ctx);
    case "ForStatement":
      return emitFor(stmt, ctx);
    case "WhileStatement":
      return emitWhile(stmt, ctx);
    case "ReturnStatement":
      return emitReturn(stmt, ctx);
    case "ImportDeclaration":
      return emitImport(stmt, ctx);
    case "ExportDeclaration":
      return emitExport(stmt, ctx);
    case "ClassDeclaration":
      return emitClass(stmt, ctx);
    case "TryCatchStatement":
      return emitTryCatch(stmt, ctx);
    case "ThrowStatement":
      return `throw ${emitExpression(stmt.value, ctx)};`;
    default:
      throw new Error(`Unsupported statement type: ${(stmt as any).type}`);
  }
}

function emitFunction(fn: FunctionDeclaration, ctx: GenContext): string {
  const async = fn.async ? "async " : "";
  const params = fn.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const fnScope = childScope(indented(ctx));
  fn.params.forEach((p) => fnScope.declaredVars.add(p.name));

  // implicit return rule
  let body: string;
  if (fn.body.length === 1 && fn.body[0].type === "ExpressionStatement") {
    body = pad(fnScope) + `return ${emitExpression((fn.body[0] as ExpressionStatement).expression, fnScope)};`;
  } else {
    body = fn.body.map((s) => pad(fnScope) + emitStatement(s, fnScope)).join(ctx.nl);
  }

  return `${async}function ${fn.name.name}(${params})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
}

function emitParam(p: Param, ctx: GenContext): string {
  let out = "";
  if (p.rest) out += "...";
  out += p.name;
  if (p.defaultValue) out += `${ctx.sp}=${ctx.sp}${emitExpression(p.defaultValue, ctx)}`;
  return out;
}

function emitVariable(v: VariableDeclaration, ctx: GenContext): string {
  const name = v.name.name;
  if (v.constant) {
    ctx.declaredVars.add(name);
    return `const ${name}${ctx.sp}=${ctx.sp}${emitExpression(v.value, ctx)};`;
  }
  if (ctx.declaredVars.has(name)) {
    return `${name}${ctx.sp}=${ctx.sp}${emitExpression(v.value, ctx)};`;
  }
  ctx.declaredVars.add(name);
  return `let ${name}${ctx.sp}=${ctx.sp}${emitExpression(v.value, ctx)};`;
}

function emitIf(stmt: IfStatement, ctx: GenContext): string {
  const inner = indented(ctx);
  const cond = emitExpression(stmt.condition, ctx);
  const body = stmt.consequent.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  let out = `if${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;

  if (stmt.alternate) {
    if (stmt.alternate.length === 1 && stmt.alternate[0].type === "IfStatement") {
      out += `${ctx.sp}else ${emitStatement(stmt.alternate[0], ctx)}`;
    } else {
      const alt = stmt.alternate.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      out += `${ctx.sp}else${ctx.sp}{${ctx.nl}${alt}${ctx.nl}${pad(ctx)}}`;
    }
  }
  return out;
}

function emitFor(stmt: ForStatement, ctx: GenContext): string {
  const forScope = childScope(indented(ctx));
  forScope.declaredVars.add(stmt.variable.name);
  const body = stmt.body.map((s) => pad(forScope) + emitStatement(s, forScope)).join(ctx.nl);
  const iter = stmt.iterable;

  // Range: for i in 0..10 → for (let i = 0; i <= 10; i++)
  if (iter.type === "BinaryExpression" && iter.operator === "..") {
    const start = emitExpression(iter.left, ctx);
    const end = emitExpression(iter.right, ctx);
    const v = stmt.variable.name;
    return `for${ctx.sp}(let ${v}${ctx.sp}=${ctx.sp}${start};${ctx.sp}${v}${ctx.sp}<=${ctx.sp}${end};${ctx.sp}${v}++)${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
  }

  // Iterable: for item in collection → for (const item of collection)
  return `for${ctx.sp}(const ${stmt.variable.name} of ${emitExpression(iter, ctx)})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
}

function emitWhile(stmt: WhileStatement, ctx: GenContext): string {
  const whileScope = childScope(indented(ctx));
  const cond = emitExpression(stmt.condition, ctx);
  const body = stmt.body.map((s) => pad(whileScope) + emitStatement(s, whileScope)).join(ctx.nl);
  return `while${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
}

function emitReturn(stmt: ReturnStatement, ctx: GenContext): string {
  if (!stmt.value) return "return;";
  return `return ${emitExpression(stmt.value, ctx)};`;
}

function emitImport(stmt: ImportDeclaration, ctx: GenContext): string {
  if (stmt.namedImports.length > 0) {
    const names = stmt.namedImports.join("," + ctx.sp);
    return `import${ctx.sp}{${ctx.sp}${names}${ctx.sp}}${ctx.sp}from${ctx.sp}${JSON.stringify(stmt.source)};`;
  }
  return `import ${stmt.defaultImport}${ctx.sp}from${ctx.sp}${JSON.stringify(stmt.source)};`;
}

function emitExport(stmt: ExportDeclaration, ctx: GenContext): string {
  return `export ${emitStatement(stmt.declaration, ctx)}`;
}

function emitClass(cls: ClassDeclaration, ctx: GenContext): string {
  const inner = indented(ctx);
  const ext = cls.superClass ? ` extends ${cls.superClass.name}` : "";
  const methods = cls.body.map((m) => pad(inner) + emitMethod(m, inner)).join(ctx.nl + ctx.nl);
  return `class ${cls.name.name}${ext}${ctx.sp}{${ctx.nl}${methods}${ctx.nl}${pad(ctx)}}`;
}

function emitMethod(m: ClassMethod, ctx: GenContext): string {
  const async = m.async ? "async " : "";
  const params = m.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const methScope = childScope(indented(ctx));
  m.params.forEach((p) => methScope.declaredVars.add(p.name));

  // implicit return for single-expression methods (except constructor)
  let body: string;
  if (m.name.name !== "constructor" && m.body.length === 1 && m.body[0].type === "ExpressionStatement") {
    body = pad(methScope) + `return ${emitExpression((m.body[0] as ExpressionStatement).expression, methScope)};`;
  } else {
    body = m.body.map((s) => pad(methScope) + emitStatement(s, methScope)).join(ctx.nl);
  }

  return `${async}${m.name.name}(${params})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
}

function emitTryCatch(stmt: TryCatchStatement, ctx: GenContext): string {
  const inner = indented(ctx);
  const tryBody = stmt.tryBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  const catchBody = stmt.catchBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  const param = stmt.catchParam ? `${ctx.sp}(${stmt.catchParam.name})` : "";
  return `try${ctx.sp}{${ctx.nl}${tryBody}${ctx.nl}${pad(ctx)}}${ctx.sp}catch${param}${ctx.sp}{${ctx.nl}${catchBody}${ctx.nl}${pad(ctx)}}`;
}

// ── Expressions ────────────────────────────────────────────────────

function emitExpression(expr: Expression, ctx: GenContext): string {
  switch (expr.type) {
    case "Identifier":
      return expr.name;
    case "Literal":
      return emitLiteral(expr);
    case "CallExpression":
      return emitCall(expr, ctx);
    case "BinaryExpression":
      return emitBinary(expr, ctx);
    case "UnaryExpression":
      return `${expr.operator}${emitExpression(expr.argument, ctx)}`;
    case "TemplateLiteral":
      return emitTemplate(expr, ctx);
    case "MemberExpression":
      return emitMember(expr, ctx);
    case "ArrayExpression":
      return emitArray(expr, ctx);
    case "ObjectExpression":
      return emitObject(expr, ctx);
    case "ArrowFunction":
      return emitArrow(expr, ctx);
    case "AssignmentExpression":
      return `${emitExpression(expr.left, ctx)}${ctx.sp}=${ctx.sp}${emitExpression(expr.right, ctx)}`;
    case "NewExpression":
      return emitNew(expr, ctx);
    case "AwaitExpression":
      return `await ${emitExpression(expr.argument, ctx)}`;
    case "SpreadExpression":
      return `...${emitExpression(expr.argument, ctx)}`;
    case "TernaryExpression":
      return `${emitExpression(expr.condition, ctx)}${ctx.sp}?${ctx.sp}${emitExpression(expr.consequent, ctx)}${ctx.sp}:${ctx.sp}${emitExpression(expr.alternate, ctx)}`;
    default:
      throw new Error(`Unsupported expression type: ${(expr as any).type}`);
  }
}

function emitLiteral(lit: Literal): string {
  switch (lit.literalType) {
    case "number": return String(lit.value);
    case "string": return JSON.stringify(lit.value);
    case "boolean": return String(lit.value);
    case "null": return "null";
    default: return String(lit.value);
  }
}

function emitCall(call: CallExpression, ctx: GenContext): string {
  let callee: string;
  if (call.callee.type === "Identifier" && call.callee.name === "print") {
    callee = "console.log";
  } else {
    callee = emitExpression(call.callee, ctx);
  }
  const args = call.arguments.map((a) => emitExpression(a, ctx)).join("," + ctx.sp);
  return `${callee}(${args})`;
}

function emitBinary(bin: BinaryExpression, ctx: GenContext): string {
  // Range operator (..) is handled at the ForStatement level, but
  // if it appears in an expression context emit as-is for safety
  const left = parenthesizeIfNeeded(bin.left, bin.operator, ctx);
  const right = parenthesizeIfNeeded(bin.right, bin.operator, ctx);
  return `${left}${ctx.sp}${bin.operator}${ctx.sp}${right}`;
}

function parenthesizeIfNeeded(expr: Expression, parentOp: string, ctx: GenContext): string {
  if (expr.type !== "BinaryExpression") return emitExpression(expr, ctx);
  const parentPrec = BIN_PRECEDENCE[parentOp] ?? 0;
  const childPrec = BIN_PRECEDENCE[expr.operator] ?? 0;
  const inner = emitBinary(expr, ctx);
  return childPrec < parentPrec ? `(${inner})` : inner;
}

function emitTemplate(t: TemplateLiteral, ctx: GenContext): string {
  const body = t.parts
    .map((p) => {
      if (p.kind === "Text") return p.value.replace(/`/g, "\\`").replace(/\$/g, "\\$");
      return "${" + emitExpression((p as TemplatePartExpression).expression, ctx) + "}";
    })
    .join("");
  return "`" + body + "`";
}

function emitMember(m: MemberExpression, ctx: GenContext): string {
  const obj = emitExpression(m.object, ctx);
  if (m.computed) return `${obj}[${emitExpression(m.property, ctx)}]`;
  return `${obj}.${emitExpression(m.property, ctx)}`;
}

function emitArray(arr: ArrayExpression, ctx: GenContext): string {
  const els = arr.elements.map((e) => emitExpression(e, ctx)).join("," + ctx.sp);
  return `[${els}]`;
}

function emitObject(obj: ObjectExpression, ctx: GenContext): string {
  if (obj.properties.length === 0) return "{}";
  const props = obj.properties.map((p) => {
    if (p.shorthand) return (p.key as Identifier).name;
    const key = p.key.type === "Identifier" ? p.key.name : JSON.stringify(p.key.value);
    return `${key}:${ctx.sp}${emitExpression(p.value, ctx)}`;
  }).join("," + ctx.sp);
  return `{${ctx.sp}${props}${ctx.sp}}`;
}

function emitArrow(fn: ArrowFunction, ctx: GenContext): string {
  const async = fn.async ? "async " : "";
  const params = fn.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const paramStr = fn.params.length === 1 && !fn.params[0].rest && !fn.params[0].defaultValue
    ? fn.params[0].name
    : `(${params})`;

  if (Array.isArray(fn.body)) {
    const inner = indented(ctx);
    const body = (fn.body as Statement[]).map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    return `${async}${paramStr}${ctx.sp}=>${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
  }

  return `${async}${paramStr}${ctx.sp}=>${ctx.sp}${emitExpression(fn.body as Expression, ctx)}`;
}

function emitNew(n: NewExpression, ctx: GenContext): string {
  const callee = emitExpression(n.callee, ctx);
  const args = n.arguments.map((a) => emitExpression(a, ctx)).join("," + ctx.sp);
  return `new ${callee}(${args})`;
}
