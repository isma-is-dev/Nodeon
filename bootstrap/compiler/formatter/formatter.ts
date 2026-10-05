/**
 * Nodeon Source Code Formatter
 *
 * Takes a Program AST and emits consistently-formatted Nodeon source code.
 * This is a pretty-printer for .no files, NOT a JS generator.
 */

import { PRECEDENCE } from "@language/precedence";
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
  FunctionExpression,
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

// ── Parentheses ─────────────────────────────────────────────────────────
//
// The AST records structure, not the parentheses that were written, so they
// must be re-derived from operator precedence: `(a + b) * c` and `a + b * c`
// are different trees and must not collapse into the same text. Constructs
// the shared binary table does not cover get the levels below, all of them
// looser than every binary operator so they are always parenthesised when
// used as an operand.

const PREC_ASSIGN = 0;       // `a = b`, `yield e`, `(a, b) => e`, `fn(a) {}`
const PREC_TERNARY = 0.5;   // `a ? b : c`
const PREC_UNARY = 15;      // `-a`, `!a`, `typeof a`, `await a`
const PREC_ATOM = 100;      // identifiers, literals, calls, members, `[]`, `{}`

function binPrec(op: string): number {
  return PRECEDENCE[op] ?? PREC_TERNARY;
}

function exprPrecedence(expr: Expression): number {
  switch (expr.type) {
    case "BinaryExpression": return binPrec(expr.operator);
    case "TernaryExpression":
    case "IfExpression": return PREC_TERNARY;
    case "AssignmentExpression":
    case "CompoundAssignmentExpression":
    case "ArrowFunction":
    case "FunctionExpression":
    case "YieldExpression":
    case "ComptimeExpression": return PREC_ASSIGN;
    default: return PREC_ATOM;
  }
}

/** `**` is the only right-associative binary operator. */
function isRightAssociative(op: string): boolean {
  return op === "**";
}

/** `??` may not be mixed with `||` / `&&` without parentheses (JS SyntaxError). */
function isNullish(op: string): boolean {
  return op === "??";
}

/**
 * Emit `expr` inside an operator context, parenthesising it when precedence
 * alone would not rebuild the same tree. `tieBreak` selects whether a child
 * that binds exactly as tightly still needs parentheses: that is the case on
 * the right of a left-associative operator (`a - (b - c)`) and in the leading
 * position of a ternary (`(a ? b : c) ? d : e`).
 */
function fmtChild(expr: Expression, minPrec: number, tieBreak: boolean, ctx: FmtContext): string {
  const text = fmtExpression(expr, ctx);
  const prec = exprPrecedence(expr);
  if (prec < minPrec || (tieBreak && prec === minPrec)) return `(${text})`;
  return text;
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
    case "ADTDeclaration": return fmtADT(stmt as any, ctx);
    case "GoStatement": return fmtGo(stmt as any, ctx);
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
  const cond = fmtCondition(stmt.condition, ctx);
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

/** An `if` / `while` / `switch` head ends at the block's `{`. */
function fmtCondition(expr: Expression, ctx: FmtContext): string {
  return fmtChild(expr, PREC_TERNARY, false, ctx);
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
    const from = fmtChild(stmt.iterable.left, PREC_ATOM, false, ctx);
    const to = fmtChild(stmt.iterable.right, PREC_ATOM, false, ctx);
    iterable = `${from}..${to}`;
  } else {
    iterable = fmtExpression(stmt.iterable, ctx);
  }
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}for ${variable} ${stmt.kind} ${iterable} {\n${body}\n${pad(ctx)}}`;
}

function fmtWhile(stmt: WhileStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}while ${fmtCondition(stmt.condition, ctx)} {\n${body}\n${pad(ctx)}}`;
}

