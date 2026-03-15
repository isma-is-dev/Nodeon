/**
 * Nodeon Source Code Formatter
 *
 * Takes a Program AST and emits consistently-formatted Nodeon source code.
 * This is a pretty-printer for .no files, NOT a JS generator.
 */

import {
  Program, Statement, Expression, TypeAnnotation,
  FunctionDeclaration, VariableDeclaration, DestructuringDeclaration,
  ExpressionStatement, IfStatement, ForStatement, WhileStatement,
  DoWhileStatement, ReturnStatement, ImportDeclaration, ExportDeclaration,
  ClassDeclaration, ClassMember, ClassMethod, ClassField,
  TryCatchStatement, ThrowStatement, SwitchStatement, SwitchCase,
  MatchStatement, MatchCase, EnumDeclaration, InterfaceDeclaration,
  TypeAliasDeclaration, LabeledStatement,
  CallExpression, BinaryExpression, UnaryExpression, UpdateExpression,
  MemberExpression, ArrayExpression, ObjectExpression, ObjectProperty,
  ArrowFunction, AssignmentExpression, CompoundAssignmentExpression,
  NewExpression, AwaitExpression, SpreadExpression, TernaryExpression,
  TypeofExpression, VoidExpression, DeleteExpression, YieldExpression,
  AsExpression, TemplateLiteral, Literal, Identifier, RegExpLiteral,
  Param, ObjectPattern, ArrayPattern, ImportSpecifier,
  BreakStatement, ContinueStatement,
} from "@ast/nodes";

export interface FormatOptions {
  indentSize: number;
  maxLineWidth: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
  indentSize: 2,
  maxLineWidth: 100,
};

export function format(program: Program, opts: Partial<FormatOptions> = {}): string {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const ctx: FmtContext = { indent: 0, options };
  const lines = program.body.map((stmt) => fmtStatement(stmt, ctx));
  return lines.join("\n") + "\n";
}

type FmtContext = {
  indent: number;
  options: FormatOptions;
};

function pad(ctx: FmtContext): string {
  return " ".repeat(ctx.indent * ctx.options.indentSize);
}

function indented(ctx: FmtContext): FmtContext {
  return { ...ctx, indent: ctx.indent + 1 };
}

// ── Statements ────────────────────────────────────────────────────

function fmtStatement(stmt: Statement, ctx: FmtContext): string {
  switch (stmt.type) {
    case "FunctionDeclaration": return fmtFunction(stmt, ctx);
    case "VariableDeclaration": return fmtVariable(stmt, ctx);
    case "DestructuringDeclaration": return fmtDestructuring(stmt, ctx);
    case "ExpressionStatement": return pad(ctx) + fmtExpression(stmt.expression, ctx);
    case "IfStatement": return fmtIf(stmt, ctx);
    case "ForStatement": return fmtFor(stmt, ctx);
    case "WhileStatement": return fmtWhile(stmt, ctx);
    case "DoWhileStatement": return fmtDoWhile(stmt, ctx);
    case "ReturnStatement": return fmtReturn(stmt, ctx);
    case "ImportDeclaration": return fmtImport(stmt, ctx);
    case "ExportDeclaration": return fmtExport(stmt, ctx);
    case "ClassDeclaration": return fmtClass(stmt, ctx);
    case "TryCatchStatement": return fmtTryCatch(stmt, ctx);
    case "ThrowStatement": return `${pad(ctx)}throw ${fmtExpression(stmt.value, ctx)}`;
    case "SwitchStatement": return fmtSwitch(stmt, ctx);
    case "MatchStatement": return fmtMatch(stmt, ctx);
    case "EnumDeclaration": return fmtEnum(stmt, ctx);
    case "InterfaceDeclaration": return fmtInterface(stmt, ctx);
    case "TypeAliasDeclaration": return fmtTypeAlias(stmt, ctx);
    case "BreakStatement": return `${pad(ctx)}break${stmt.label ? " " + stmt.label : ""}`;
    case "ContinueStatement": return `${pad(ctx)}continue${stmt.label ? " " + stmt.label : ""}`;
    case "DebuggerStatement": return `${pad(ctx)}debugger`;
    case "LabeledStatement": return `${pad(ctx)}${stmt.label}:\n${fmtStatement(stmt.body, ctx)}`;
    default: return `${pad(ctx)}/* unsupported: ${(stmt as any).type} */`;
  }
}

