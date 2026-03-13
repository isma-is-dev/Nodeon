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
  UpdateExpression,
  Identifier,
  Literal,
  TemplateLiteral,
  TemplatePartExpression,
  TemplatePartText,
  IfStatement,
  ForStatement,
  WhileStatement,
  DoWhileStatement,
  ReturnStatement,
  ImportDeclaration,
  ExportDeclaration,
  ClassDeclaration,
  ClassMethod,
  ClassField,
  ClassMember,
  RegExpLiteral,
  TryCatchStatement,
  ThrowStatement,
  SwitchStatement,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  ArrowFunction,
  AssignmentExpression,
  CompoundAssignmentExpression,
  NewExpression,
  AwaitExpression,
  SpreadExpression,
  TernaryExpression,
  TypeofExpression,
  VoidExpression,
  DeleteExpression,
  YieldExpression,
  Param,
  DestructuringDeclaration,
  ObjectPattern,
  ObjectPatternProperty,
  ArrayPattern,
  MatchStatement,
  MatchCase,
  EnumDeclaration,
  EnumMember,
  InterfaceDeclaration,
} from "@ast/nodes";
import { PRECEDENCE as BIN_PRECEDENCE } from "@language/precedence";
import { SourceMapBuilder } from "./source-map";

// ── Public API ─────────────────────────────────────────────────────

export function generateJS(program: Program, minify = false): string {
  const nl = minify ? "" : "\n";
  const sp = minify ? "" : " ";
  const ctx: GenContext = { minify, nl, sp, indentLevel: 0, indentSize: 2, declaredVars: new Set() };
  const lines = program.body.map((stmt) => emitStatement(stmt, ctx));
  return lines.join(nl);
}

export interface GenerateResult {
  js: string;
  sourceMap: import("./source-map").SourceMap;
}

export function generateJSWithSourceMap(
  program: Program,
  sourceFile: string,
  sourceContent: string,
  outputFile: string,
  minify = false,
): GenerateResult {
  const builder = new SourceMapBuilder();
  const sourceIndex = builder.addSource(sourceFile, sourceContent);

  const nl = minify ? "" : "\n";
  const sp = minify ? "" : " ";
  const ctx: GenContext = { minify, nl, sp, indentLevel: 0, indentSize: 2, declaredVars: new Set() };

  const outputLines: string[] = [];
  for (const stmt of program.body) {
    const code = emitStatement(stmt, ctx);
    const genLine = outputLines.length + 1;

    // Record source mapping if the statement has loc info
    if (stmt.loc) {
      builder.addLineMapping(stmt.loc.line, genLine, sourceIndex);
    }

    outputLines.push(code);

    // For multi-line output (functions, classes, etc.), map inner lines too
    const codeLines = code.split("\n");
    if (codeLines.length > 1 && stmt.loc) {
      for (let i = 1; i < codeLines.length; i++) {
        builder.addLineMapping(stmt.loc.line, genLine + i, sourceIndex);
      }
      // Adjust outputLines: replace the single entry with first line, push rest
      outputLines.pop();
      outputLines.push(...codeLines);
    }
  }

  const js = outputLines.join(nl) + nl + `//# sourceMappingURL=${outputFile}.map`;
  const sourceMap = builder.toJSON(outputFile);

  return { js, sourceMap };
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
    case "DoWhileStatement":
      return emitDoWhile(stmt, ctx);
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
    case "SwitchStatement":
      return emitSwitch(stmt, ctx);
    case "BreakStatement":
      return "break;";
    case "ContinueStatement":
      return "continue;";
    case "DestructuringDeclaration":
      return emitDestructuring(stmt, ctx);
    case "MatchStatement":
      return emitMatch(stmt, ctx);
    case "EnumDeclaration":
      return emitEnum(stmt, ctx);
    case "InterfaceDeclaration":
      return ""; // Type-only declaration, stripped from JS output
    case "DebuggerStatement":
      return "debugger;";
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
  if (p.pattern) {
    out += emitPattern(p.pattern, ctx);
  } else {
    out += p.name;
  }
  if (p.defaultValue) out += `${ctx.sp}=${ctx.sp}${emitExpression(p.defaultValue, ctx)}`;
  return out;
}