function fmtDoWhile(stmt: DoWhileStatement, ctx: FmtContext): string {
  const inner = indented(ctx);
  const body = stmt.body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${pad(ctx)}do {\n${body}\n${pad(ctx)}} while ${fmtCondition(stmt.condition, ctx)}`;
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
  // `get` / `set` are only recognised when the token right after them is the
  // member name: `get fn label()` re-parses as a field `get` plus a method
  // `label`, which silently turns every access into `undefined`.
  if (kindPrefix) {
    return `${pad(ctx)}${s}${a}${kindPrefix}${gen}${key}(${params})${ret} {\n${body}\n${pad(ctx)}}`;
  }
  return `${pad(ctx)}${s}${a}fn${gen} ${key}(${params})${ret} {\n${body}\n${pad(ctx)}}`;
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
  return `${pad(ctx)}switch ${fmtCondition(stmt.discriminant, ctx)} {\n${cases}\n${pad(ctx)}}`;
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

function fmtADT(stmt: any, ctx: FmtContext): string {
  const typeParams = stmt.typeParams ? `<${stmt.typeParams.join(", ")}>` : "";
  const variants = stmt.variants.map((v: any) => {
    if (v.fields.length === 0) return v.name.name;
    const fields = v.fields.map((f: any) => {
      if (f.name) return `${f.name.name}: ${fmtType(f.typeAnnotation)}`;
      return fmtType(f.typeAnnotation);
    }).join(", ");
    return `${v.name.name}(${fields})`;
  }).join(" | ");
  return `${pad(ctx)}type ${stmt.name.name}${typeParams} = ${variants}`;
}

function fmtGo(stmt: any, ctx: FmtContext): string {
  if (stmt.body) {
    const inner = indented(ctx);
    const body = stmt.body.map((s: any) => fmtStatement(s, inner)).join("\n");
    return `${pad(ctx)}go {\n${body}\n${pad(ctx)}}`;
  }
  return `${pad(ctx)}go ${fmtExpression(stmt.expression, ctx)}`;
}

// ── Expressions ────────────────────────────────────────────────────

function fmtExpression(expr: Expression, ctx: FmtContext): string {
  switch (expr.type) {
    case "Identifier": return expr.name;
    case "Literal": return fmtLiteral(expr);
    case "CallExpression": return fmtCall(expr, ctx);
    case "BinaryExpression": return fmtBinary(expr, ctx);
    case "UnaryExpression":
      return `${expr.operator}${fmtChild(expr.argument, PREC_UNARY, false, ctx)}`;
    case "UpdateExpression":
      return expr.prefix
        ? `${expr.operator}${fmtChild(expr.argument, PREC_UNARY, false, ctx)}`
        : `${fmtChild(expr.argument, PREC_UNARY, false, ctx)}${expr.operator}`;
    case "TemplateLiteral": return fmtTemplate(expr, ctx);
    case "MemberExpression": return fmtMember(expr, ctx);
    case "ArrayExpression": return fmtArray(expr, ctx);
    case "ObjectExpression": return fmtObject(expr, ctx);
    case "ArrowFunction": return fmtArrow(expr, ctx);
    case "FunctionExpression": return fmtFunctionExpr(expr, ctx);
    case "AssignmentExpression":
      return `${fmtExpression(expr.left, ctx)} = ${fmtExpression(expr.right, ctx)}`;
    case "CompoundAssignmentExpression":
      return `${fmtExpression(expr.left, ctx)} ${expr.operator} ${fmtExpression(expr.right, ctx)}`;
    case "NewExpression": {
      const args = expr.arguments.map((a) => fmtExpression(a, ctx)).join(", ");
      return `new ${fmtChild(expr.callee, PREC_ATOM, false, ctx)}(${args})`;
    }
    case "AwaitExpression": return `await ${fmtChild(expr.argument, PREC_UNARY, false, ctx)}`;
    case "SpreadExpression": return `...${fmtChild(expr.argument, PREC_ATOM, false, ctx)}`;
    case "TernaryExpression": return fmtTernary(expr, ctx);
    case "TypeofExpression": return `typeof ${fmtChild(expr.argument, PREC_UNARY, false, ctx)}`;
    case "VoidExpression": return `void ${fmtChild(expr.argument, PREC_UNARY, false, ctx)}`;
    case "DeleteExpression": return `delete ${fmtChild(expr.argument, PREC_UNARY, false, ctx)}`;
    case "YieldExpression": {
      const del = expr.delegate ? "*" : "";
      if (!expr.argument) return `yield${del}`;
      return `yield${del} ${fmtChild(expr.argument, PREC_ASSIGN, false, ctx)}`;
    }
    case "AsExpression":
      return `${fmtExpression(expr.expression, ctx)} as ${fmtType(expr.typeAnnotation)}`;
    case "ComptimeExpression": {
      if ((expr as any).body) {
        const inner = indented(ctx);
        const body = (expr as any).body.map((s: any) => fmtStatement(s, inner)).join("\n");
        return `comptime {\n${body}\n${pad(ctx)}}`;
      }
      return `comptime ${fmtExpression((expr as any).expression, ctx)}`;
    }
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
    case "string": {
      const value = String(lit.value);
      // A double-quoted Nodeon string interpolates `{...}`, so any literal
      // whose value contains `{` is re-emitted single-quoted: single quotes
      // are raw, so it parses back to the very same Literal. Emitting it
      // double-quoted would turn it into a template literal — and the literal
      // `$1`, a backtick or a quote in it would corrupt the output.
      if (value.includes("{")) return `'${escapeString(value).replace(/'/g, "\\'")}'`;
      return `"${escapeString(value)}"`;
    }
    case "boolean": return String(lit.value);
    case "null": return "null";
    case "undefined": return "undefined";
    default: return String(lit.value);
  }
}