function fmtFunction(fn: FunctionDeclaration, ctx: FmtContext): string {
  const inner = indented(ctx);
  const prefix = fn.async ? "async " : "";
  const gen = fn.generator ? "*" : "";
  const typeParams = fn.typeParams ? `<${fn.typeParams.join(", ")}>` : "";
  const params = fn.params.map((p) => fmtParam(p)).join(", ");
  const ret = fn.returnType ? `: ${fmtType(fn.returnType)}` : "";
  const body = fn.body.map((s) => fmtStatement(s, inner)).join("\n");
  let decs = "";
  if (fn.decorators && fn.decorators.length > 0) {
    decs = fn.decorators.map(d => {
      const args = d.arguments ? `(${d.arguments.map(a => fmtExpression(a, ctx)).join(", ")})` : "";
      return `${pad(ctx)}@${d.name}${args}`;
    }).join("\n") + "\n";
  }
  return `${decs}${pad(ctx)}${prefix}fn${gen} ${fn.name.name}${typeParams}(${params})${ret} {\n${body}\n${pad(ctx)}}`;
}

function fmtParam(p: Param): string {
  let out = "";
  if (p.rest) out += "...";
  if (p.pattern) {
    out += fmtPattern(p.pattern);
  } else {
    out += p.name;
  }
  if (p.typeAnnotation) out += `: ${fmtType(p.typeAnnotation)}`;
  if (p.defaultValue) out += ` = ${fmtExpression(p.defaultValue, { indent: 0, options: DEFAULT_OPTIONS })}`;
  return out;
}

function fmtVariable(v: VariableDeclaration, ctx: FmtContext): string {
  const type = v.typeAnnotation ? `: ${fmtType(v.typeAnnotation)}` : "";
  return `${pad(ctx)}${v.kind} ${v.name.name}${type} = ${fmtExpression(v.value, ctx)}`;
}

function fmtDestructuring(d: DestructuringDeclaration, ctx: FmtContext): string {
  const pat = fmtPattern(d.pattern);
  return `${pad(ctx)}${d.kind} ${pat} = ${fmtExpression(d.value, ctx)}`;
}

function fmtIf(stmt: IfStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const cond = fmtExpression(stmt.condition, ctx);
  const body = stmt.consequent.map((s) => fmtStatement(s, inner)).join("\n");
  let out = `${pad(ctx)}if ${cond} {\n${body}\n${pad(ctx)}}`;
  if (stmt.alternate && stmt.alternate.length > 0) {
    // Check if alternate is a single if-else chain
    if (stmt.alternate.length === 1 && stmt.alternate[0].type === "IfStatement") {
      const elseIf = fmtIf(stmt.alternate[0] as IfStatement, ctx);
      out += ` else ${elseIf.trimStart()}`;
    } else {
      const alt = stmt.alternate.map((s) => fmtStatement(s, inner)).join("\n");
      out += ` else {\n${alt}\n${pad(ctx)}}`;
    }
  }
  return out;
}

function fmtFor(stmt: ForStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  let variable: string;
  if ("name" in stmt.variable && stmt.variable.type === "Identifier") {
    variable = stmt.variable.name;
  } else {
    variable = fmtPattern(stmt.variable as ObjectPattern | ArrayPattern);
  }
  // Check for range: BinaryExpression with '..'
  let iterable: string;
  if (stmt.iterable.type === "BinaryExpression" && stmt.iterable.operator === "..") {
    iterable = `${fmtExpression(stmt.iterable.left, ctx)}..${fmtExpression(stmt.iterable.right, ctx)}`;
  } else {
    iterable = fmtExpression(stmt.iterable, ctx);
  }
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}for ${variable} ${stmt.kind} ${iterable} {\n${body}\n${pad(ctx)}}`;
}

function fmtWhile(stmt: WhileStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}while ${fmtExpression(stmt.condition, ctx)} {\n${body}\n${pad(ctx)}}`;
}