function emitVariable(v: VariableDeclaration, ctx: GenContext): string {
  const name = v.name.name;
  const keyword = v.kind;
  if (keyword === "let" && ctx.declaredVars.has(name)) {
    // Re-assignment in Nodeon: bare `x = expr` compiles to just `x = expr`
    return `${name}${ctx.sp}=${ctx.sp}${emitExpression(v.value, ctx)};`;
  }
  ctx.declaredVars.add(name);
  return `${keyword} ${name}${ctx.sp}=${ctx.sp}${emitExpression(v.value, ctx)};`;
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
  const iter = stmt.iterable;
  const varStr = stmt.variable.type === "Identifier"
    ? stmt.variable.name
    : emitPattern(stmt.variable, ctx);

  if (stmt.variable.type === "Identifier") {
    forScope.declaredVars.add(stmt.variable.name);
  }
  const body = stmt.body.map((s) => pad(forScope) + emitStatement(s, forScope)).join(ctx.nl);

  // Range: for i in 0..10 → for (let i = 0; i <= 10; i++)
  if (iter.type === "BinaryExpression" && iter.operator === ".." && stmt.variable.type === "Identifier") {
    const start = emitExpression(iter.left, ctx);
    const end = emitExpression(iter.right, ctx);
    const v = stmt.variable.name;
    return `for${ctx.sp}(let ${v}${ctx.sp}=${ctx.sp}${start};${ctx.sp}${v}${ctx.sp}<=${ctx.sp}${end};${ctx.sp}${v}++)${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
  }

  // Iterable: for item in collection → for (const item of collection)
  return `for${ctx.sp}(const ${varStr} of ${emitExpression(iter, ctx)})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
}

function emitWhile(stmt: WhileStatement, ctx: GenContext): string {
  const whileScope = childScope(indented(ctx));
  const cond = emitExpression(stmt.condition, ctx);
  const body = stmt.body.map((s) => pad(whileScope) + emitStatement(s, whileScope)).join(ctx.nl);
  return `while${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
}

function emitDoWhile(stmt: DoWhileStatement, ctx: GenContext): string {
  const inner = childScope(indented(ctx));
  const body = stmt.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  const cond = emitExpression(stmt.condition, ctx);
  return `do${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}${ctx.sp}while${ctx.sp}(${cond});`;
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
  if (stmt.defaultImport && stmt.defaultImport.startsWith("*")) {
    return `import ${stmt.defaultImport}${ctx.sp}from${ctx.sp}${JSON.stringify(stmt.source)};`;
  }
  return `import ${stmt.defaultImport}${ctx.sp}from${ctx.sp}${JSON.stringify(stmt.source)};`;
}

function emitExport(stmt: ExportDeclaration, ctx: GenContext): string {
  const kw = stmt.isDefault ? "export default" : "export";
  return `${kw} ${emitStatement(stmt.declaration, ctx)}`;
}

function emitClass(cls: ClassDeclaration, ctx: GenContext): string {
  const inner = indented(ctx);
  const ext = cls.superClass ? ` extends ${cls.superClass.name}` : "";
  const members = cls.body.map((m) => {
    if (m.type === "ClassField") return pad(inner) + emitClassField(m, inner);
    return pad(inner) + emitMethod(m, inner);
  }).join(ctx.nl + ctx.nl);
  return `class ${cls.name.name}${ext}${ctx.sp}{${ctx.nl}${members}${ctx.nl}${pad(ctx)}}`;
}

function emitClassField(f: ClassField, ctx: GenContext): string {
  const staticPrefix = f.static ? "static " : "";
  const name = f.computed ? `[${emitExpression(f.name as Expression, ctx)}]` : (f.name as Identifier).name;
  if (f.value) {
    return `${staticPrefix}${name}${ctx.sp}=${ctx.sp}${emitExpression(f.value, ctx)};`;
  }
  return `${staticPrefix}${name};`;
}

function emitMethod(m: ClassMethod, ctx: GenContext): string {
  const parts: string[] = [];
  if (m.static) parts.push("static");
  if (m.async) parts.push("async");
  if (m.kind === "get") parts.push("get");
  if (m.kind === "set") parts.push("set");

  const name = m.computed ? `[${emitExpression(m.name as Expression, ctx)}]` : (m.name as Identifier).name;
  const prefix = parts.length > 0 ? parts.join(" ") + " " : "";
  const params = m.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const methScope = childScope(indented(ctx));
  m.params.forEach((p) => methScope.declaredVars.add(p.name));

  // implicit return for single-expression methods (except constructor)
  let body: string;
  const isConstructor = m.kind === "constructor";
  if (!isConstructor && m.body.length === 1 && m.body[0].type === "ExpressionStatement") {
    body = pad(methScope) + `return ${emitExpression((m.body[0] as ExpressionStatement).expression, methScope)};`;
  } else {
    body = m.body.map((s) => pad(methScope) + emitStatement(s, methScope)).join(ctx.nl);
  }

  return `${prefix}${name}(${params})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
}

function emitTryCatch(stmt: TryCatchStatement, ctx: GenContext): string {
  const inner = indented(ctx);
  const tryBody = stmt.tryBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
  let out = `try${ctx.sp}{${ctx.nl}${tryBody}${ctx.nl}${pad(ctx)}}`;

  if (stmt.catchBlock.length > 0 || stmt.catchParam) {
    const catchBody = stmt.catchBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    const param = stmt.catchParam ? `${ctx.sp}(${stmt.catchParam.name})` : "";
    out += `${ctx.sp}catch${param}${ctx.sp}{${ctx.nl}${catchBody}${ctx.nl}${pad(ctx)}}`;
  }

  if (stmt.finallyBlock) {
    const finallyBody = stmt.finallyBlock.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    out += `${ctx.sp}finally${ctx.sp}{${ctx.nl}${finallyBody}${ctx.nl}${pad(ctx)}}`;
  }

  return out;
}

function emitSwitch(stmt: SwitchStatement, ctx: GenContext): string {
  const inner = indented(ctx);
  const caseInner = indented(inner);
  const disc = emitExpression(stmt.discriminant, ctx);
  const cases = stmt.cases.map((c) => {
    const header = c.test
      ? `${pad(inner)}case ${emitExpression(c.test, inner)}:`
      : `${pad(inner)}default:`;
    const body = c.consequent.map((s) => pad(caseInner) + emitStatement(s, caseInner)).join(ctx.nl);
    return `${header}${ctx.nl}${body}`;
  }).join(ctx.nl);
  return `switch${ctx.sp}(${disc})${ctx.sp}{${ctx.nl}${cases}${ctx.nl}${pad(ctx)}}`;
}

function emitMatch(stmt: MatchStatement, ctx: GenContext): string {
  const inner = indented(ctx);
  const disc = emitExpression(stmt.discriminant, ctx);
  const parts: string[] = [];

  for (let i = 0; i < stmt.cases.length; i++) {
    const c = stmt.cases[i];
    const body = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);

    if (c.pattern === null) {
      // default case → else block
      parts.push(`${ctx.sp}else${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`);
    } else {
      let cond = `${disc}${ctx.sp}===${ctx.sp}${emitExpression(c.pattern, ctx)}`;
      if (c.guard) {
        cond += `${ctx.sp}&&${ctx.sp}${emitExpression(c.guard, ctx)}`;
      }
      const keyword = i === 0 ? "if" : `${ctx.sp}else if`;
      parts.push(`${keyword}${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`);
    }
  }

  return parts.join("");
}