// A Nodeon string literal carries escapes, and a double-quoted one also
// carries `{` interpolation. The value has to be re-escaped on the way out: a
// lone `\` would swallow the next character, and the control characters that
// are invisible in the source still have to survive the round trip.
function escapeString(value: string): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const ch = value.charAt(i);
    if (ch === "\\") { out += "\\\\"; }
    else if (ch === '"') { out += '\\"'; }
    else if (ch === "\n") { out += "\\n"; }
    else if (ch === "\r") { out += "\\r"; }
    else if (ch === "\t") { out += "\\t"; }
    else {
      const code = value.charCodeAt(i);
      out += (code < 32 || code === 127)
        ? "\\x" + code.toString(16).padStart(2, "0")
        : ch;
    }
    i = i + 1;
  }
  return out;
}

// Template text is JavaScript template text: `\`, a backtick and `$` all have
// to be escaped, `$` unconditionally so that a following `{` can never open an
// interpolation that was not in the AST.
function escapeTemplateText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function fmtCall(call: CallExpression, ctx: FmtContext): string {
  const callee = fmtChild(call.callee, PREC_ATOM, false, ctx);
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
  const parentPrec = binPrec(bin.operator);
  const operand = (e: Expression, tieBreak: boolean): string => {
    // `a || (b ?? c)` is a JavaScript SyntaxError, and `a - (b - c)` is not
    // `a - b - c`, so an operand is parenthesised whenever precedence alone
    // cannot rebuild this exact tree.
    if (e.type === "BinaryExpression" && isNullish(e.operator) !== isNullish(bin.operator)) {
      return `(${fmtExpression(e, ctx)})`;
    }
    return fmtChild(e, parentPrec, tieBreak, ctx);
  };
  const left = operand(bin.left, false);
  const right = operand(bin.right, !isRightAssociative(bin.operator));
  return `${left} ${bin.operator} ${right}`;
}

function fmtTernary(t: TernaryExpression, ctx: FmtContext): string {
  const cond = fmtChild(t.condition, PREC_TERNARY, true, ctx);
  const consequent = fmtChild(t.consequent, PREC_TERNARY, true, ctx);
  const alternate = fmtChild(t.alternate, PREC_TERNARY, false, ctx);
  return `${cond} ? ${consequent} : ${alternate}`;
}

function fmtMember(mem: MemberExpression, ctx: FmtContext): string {
  const obj = fmtChild(mem.object, PREC_ATOM, false, ctx);
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
  // Object spread `{ ...src }` — the key is a marker, never a real key.
  if ((prop as any).spread) return `...${fmtExpression(prop.value, ctx)}`;
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
  // `=> {` starts a block in JavaScript, so an object literal body has to be
  // wrapped in parentheses or it turns into (and silently loses) a block.
  const bodyExpr = fn.body as Expression;
  if (bodyExpr && bodyExpr.type === "ObjectExpression") {
    return `${prefix}(${params})${ret} => (${fmtExpression(bodyExpr, ctx)})`;
  }
  return `${prefix}(${params})${ret} => ${fmtExpression(bodyExpr, ctx)}`;
}

// Anonymous `fn(a, b) { ... }` used where an expression is expected.
// The block form is only safe when the body cannot be mistaken for a block;
// an implicitly returned single expression uses the `fn(a) = expr` form.
function fmtFunctionExpr(fn: FunctionExpression, ctx: FmtContext): string {
  const prefix = fn.async ? "async " : "";
  const gen = fn.generator ? "*" : "";
  const params = fn.params.map((p) => fmtParam(p)).join(", ");
  const ret = fn.returnType ? `: ${fmtType(fn.returnType)}` : "";
  const body = (fn.body ?? []) as Statement[];
  if ((fn as any).implicitReturn && body.length === 1 && body[0].type === "ExpressionStatement") {
    return `${prefix}fn${gen}(${params})${ret} = ${fmtExpression(body[0].expression, ctx)}`;
  }
  const inner = indented(ctx);
  const text = body.map((s) => fmtStatement(s, inner)).join("\n");
  return `${prefix}fn${gen}(${params})${ret} {\n${text}\n${pad(ctx)}}`;
}

function fmtTemplate(tmpl: TemplateLiteral, ctx: FmtContext): string {
  let out = "`";
  for (const part of tmpl.parts) {
    if (part.kind === "Text") {
      out += escapeTemplateText(part.value);
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
      const dflt = p.defaultValue
        ? ` = ${fmtExpression(p.defaultValue, { indent: 0, options: DEFAULT_OPTIONS })}`
        : "";
      if (p.shorthand) return `${p.key.name}${dflt}`;
      const val = p.value.type === "Identifier" ? p.value.name : fmtPattern(p.value as ObjectPattern | ArrayPattern);
      return `${p.key.name}: ${val}${dflt}`;
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
    case "nullable": return `${fmtType(t.inner)}?`;
    default: return "any";
  }
}