function fmtDoWhile(stmt: DoWhileStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}do {\n${body}\n${pad(ctx)}} while ${fmtExpression(stmt.condition, ctx)}`;
}

function fmtReturn(stmt: ReturnStatement, ctx: FmtContext): string {
  if (!stmt.value) return `${pad(ctx)}return`;
  return `${pad(ctx)}return ${fmtExpression(stmt.value, ctx)}`;
}

function fmtImport(stmt: ImportDeclaration, ctx: FmtContext): string {
  const src = `'${stmt.source}'`;
  if (stmt.namedImports.length > 0) {
    const specs = stmt.namedImports.map((s) => s.alias ? `${s.name} as ${s.alias}` : s.name).join(", ");
    return `${pad(ctx)}import { ${specs} } from ${src}`;
  }
  if (stmt.namespaceImport) {
    return `${pad(ctx)}import * as ${stmt.namespaceImport} from ${src}`;
  }
  return `${pad(ctx)}import ${stmt.defaultImport} from ${src}`;
}

function fmtExport(stmt: ExportDeclaration, ctx: FmtContext): string {
  if (stmt.exportAll) {
    const alias = stmt.exportAllAlias ? ` as ${stmt.exportAllAlias}` : "";
    return `${pad(ctx)}export *${alias} from '${stmt.source}'`;
  }
  if (stmt.namedExports && stmt.namedExports.length > 0) {
    const specs = stmt.namedExports.map((s) => s.alias ? `${s.name} as ${s.alias}` : s.name).join(", ");
    const from = stmt.source ? ` from '${stmt.source}'` : "";
    return `${pad(ctx)}export { ${specs} }${from}`;
  }
  const def = stmt.isDefault ? "default " : "";
  if (stmt.declaration) {
    return `${pad(ctx)}export ${def}${fmtStatement(stmt.declaration, { ...ctx, indent: 0 }).trimStart()}`;
  }
  return `${pad(ctx)}export ${def}`;
}

function fmtClass(cls: ClassDeclaration, ctx: FmtContext): string {
  const inner = indented(ctx);
  const typeParams = cls.typeParams ? `<${cls.typeParams.join(", ")}>` : "";
  const ext = cls.superClass ? ` extends ${cls.superClass.name}` : "";
  const members = cls.body.map((m) => fmtClassMember(m, inner)).join("\n\n");
  let decs = "";
  if (cls.decorators && cls.decorators.length > 0) {
    decs = cls.decorators.map(d => {
      const args = d.arguments ? `(${d.arguments.map(a => fmtExpression(a, ctx)).join(", ")})` : "";
      return `${pad(ctx)}@${d.name}${args}`;
    }).join("\n") + "\n";
  }
  return `${decs}${pad(ctx)}class ${cls.name.name}${typeParams}${ext} {\n${members}\n${pad(ctx)}}`;
}

function fmtClassMember(member: ClassMember, ctx: FmtContext): string {
  if (member.type === "ClassField") {
    const s = member.static ? "static " : "";
    const key = member.computed ? `[${fmtExpression(member.name as Expression, ctx)}]` : (member.name as Identifier).name;
    if (member.value) {
      return `${pad(ctx)}${s}${key} = ${fmtExpression(member.value, ctx)}`;
    }
    return `${pad(ctx)}${s}${key}`;
  }
  // ClassMethod
  const m = member as ClassMethod;
  const inner = indented(ctx);
  const s = m.static ? "static " : "";
  const a = m.async ? "async " : "";
  const gen = m.generator ? "*" : "";
  const key = m.computed ? `[${fmtExpression(m.name as Expression, ctx)}]` : (m.name as Identifier).name;
  const kindPrefix = m.kind === "get" ? "get " : m.kind === "set" ? "set " : "";
  const params = m.params.map((p) => fmtParam(p)).join(", ");
  const ret = m.returnType ? `: ${fmtType(m.returnType)}` : "";
  const body = m.body.map((st) => fmtStatement(st, inner)).join("\n");
  if (m.kind === "constructor") {
    return `${pad(ctx)}constructor(${params}) {\n${body}\n${pad(ctx)}}`;
  }
  return `${pad(ctx)}${s}${a}${kindPrefix}fn${gen} ${key}(${params})${ret} {\n${body}\n${pad(ctx)}}`;
}

function fmtTryCatch(stmt: TryCatchStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const tryBody = stmt.tryBlock.map((s) => fmtStatement(s, inner)).join("\n");
  const catchParam = stmt.catchParam ? `(${stmt.catchParam.name})` : "";
  const catchBody = stmt.catchBlock.map((s) => fmtStatement(s, inner)).join("\n");
  let out = `${pad(ctx)}try {\n${tryBody}\n${pad(ctx)}} catch${catchParam ? " " + catchParam : ""} {\n${catchBody}\n${pad(ctx)}}`;
  if (stmt.finallyBlock) {
    const finallyBody = stmt.finallyBlock.map((s) => fmtStatement(s, inner)).join("\n");
    out += ` finally {\n${finallyBody}\n${pad(ctx)}}`;
  }
  return out;
}

function fmtSwitch(stmt: SwitchStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const cases = stmt.cases.map((c) => fmtSwitchCase(c, inner)).join("\n");
  return `${pad(ctx)}switch ${fmtExpression(stmt.discriminant, ctx)} {\n${cases}\n${pad(ctx)}}`;
}

function fmtSwitchCase(c: SwitchCase, ctx: FmtContext): string {
  const inner = indented(ctx);
  const header = c.test ? `case ${fmtExpression(c.test, ctx)}` : "default";
  const body = c.consequent.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}${header} {\n${body}\n${pad(ctx)}}`;
}