function emitEnum(stmt: EnumDeclaration, ctx: GenContext): string {
  const inner = indented(ctx);
  const entries: string[] = [];
  let autoValue = 0;

  for (const member of stmt.members) {
    if (member.value !== null) {
      const val = emitExpression(member.value, ctx);
      entries.push(`${pad(inner)}${member.name.name}:${ctx.sp}${val}`);
      // If the value is a numeric literal, update autoValue for next member
      if (member.value.type === "Literal" && typeof member.value.value === "number") {
        autoValue = (member.value.value as number) + 1;
      } else {
        autoValue++;
      }
    } else {
      entries.push(`${pad(inner)}${member.name.name}:${ctx.sp}${autoValue}`);
      autoValue++;
    }
  }

  const body = entries.join(`,${ctx.nl}`);
  return `const ${stmt.name.name}${ctx.sp}=${ctx.sp}Object.freeze({${ctx.nl}${body}${ctx.nl}${pad(ctx)}});`;
}

function emitDestructuring(stmt: DestructuringDeclaration, ctx: GenContext): string {
  const pat = emitPattern(stmt.pattern, ctx);
  return `${stmt.kind} ${pat}${ctx.sp}=${ctx.sp}${emitExpression(stmt.value, ctx)};`;
}

function emitPattern(pattern: ObjectPattern | ArrayPattern, ctx: GenContext): string {
  if (pattern.type === "ObjectPattern") return emitObjectPattern(pattern, ctx);
  return emitArrayPattern(pattern, ctx);
}

function emitObjectPattern(pat: ObjectPattern, ctx: GenContext): string {
  const props = pat.properties.map((p) => {
    let out = "";
    if (p.shorthand) {
      out = p.key.name;
    } else {
      const val = p.value.type === "Identifier" ? p.value.name : emitPattern(p.value as ObjectPattern | ArrayPattern, ctx);
      out = `${p.key.name}:${ctx.sp}${val}`;
    }
    if (p.defaultValue) {
      out += `${ctx.sp}=${ctx.sp}${emitExpression(p.defaultValue, ctx)}`;
    }
    return out;
  });
  if (pat.rest) props.push(`...${pat.rest.name}`);
  return `{${ctx.sp}${props.join("," + ctx.sp)}${ctx.sp}}`;
}