function fmtMatch(stmt: MatchStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const cases = stmt.cases.map((c) => fmtMatchCase(c, inner)).join("\n");
  return `${pad(ctx)}match ${fmtExpression(stmt.discriminant, ctx)} {\n${cases}\n${pad(ctx)}}`;
}

function fmtMatchCase(c: MatchCase, ctx: FmtContext): string {
  const inner = indented(ctx);
  const header = c.pattern ? `case ${fmtExpression(c.pattern, ctx)}` : "default";
  const guard = c.guard ? ` if ${fmtExpression(c.guard, ctx)}` : "";
  const body = c.body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}${header}${guard} {\n${body}\n${pad(ctx)}}`;
}

function fmtEnum(stmt: EnumDeclaration, ctx: FmtContext): string {
  const inner = indented(ctx);
  const members = stmt.members.map((m) => {
    if (m.value) return `${pad(inner)}${m.name.name} = ${fmtExpression(m.value, inner)}`;
    return `${pad(inner)}${m.name.name}`;
  }).join("\n");
  return `${pad(ctx)}enum ${stmt.name.name} {\n${members}\n${pad(ctx)}}`;
}

function fmtInterface(stmt: InterfaceDeclaration, ctx: FmtContext): string {
  const inner = indented(ctx);
  const ext = stmt.extends ? ` extends ${stmt.extends.map((e) => e.name).join(", ")}` : "";
  const props = stmt.properties.map((p) => {
    const opt = p.optional ? "?" : "";
    if (p.method) {
      const params = p.params ? p.params.map((t) => fmtType(t)).join(", ") : "";
      return `${pad(inner)}${p.name.name}${opt}(${params}): ${fmtType(p.valueType)}`;
    }
    return `${pad(inner)}${p.name.name}${opt}: ${fmtType(p.valueType)}`;
  }).join("\n");
  return `${pad(ctx)}interface ${stmt.name.name}${ext} {\n${props}\n${pad(ctx)}}`;
}

function fmtTypeAlias(stmt: TypeAliasDeclaration, ctx: FmtContext): string {
  const typeParams = stmt.typeParams ? `<${stmt.typeParams.join(", ")}>` : "";
  return `${pad(ctx)}type ${stmt.name.name}${typeParams} = ${fmtType(stmt.value)}`;
}

// ── Expressions ────────────────────────────────────────────────────

function fmtExpression(expr: Expression, ctx: FmtContext): string {
  switch (expr.type) {
    case "Identifier": return expr.name;
    case "Literal": return fmtLiteral(expr);
    case "CallExpression": return fmtCall(expr, ctx);
    case "BinaryExpression": return fmtBinary(expr, ctx);
    case "UnaryExpression": return `${expr.operator}${fmtExpression(expr.argument, ctx)}`;
    case "UpdateExpression":
      return expr.prefix
        ? `${expr.operator}${fmtExpression(expr.argument, ctx)}`
        : `${fmtExpression(expr.argument, ctx)}${expr.operator}`;
    case "TemplateLiteral": return fmtTemplate(expr, ctx);
    case "MemberExpression": return fmtMember(expr, ctx);
    case "ArrayExpression": return fmtArray(expr, ctx);
    case "ObjectExpression": return fmtObject(expr, ctx);
    case "ArrowFunction": return fmtArrow(expr, ctx);
    case "AssignmentExpression":
      return `${fmtExpression(expr.left, ctx)} = ${fmtExpression(expr.right, ctx)}`;
    case "CompoundAssignmentExpression":
      return `${fmtExpression(expr.left, ctx)} ${expr.operator} ${fmtExpression(expr.right, ctx)}`;
    case "NewExpression": {
      const args = expr.arguments.map((a) => fmtExpression(a, ctx)).join(", ");
      return `new ${fmtExpression(expr.callee, ctx)}(${args})`;
    }
    case "AwaitExpression": return `await ${fmtExpression(expr.argument, ctx)}`;
    case "SpreadExpression": return `...${fmtExpression(expr.argument, ctx)}`;
    case "TernaryExpression":
      return `${fmtExpression(expr.condition, ctx)} ? ${fmtExpression(expr.consequent, ctx)} : ${fmtExpression(expr.alternate, ctx)}`;
    case "TypeofExpression": return `typeof ${fmtExpression(expr.argument, ctx)}`;
    case "VoidExpression": return `void ${fmtExpression(expr.argument, ctx)}`;
    case "DeleteExpression": return `delete ${fmtExpression(expr.argument, ctx)}`;
    case "YieldExpression": {
      const del = expr.delegate ? "*" : "";
      if (!expr.argument) return `yield${del}`;
      return `yield${del} ${fmtExpression(expr.argument, ctx)}`;
    }
    case "AsExpression":
      return `${fmtExpression(expr.expression, ctx)} as ${fmtType(expr.typeAnnotation)}`;
    case "IfExpression": {
      const inner = indented(ctx);
      const cond = fmtExpression(expr.condition, ctx);
      const thenBody = expr.consequent.map((s: any) => fmtStatement(s, inner)).join("\n");
      const elseBody = expr.alternate.map((s: any) => fmtStatement(s, inner)).join("\n");
      return `if ${cond} {\n${thenBody}\n${pad(ctx)}} else {\n${elseBody}\n${pad(ctx)}}`;
    }
    case "RegExpLiteral":
      return expr.flags ? `/${expr.pattern}/${expr.flags}` : `/${expr.pattern}/`;
    case "ObjectPattern": return fmtPattern(expr);
    case "ArrayPattern": return fmtPattern(expr);
    default: return `/* unsupported: ${(expr as any).type} */`;
  }
}

function fmtLiteral(lit: Literal): string {
  switch (lit.literalType) {
    case "number": return String(lit.value);
    case "string": return `"${String(lit.value).replace(/"/g, '\\"')}"`;
    case "boolean": return String(lit.value);
    case "null": return "null";
    case "undefined": return "undefined";
    default: return String(lit.value);
  }
}

function fmtCall(call: CallExpression, ctx: FmtContext): string {
  const callee = fmtExpression(call.callee, ctx);
  const chain = call.optional ? "?." : "";
  const parts: string[] = call.arguments.map((a) => fmtExpression(a, ctx));
  if (call.namedArgs && call.namedArgs.length > 0) {
    for (const na of call.namedArgs) {
      parts.push(`${(na as any).name.name}: ${fmtExpression((na as any).value, ctx)}`);
    }
  }
  return `${callee}${chain}(${parts.join(", ")})`;
}

function fmtBinary(bin: BinaryExpression, ctx: FmtContext): string {
  const left = fmtExpression(bin.left, ctx);
  const right = fmtExpression(bin.right, ctx);
  return `${left} ${bin.operator} ${right}`;
}

function fmtMember(mem: MemberExpression, ctx: FmtContext): string {
  const obj = fmtExpression(mem.object, ctx);
  const chain = mem.optional ? "?." : "";
  if (mem.computed) {
    return `${obj}${chain}[${fmtExpression(mem.property, ctx)}]`;
  }
  const prop = fmtExpression(mem.property, ctx);
  return `${obj}${chain}${chain ? "" : "."}${prop}`;
}

function fmtArray(arr: ArrayExpression, ctx: FmtContext): string {
  const els = arr.elements.map((e) => fmtExpression(e, ctx)).join(", ");
  return `[${els}]`;
}