function emitArrayPattern(pat: ArrayPattern, ctx: GenContext): string {
  const els = pat.elements.map((e) => {
    if (e === null) return "";
    if (e.type === "Identifier") return e.name;
    return emitPattern(e as ObjectPattern | ArrayPattern, ctx);
  });
  if (pat.rest) els.push(`...${pat.rest.name}`);
  return `[${els.join("," + ctx.sp)}]`;
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
    case "UpdateExpression":
      return expr.prefix
        ? `${expr.operator}${emitExpression(expr.argument, ctx)}`
        : `${emitExpression(expr.argument, ctx)}${expr.operator}`;
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
    case "CompoundAssignmentExpression":
      return `${emitExpression(expr.left, ctx)}${ctx.sp}${expr.operator}${ctx.sp}${emitExpression(expr.right, ctx)}`;
    case "NewExpression":
      return emitNew(expr, ctx);
    case "AwaitExpression":
      return `await ${emitExpression(expr.argument, ctx)}`;
    case "SpreadExpression":
      return `...${emitExpression(expr.argument, ctx)}`;
    case "TernaryExpression":
      return `${emitExpression(expr.condition, ctx)}${ctx.sp}?${ctx.sp}${emitExpression(expr.consequent, ctx)}${ctx.sp}:${ctx.sp}${emitExpression(expr.alternate, ctx)}`;
    case "TypeofExpression":
      return `typeof ${emitExpression(expr.argument, ctx)}`;
    case "VoidExpression":
      return `void ${emitExpression(expr.argument, ctx)}`;
    case "DeleteExpression":
      return `delete ${emitExpression(expr.argument, ctx)}`;
    case "YieldExpression": {
      const delegate = expr.delegate ? "*" : "";
      if (!expr.argument) return `yield${delegate}`;
      return `yield${delegate} ${emitExpression(expr.argument, ctx)}`;
    }
    case "ObjectPattern":
      return emitObjectPattern(expr, ctx);
    case "ArrayPattern":
      return emitArrayPattern(expr, ctx);
    case "RegExpLiteral":
      return expr.flags ? `/${expr.pattern}/${expr.flags}` : `/${expr.pattern}/`;
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
    case "undefined": return "undefined";
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
  if (call.optional) return `${callee}?.(${args})`;
  return `${callee}(${args})`;
}

function emitBinary(bin: BinaryExpression, ctx: GenContext): string {
  // Pipe operator: a |> fn  → fn(a)
  if (bin.operator === "|>") {
    const arg = emitExpression(bin.left, ctx);
    const fn = emitExpression(bin.right, ctx);
    return `${fn}(${arg})`;
  }

  // Nodeon == compiles to JS ===, and != to !==
  let op = bin.operator;
  if (op === "==") op = "===";
  else if (op === "!=") op = "!==";

  // Range operator (..) is handled at the ForStatement level, but
  // if it appears in an expression context emit as-is for safety
  const left = parenthesizeIfNeeded(bin.left, bin.operator, ctx);
  const right = parenthesizeIfNeeded(bin.right, bin.operator, ctx);
  return `${left}${ctx.sp}${op}${ctx.sp}${right}`;
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
  if (m.computed) {
    const bracket = m.optional ? "?.[" : "[";
    return `${obj}${bracket}${emitExpression(m.property, ctx)}]`;
  }
  const dot = m.optional ? "?." : ".";
  return `${obj}${dot}${emitExpression(m.property, ctx)}`;
}

function emitArray(arr: ArrayExpression, ctx: GenContext): string {
  const els = arr.elements.map((e) => emitExpression(e, ctx)).join("," + ctx.sp);
  return `[${els}]`;
}

function emitObject(obj: ObjectExpression, ctx: GenContext): string {
  if (obj.properties.length === 0) return "{}";
  const props = obj.properties.map((p) => {
    if (p.shorthand) return (p.key as Identifier).name;
    let keyStr: string;
    if (p.computed) {
      keyStr = `[${emitExpression(p.key as Expression, ctx)}]`;
    } else if (p.key.type === "Identifier") {
      keyStr = p.key.name;
    } else {
      keyStr = JSON.stringify((p.key as Literal).value);
    }
    return `${keyStr}:${ctx.sp}${emitExpression(p.value, ctx)}`;
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