function fmtObject(obj: ObjectExpression, ctx: FmtContext): string {
  if (obj.properties.length === 0) return "{}";
  const props = obj.properties.map((p) => fmtObjectProp(p, ctx)).join(", ");
  return `{ ${props} }`;
}

function fmtObjectProp(prop: ObjectProperty, ctx: FmtContext): string {
  if (prop.shorthand) return fmtExpression(prop.key as Expression, ctx);
  const key = prop.computed
    ? `[${fmtExpression(prop.key as Expression, ctx)}]`
    : fmtExpression(prop.key as Expression, ctx);
  return `${key}: ${fmtExpression(prop.value, ctx)}`;
}

function fmtArrow(fn: ArrowFunction, ctx: FmtContext): string {
  const prefix = fn.async ? "async " : "";
  const params = fn.params.map((p) => fmtParam(p)).join(", ");
  const ret = fn.returnType ? `: ${fmtType(fn.returnType)}` : "";
  if (Array.isArray(fn.body)) {
    const inner = indented(ctx);
    const body = fn.body.map((s) => fmtStatement(s, inner)).join("\n");
    return `${prefix}(${params})${ret} => {\n${body}\n${pad(ctx)}}`;
  }
  return `${prefix}(${params})${ret} => ${fmtExpression(fn.body, ctx)}`;
}

function fmtTemplate(tmpl: TemplateLiteral, ctx: FmtContext): string {
  let out = "`";
  for (const part of tmpl.parts) {
    if (part.kind === "Text") {
      out += part.value;
    } else {
      out += `\${${fmtExpression(part.expression, ctx)}}`;
    }
  }
  out += "`";
  return out;
}

// ── Patterns ────────────────────────────────────────────────────

function fmtPattern(pat: ObjectPattern | ArrayPattern): string {
  if (pat.type === "ObjectPattern") {
    const props = pat.properties.map((p) => {
      if (p.shorthand) return p.key.name;
      const val = p.value.type === "Identifier" ? p.value.name : fmtPattern(p.value as ObjectPattern | ArrayPattern);
      let out = `${p.key.name}: ${val}`;
      if (p.defaultValue) out += ` = ${fmtExpression(p.defaultValue, { indent: 0, options: DEFAULT_OPTIONS })}`;
      return out;
    });
    if (pat.rest) props.push(`...${pat.rest.name}`);
    return `{ ${props.join(", ")} }`;
  }
  // ArrayPattern
  const els = pat.elements.map((e) => {
    if (e === null) return "";
    if (e.type === "Identifier") return e.name;
    return fmtPattern(e as ObjectPattern | ArrayPattern);
  });
  if (pat.rest) els.push(`...${pat.rest.name}`);
  return `[${els.join(", ")}]`;
}

// ── Types ────────────────────────────────────────────────────

function fmtType(t: TypeAnnotation): string {
  switch (t.kind) {
    case "named": return t.name;
    case "array": return `${fmtType(t.elementType)}[]`;
    case "union": return t.types.map(fmtType).join(" | ");
    case "intersection": return t.types.map(fmtType).join(" & ");
    case "generic": return `${t.name}<${t.args.map(fmtType).join(", ")}>`;
    case "function": {
      const params = t.params.map(fmtType).join(", ");
      return `(${params}) => ${fmtType(t.returnType)}`;
    }
    case "object": {
      const props = t.properties.map((p) => {
        const opt = p.optional ? "?" : "";
        return `${p.key}${opt}: ${fmtType(p.value)}`;
      }).join(", ");
      return `{ ${props} }`;
    }
    case "tuple": return `[${t.elements.map(fmtType).join(", ")}]`;
    case "literal": return JSON.stringify(t.value);
    default: return "any";
  }
}
