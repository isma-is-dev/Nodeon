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
import { rewriteImportSource } from "@compiler/resolver";

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

    // For multi-line output (functions, classes, etc.), map inner lines
    // using loc from inner statements when available
    const codeLines = code.split("\n");
    if (codeLines.length > 1) {
      // Collect inner statement locs for more accurate mapping
      const innerLocs = collectInnerLocs(stmt);
      outputLines.push(codeLines[0]);
      for (let i = 1; i < codeLines.length; i++) {
        const innerLoc = innerLocs[i - 1];
        if (innerLoc) {
          builder.addLineMapping(innerLoc.line, genLine + i, sourceIndex);
        } else if (stmt.loc) {
          builder.addLineMapping(stmt.loc.line, genLine + i, sourceIndex);
        }
        outputLines.push(codeLines[i]);
      }
    } else {
      outputLines.push(code);
    }
  }

  const js = outputLines.join(nl) + nl + `//# sourceMappingURL=${outputFile}.map`;
  const sourceMap = builder.toJSON(outputFile);

  return { js, sourceMap };
}

// Collect loc info from inner statements for accurate source map mapping
function collectInnerLocs(stmt: Statement): Array<{ line: number; column: number } | null> {
  const locs: Array<{ line: number; column: number } | null> = [];

  function collect(stmts: Statement[]): void {
    for (const s of stmts) {
      if (s.loc) {
        locs.push({ line: s.loc.line, column: s.loc.column });
      } else {
        locs.push(null);
      }
      // Recurse into compound statements
      if (s.type === "IfStatement") {
        collect(s.consequent);
        if (s.alternate) collect(s.alternate);
      } else if (s.type === "ForStatement" || s.type === "WhileStatement") {
        collect(s.body);
      } else if (s.type === "TryCatchStatement") {
        collect(s.tryBlock);
        collect(s.catchBlock);
        if (s.finallyBlock) collect(s.finallyBlock);
      }
    }
  }

  switch (stmt.type) {
    case "FunctionDeclaration": collect(stmt.body); break;
    case "ClassDeclaration":
      for (const m of stmt.body) {
        if (m.type === "ClassMethod") collect(m.body);
      }
      break;
    case "IfStatement":
      collect(stmt.consequent);
      if (stmt.alternate) collect(stmt.alternate);
      break;
    case "ForStatement": case "WhileStatement": collect(stmt.body); break;
    case "TryCatchStatement":
      collect(stmt.tryBlock);
      collect(stmt.catchBlock);
      if (stmt.finallyBlock) collect(stmt.finallyBlock);
      break;
    case "SwitchStatement":
      for (const c of stmt.cases) collect(c.consequent);
      break;
    case "MatchStatement":
      for (const c of stmt.cases) collect(c.body);
      break;
  }

  return locs;
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
    case "ErrorStatement":
      // A statement that failed to parse. Emitting a throw here means a syntax
      // error can never pass silently through a code path that ignores
      // diagnostics (the build script, `run`, the CLI) — it fails loudly at the
      // exact place instead of quietly dropping a function.
      return `throw new Error(${JSON.stringify(`Nodeon syntax error: ${(stmt as any).message}`)});`;
    case "SwitchStatement":
      return emitSwitch(stmt, ctx);
    case "BreakStatement":
      return stmt.label ? `break ${stmt.label};` : "break;";
    case "ContinueStatement":
      return stmt.label ? `continue ${stmt.label};` : "continue;";
    case "DestructuringDeclaration":
      return emitDestructuring(stmt, ctx);
    case "MatchStatement":
      return emitMatch(stmt, ctx);
    case "EnumDeclaration":
      return emitEnum(stmt, ctx);
    case "InterfaceDeclaration":
    case "TypeAliasDeclaration":
      return ""; // Type-only declaration, stripped from JS output
    case "ADTDeclaration":
      return emitADT(stmt as any, ctx);
    case "GoStatement":
      return emitGo(stmt as any, ctx);
    case "DebuggerStatement":
      return "debugger;";
    case "LabeledStatement":
      return `${stmt.label}: ${emitStatement(stmt.body, ctx)}`;
    default:
      throw new Error(`Unsupported statement type: ${(stmt as any).type}`);
  }
}

function emitFunction(fn: FunctionDeclaration, ctx: GenContext): string {
  const async = fn.async ? "async " : "";
  const star = fn.generator ? "*" : "";
  const params = fn.params.map((p) => emitParam(p, ctx)).join("," + ctx.sp);
  const fnScope = childScope(indented(ctx));
  fn.params.forEach((p) => fnScope.declaredVars.add(p.name));

  // implicit return rule (disabled for generators — they use yield)
  let body: string;
  if (!fn.generator && fn.body.length === 1 && fn.body[0].type === "ExpressionStatement") {
    body = pad(fnScope) + `return ${emitExpression((fn.body[0] as ExpressionStatement).expression, fnScope)};`;
  } else {
    body = fn.body.map((s) => pad(fnScope) + emitStatement(s, fnScope)).join(ctx.nl);
  }

  let result = `${async}function${star} ${fn.name.name}(${params})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;

  // Emit decorators: @log fn foo() {} → function foo() {} ; foo = log(foo);
  if (fn.decorators && fn.decorators.length > 0) {
    for (const dec of fn.decorators) {
      const args = dec.arguments ? dec.arguments.map(a => emitExpression(a, ctx)).join("," + ctx.sp) : "";
      if (dec.arguments) {
        result += ctx.nl + pad(ctx) + `${fn.name.name}${ctx.sp}=${ctx.sp}${dec.name}(${args})(${fn.name.name});`;
      } else {
        result += ctx.nl + pad(ctx) + `${fn.name.name}${ctx.sp}=${ctx.sp}${dec.name}(${fn.name.name});`;
      }
    }
  }

  return result;
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

  // Nodeon 'in' → JS 'of' (values, like Python's for-in)
  // Nodeon 'of' → JS 'in' (keys)
  const jsKind = stmt.kind === "of" ? "in" : "of";
  return `for${ctx.sp}(const ${varStr} ${jsKind} ${emitExpression(iter, ctx)})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
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
  const src = rewriteImportSource(stmt.source);
  if (stmt.namedImports.length > 0) {
    const names = stmt.namedImports.map(s => s.alias ? `${s.name} as ${s.alias}` : s.name).join("," + ctx.sp);
    return `import${ctx.sp}{${ctx.sp}${names}${ctx.sp}}${ctx.sp}from${ctx.sp}${JSON.stringify(src)};`;
  }
  if (stmt.namespaceImport) {
    return `import * as ${stmt.namespaceImport}${ctx.sp}from${ctx.sp}${JSON.stringify(src)};`;
  }
  return `import ${stmt.defaultImport}${ctx.sp}from${ctx.sp}${JSON.stringify(src)};`;
}

function emitExport(stmt: ExportDeclaration, ctx: GenContext): string {
  // export * from "mod"  /  export * as ns from "mod"
  if (stmt.exportAll) {
    const alias = stmt.exportAllAlias ? ` as ${stmt.exportAllAlias}` : "";
    const src = rewriteImportSource(stmt.source!);
    return `export *${alias} from ${JSON.stringify(src)};`;
  }

  // export { x, y }  or  export { x as y } from "mod"
  if (stmt.namedExports) {
    const names = stmt.namedExports.map(s => s.alias ? `${s.name} as ${s.alias}` : s.name).join(`,${ctx.sp}`);
    const from = stmt.source ? ` from ${JSON.stringify(rewriteImportSource(stmt.source))}` : "";
    return `export${ctx.sp}{${ctx.sp}${names}${ctx.sp}}${from};`;
  }

  // export default ...  or  export ...
  const kw = stmt.isDefault ? "export default" : "export";
  return `${kw} ${emitStatement(stmt.declaration!, ctx)}`;
}

function emitClass(cls: ClassDeclaration, ctx: GenContext): string {
  const inner = indented(ctx);
  const ext = cls.superClass ? ` extends ${cls.superClass.name}` : "";
  const members = cls.body.map((m) => {
    if (m.type === "ClassField") return pad(inner) + emitClassField(m, inner);
    return pad(inner) + emitMethod(m, inner);
  }).join(ctx.nl + ctx.nl);
  let result = `class ${cls.name.name}${ext}${ctx.sp}{${ctx.nl}${members}${ctx.nl}${pad(ctx)}}`;

  // Emit decorators: @decorator class Foo {} → class Foo {} ; Foo = decorator(Foo);
  if (cls.decorators && cls.decorators.length > 0) {
    for (const dec of cls.decorators) {
      const args = dec.arguments ? dec.arguments.map(a => emitExpression(a, ctx)).join("," + ctx.sp) : "";
      if (dec.arguments) {
        result += ctx.nl + pad(ctx) + `${cls.name.name}${ctx.sp}=${ctx.sp}${dec.name}(${args})(${cls.name.name});`;
      } else {
        result += ctx.nl + pad(ctx) + `${cls.name.name}${ctx.sp}=${ctx.sp}${dec.name}(${cls.name.name});`;
      }
    }
  }

  return result;
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

  const star = m.generator ? "*" : "";
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

  return `${prefix}${star}${name}(${params})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
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
  const disc = emitExpression(stmt.discriminant, ctx);
  const cases = stmt.cases.map((c) => {
    const caseInner = childScope(indented(inner));
    const header = c.test
      ? `${pad(inner)}case ${emitExpression(c.test, inner)}:`
      : `${pad(inner)}default:`;
    const body = c.consequent.map((s) => pad(caseInner) + emitStatement(s, caseInner)).join(ctx.nl);
    // Auto-break: Nodeon switch cases are block-scoped, no fall-through.
    // Skip if the last statement already exits (break/return/throw/continue).
    const last = c.consequent.length > 0 ? c.consequent[c.consequent.length - 1] : null;
    const exits = last && (last.type === "BreakStatement" || last.type === "ReturnStatement" || last.type === "ThrowStatement" || last.type === "ContinueStatement");
    const brk = exits ? "" : `${ctx.nl}${pad(caseInner)}break;`;
    // Wrap in { } block to give each case its own scope (prevents let TDZ errors)
    return `${header}${ctx.sp}{${ctx.nl}${body}${brk}${ctx.nl}${pad(inner)}}`;
  }).join(ctx.nl);
  return `switch${ctx.sp}(${disc})${ctx.sp}{${ctx.nl}${cases}${ctx.nl}${pad(ctx)}}`;
}

/**
 * Rewrite bare references to `from` into `to` throughout an expression.
 * A match guard such as `m > 10` is emitted against a hoisted slot so it can
 * be read before the branch body runs. Only *free* references are renamed:
 * `obj.m`, `{ m: 1 }` and `fn(m) { ... }` parameters must keep their own `m`.
 */
function renameBinding(expr: any, from: string, to: string): any {
  if (!expr || typeof expr !== "object") return expr;

  // Free identifier reference.
  if (expr.type === "Identifier" && expr.name === from) {
    return { ...expr, name: to };
  }

  // `obj.m` — the property name is not a reference to the binding.
  if (expr.type === "MemberExpression") {
    return { ...expr, object: renameBinding(expr.object, from, to) };
  }

  // Shorthand `{ m }` becomes `{ m: slot }`; `{ m: v }` keeps its key.
  if (expr.type === "ObjectExpression") {
    return {
      ...expr,
      properties: (expr.properties ?? []).map((p: any) => {
        if (p.spread) return p;
        const isKeyName =
          p.key && p.key.type === "Identifier" && p.key.name === from;
        if (p.shorthand && isKeyName) {
          return { ...p, shorthand: false, value: { type: "Identifier", name: to } };
        }
        return { ...p, value: renameBinding(p.value, from, to) };
      }),
    };
  }

  // `{ m = 1 }` default — the key is the binding name, the value may reference it.
  if (expr.type === "ObjectPattern") {
    return {
      ...expr,
      properties: (expr.properties ?? []).map((p: any) => ({
        ...p,
        value: p.value ? renameBinding(p.value, from, to) : p.value,
        defaultValue: p.defaultValue
          ? renameBinding(p.defaultValue, from, to)
          : p.defaultValue,
      })),
    };
  }

  // Array destructuring: `[m] = xs`.
  if (expr.type === "ArrayPattern") {
    return {
      ...expr,
      elements: (expr.elements ?? []).map((el: any) => renameBinding(el, from, to)),
    };
  }

  // A function introduces its own scope: do NOT rename its parameters, and do
  // not walk into its body.
  if (
    expr.type === "ArrowFunction" ||
    expr.type === "FunctionExpression" ||
    expr.type === "FunctionDeclaration"
  ) {
    return expr;
  }

  // Generic container rewrite.
  const clone: any = { ...expr };
  for (const key of Object.keys(clone)) {
    const value = clone[key];
    if (Array.isArray(value)) {
      clone[key] = value.map((v) => renameBinding(v, from, to));
    } else if (value && typeof value === "object" && "type" in value) {
      clone[key] = renameBinding(value, from, to);
    }
  }
  return clone;
}

function emitMatch(stmt: MatchStatement, ctx: GenContext): string {
  const disc = emitExpression(stmt.discriminant, ctx);
  const parts: string[] = [];
  // Hoisted `var` declarations for binding patterns, emitted before the chain.
  const slots: string[] = [];

  for (let i = 0; i < stmt.cases.length; i++) {
    const c = stmt.cases[i];
    const inner = childScope(indented(ctx));

    if (c.pattern === null) {
      // default case → else block
      const body = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      // A `default` may carry a guard (`default when x > 0 { ... }`). A bare
      // `else` cannot have a condition, so emit `else if (<guard>)`.
      if (c.guard) {
        parts.push(
          `${ctx.sp}else${ctx.sp}if${ctx.sp}(${emitExpression(c.guard, ctx)})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`,
        );
      } else {
        parts.push(`${ctx.sp}else${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`);
      }
    } else if (c.pattern.type === "CallExpression" && c.pattern.callee.type === "Identifier") {
      // ADT variant destructuring: case Circle(r) { ... } → if (disc.tag === "Circle") { const r = disc.radius ?? disc._0; ... }
      const variantName = c.pattern.callee.name;
      let cond = `${disc}.tag${ctx.sp}===${ctx.sp}"${variantName}"`;
      if (c.guard) {
        cond += `${ctx.sp}&&${ctx.sp}${emitExpression(c.guard, ctx)}`;
      }
      // Generate field bindings from the call arguments
      const bindings: string[] = [];
      for (let j = 0; j < c.pattern.arguments.length; j++) {
        const arg = c.pattern.arguments[j];
        if (arg.type === "Identifier") {
          // Try named field first, fall back to positional _N
          bindings.push(`${pad(inner)}const ${arg.name}${ctx.sp}=${ctx.sp}${disc}.${arg.name}${ctx.sp}!==${ctx.sp}undefined${ctx.sp}?${ctx.sp}${disc}.${arg.name}${ctx.sp}:${ctx.sp}${disc}._${j};`);
        }
      }
      const bodyStmts = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      const allBody = bindings.length > 0 ? bindings.join(ctx.nl) + ctx.nl + bodyStmts : bodyStmts;
      const keyword = i === 0 ? "if" : `${ctx.sp}else if`;
      parts.push(`${keyword}${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${allBody}${ctx.nl}${pad(ctx)}}`);
    } else if (c.pattern.type === "Identifier" && /^[A-Z]/.test(c.pattern.name)) {
      // Unit variant match: case Point { ... } → if (disc.tag === "Point") { ... }
      let cond = `${disc}.tag${ctx.sp}===${ctx.sp}"${c.pattern.name}"`;
      if (c.guard) {
        cond += `${ctx.sp}&&${ctx.sp}${emitExpression(c.guard, ctx)}`;
      }
      const body = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      const keyword = i === 0 ? "if" : `${ctx.sp}else if`;
      parts.push(`${keyword}${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`);
    } else if (c.pattern.type === "Identifier") {
      // Binding pattern: `case m when m > 10 { ... }` means "bind m to the
      // matched value, then test the guard".
      //
      // The guard must be able to SEE the binding, and the binding must not
      // leak into the next case. Declaring it inside the branch produced
      // `if (m > 10) { const m = n; }` — a use before declaration. Wrapping the
      // branch in a block to scope it swallows the `else` that a following
      // `default` needs, silently dropping that arm.
      //
      // Solution: a uniquely-named `var` hoisted to the top of the match, so
      // the if/else chain stays flat and every case can see its own binding.
      // `var` is function-scoped and hoists, which is exactly the semantics a
      // per-case binding needs here. The visible name is re-bound with
      // `let` inside the branch so the body still reads naturally.
      const binder = c.pattern.name;
      const slot = `_match${i}_${binder}`;
      const inner2 = childScope(indented(ctx));
      const keyword = i === 0 ? "if" : `${ctx.sp}else if`;
      slots.push(`${pad(indented(ctx))}var${ctx.sp}${slot};`);

      // The guard refers to the binding by its source name, so it must be
      // emitted against the slot — otherwise `m > 10` resolves to a `m` that
      // does not exist yet, giving a ReferenceError with no diagnostic.
      const guardFor = (e: Expression): string =>
        emitExpression(renameBinding(e, binder, slot), inner2);

      const bind = `${pad(inner2)}let${ctx.sp}${binder}${ctx.sp}=${ctx.sp}${slot};`;
      const body = c.body
        .map((s) => pad(inner2) + emitStatement(s, inner2))
        .join(ctx.nl);

      if (c.guard) {
        const cond = `(${slot} = ${disc})${ctx.sp}&&${ctx.sp}(${guardFor(c.guard)})`;
        parts.push(
          `${keyword}${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${bind}${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`,
        );
      } else {
        parts.push(
          `${keyword}${ctx.sp}(true)${ctx.sp}{${ctx.nl}${bind}${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`,
        );
      }
    } else {
      // Literal / expression pattern.
      let cond = `${disc}${ctx.sp}===${ctx.sp}${emitExpression(c.pattern, ctx)}`;
      if (c.guard) {
        cond += `${ctx.sp}&&${ctx.sp}${emitExpression(c.guard, ctx)}`;
      }
      const body = c.body.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
      const keyword = i === 0 ? "if" : `${ctx.sp}else if`;
      parts.push(`${keyword}${ctx.sp}(${cond})${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`);
    }
  }

  if (slots.length > 0) {
    return slots.join(ctx.nl) + ctx.nl + parts.join("");
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

function emitADT(stmt: any, ctx: GenContext): string {
  const parts: string[] = [];
  const variantNames: string[] = [];

  for (const variant of stmt.variants) {
    const vName = variant.name.name;
    variantNames.push(vName);

    if (variant.fields.length === 0) {
      // Unit variant: const Point = Object.freeze({ tag: "Point" });
      parts.push(`class ${vName}${ctx.sp}{${ctx.nl}${pad(indented(ctx))}constructor()${ctx.sp}{${ctx.nl}${pad(indented(indented(ctx)))}this.tag${ctx.sp}=${ctx.sp}"${vName}";${ctx.nl}${pad(indented(ctx))}}${ctx.nl}${pad(ctx)}}`);
    } else {
      // Variant with fields
      const inner = indented(ctx);
      const inner2 = indented(inner);
      const fieldNames: string[] = [];
      for (let i = 0; i < variant.fields.length; i++) {
        const f = variant.fields[i];
        fieldNames.push(f.name ? f.name.name : `_${i}`);
      }
      const params = fieldNames.join("," + ctx.sp);
      const assignments = fieldNames.map((fn: string) =>
        `${pad(inner2)}this.${fn}${ctx.sp}=${ctx.sp}${fn};`
      ).join(ctx.nl);
      parts.push(`class ${vName}${ctx.sp}{${ctx.nl}${pad(inner)}constructor(${params})${ctx.sp}{${ctx.nl}${pad(inner2)}this.tag${ctx.sp}=${ctx.sp}"${vName}";${ctx.nl}${assignments}${ctx.nl}${pad(inner)}}${ctx.nl}${pad(ctx)}}`);
    }
  }

  // Namespace object: const Shape = { Circle, Rectangle, Point };
  const nsProps = variantNames.join("," + ctx.sp);
  parts.push(`const ${stmt.name.name}${ctx.sp}=${ctx.sp}{${nsProps}};`);

  return parts.join(ctx.nl);
}

function emitGo(stmt: any, ctx: GenContext): string {
  if (stmt.body) {
    // go { ... } → queueMicrotask(() => { ... })
    const inner = indented(ctx);
    const body = stmt.body.map((s: any) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
    return `queueMicrotask(()${ctx.sp}=>${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}});`;
  }
  // go expr → queueMicrotask(() => expr)
  const expr = emitExpression(stmt.expression, ctx);
  return `queueMicrotask(()${ctx.sp}=>${ctx.sp}${expr});`;
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
    case "FunctionExpression":
      // Anonymous `fn(a) { ... }`.
      // A generator cannot be an arrow, so `fn*` lowers to `function*`.
      // The expression-body form `fn(a) = expr` is stored as a single
      // ExpressionStatement and must be returned, matching how a named
      // `fn f(a) = expr` declaration is emitted.
      if (expr.generator) {
        const fparams = (expr as any).params.map((p: any) => emitParam(p, ctx)).join("," + ctx.sp);
        const stmts = (expr as any).body as Statement[];
        const inner = indented(ctx);
        const fbody = stmts.map((s) => pad(inner) + emitStatement(s, inner)).join(ctx.nl);
        return `function*${ctx.sp}(${fparams})${ctx.sp}{${ctx.nl}${fbody}${ctx.nl}${pad(ctx)}}`;
      }
      return emitFunctionExpression(expr as any, ctx);
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
      // A ternary's condition binds looser than any binary operator, so a
      // binary condition must be parenthesised: `(a || b) ?? c` emitted as
      // `a || b ?? c` is a JavaScript SyntaxError. The arms are assignments
      // (right-associative), so they keep their parens only when they are
      // themselves ternaries.
      return `${emitTernaryOperand(expr.condition, ctx)}${ctx.sp}?${ctx.sp}${emitTernaryArm(expr.consequent, ctx)}${ctx.sp}:${ctx.sp}${emitTernaryArm(expr.alternate, ctx)}`;
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
    case "AsExpression":
      return emitExpression(expr.expression, ctx); // type-only — strip assertion
    case "ComptimeExpression": {
      // Evaluate at compile time and replace with result literal
      let code: string;
      if (expr.body) {
        // comptime { stmts... } — wrap in IIFE for multi-statement evaluation
        const stmts = expr.body.map((s: any) => emitStatement(s, ctx));
        if (stmts.length > 0) {
          const init = stmts.slice(0, -1).join("\n");
          const last = stmts[stmts.length - 1].trim().replace(/;$/, "");
          code = init + (init ? "\n" : "") + "return " + last + ";";
        } else {
          code = "return undefined;";
        }
        try {
          const result = new Function(code)();
          return comptimeSerialize(result);
        } catch (e: any) {
          throw new Error(`comptime evaluation failed: ${e.message}`);
        }
      } else {
        code = emitExpression(expr.expression!, ctx);
        try {
          const result = new Function(`return (${code})`)();
          return comptimeSerialize(result);
        } catch (e: any) {
          throw new Error(`comptime evaluation failed: ${e.message}`);
        }
      }
    }
    case "IfExpression": {
      // Compile to IIFE: (() => { if (cond) { ... return last; } else { ... return last; } })()
      const cond = emitExpression(expr.condition, ctx);
      const thenStmts = expr.consequent.map((s: any) => emitStatement(s, ctx));
      const elseStmts = expr.alternate.map((s: any) => emitStatement(s, ctx));
      // Make last statement in each branch a return
      const wrapReturn = (stmts: string[]) => {
        if (stmts.length === 0) return ["return undefined;"];
        const last = stmts[stmts.length - 1];
        // If last statement doesn't already start with return, wrap it
        const trimmed = last.trim();
        if (!trimmed.startsWith("return ") && !trimmed.startsWith("return;")) {
          stmts[stmts.length - 1] = `return ${trimmed}`;
        }
        return stmts;
      };
      const thenBody = wrapReturn([...thenStmts]).join("; ");
      const elseBody = wrapReturn([...elseStmts]).join("; ");
      return `(() => { if${ctx.sp}(${cond})${ctx.sp}{ ${thenBody} }${ctx.sp}else${ctx.sp}{ ${elseBody} } })()`;
    }
    default:
      throw new Error(`Unsupported expression type: ${(expr as any).type}`);
  }
}

function emitLiteral(lit: Literal): string {
  switch (lit.literalType) {
    case "number": return String(lit.value);
    // A BigInt must keep its `n` suffix: `String(123n)` is "123", so emitting
    // the bare value would silently turn a BigInt into a Number.
    case "bigint": return `${String(lit.value)}n`;
    case "string": return JSON.stringify(lit.value);
    case "boolean": return String(lit.value);
    case "null": return "null";
    case "undefined": return "undefined";
    default: return String(lit.value);
  }
}

function comptimeSerialize(result: any): string {
  if (result === undefined) return "undefined";
  if (result === null) return "null";
  if (typeof result === "string") return JSON.stringify(result);
  if (typeof result === "number" || typeof result === "boolean") return String(result);
  if (Array.isArray(result)) return JSON.stringify(result);
  if (typeof result === "object") return JSON.stringify(result);
  return String(result);
}

function emitCall(call: CallExpression, ctx: GenContext): string {
  let callee: string;
  if (call.callee.type === "Identifier" && call.callee.name === "print") {
    callee = "console.log";
  } else {
    callee = emitExpression(call.callee, ctx);
  }
  const allArgs: string[] = call.arguments.map((a) => emitExpression(a, ctx));
  // Named arguments → trailing object literal
  if (call.namedArgs && call.namedArgs.length > 0) {
    const props = call.namedArgs.map((na: any) => {
      const key = na.name.name;
      const val = emitExpression(na.value, ctx);
      return `${key}:${ctx.sp}${val}`;
    }).join("," + ctx.sp);
    allArgs.push(`{${props}}`);
  }
  const argsStr = allArgs.join("," + ctx.sp);
  if (call.optional) return `${callee}?.(${argsStr})`;
  return `${callee}(${argsStr})`;
}

function emitBinary(bin: BinaryExpression, ctx: GenContext): string {
  // Pipe operator: a |> fn  → fn(a)
  if (bin.operator === "|>") {
    const arg = emitExpression(bin.left, ctx);
    const fn = emitExpression(bin.right, ctx);
    return `${fn}(${arg})`;
  }

  // String multiply: "ha" * 3 → "ha".repeat(3)
  if (bin.operator === "*") {
    const isLeftString = bin.left.type === "Literal" && bin.left.literalType === "string"
      || bin.left.type === "TemplateLiteral";
    const isRightString = bin.right.type === "Literal" && bin.right.literalType === "string"
      || bin.right.type === "TemplateLiteral";
    if (isLeftString) {
      return `${emitExpression(bin.left, ctx)}.repeat(${emitExpression(bin.right, ctx)})`;
    }
    if (isRightString) {
      return `${emitExpression(bin.right, ctx)}.repeat(${emitExpression(bin.left, ctx)})`;
    }
  }

  // Nodeon == compiles to JS ===, and != to !==
  let op = bin.operator;
  if (op === "==") op = "===";
  else if (op === "!=") op = "!==";

  // Range operator (..) is only valid inside for loops (handled at ForStatement level)
  if (bin.operator === "..") {
    throw new Error("Range operator '..' can only be used inside 'for' loops (e.g., for i in 0..10)");
  }

  const left = parenthesizeIfNeeded(bin.left, bin.operator, "left", ctx);
  const right = parenthesizeIfNeeded(bin.right, bin.operator, "right", ctx);
  return `${left}${ctx.sp}${op}${ctx.sp}${right}`;
}

// Operators whose right operand must keep its parentheses even at EQUAL
// precedence, because they are left-associative: `a - (b - c)` is not
// `a - b - c`. Everything else only needs parens when strictly lower.
const RIGHT_ASSOC_OPS = new Set(["-", "/", "%", "**"]);

/**
 * Emit a child expression, adding parentheses when precedence requires them.
 * `side` matters: for a left-associative operator the RIGHT child needs
 * parentheses at equal precedence, the left child does not.
 */
/** A ternary condition needs parens around any binary/logical expression. */
function emitTernaryOperand(e: Expression, ctx: GenContext): string {
  const inner = emitExpression(e, ctx);
  if (
    e.type === "BinaryExpression" ||
    e.type === "AssignmentExpression" ||
    e.type === "CompoundAssignmentExpression"
  ) {
    return `(${inner})`;
  }
  return inner;
}

/** A ternary arm is right-associative; only a nested ternary needs parens. */
function emitTernaryArm(e: Expression, ctx: GenContext): string {
  const inner = emitExpression(e, ctx);
  return e.type === "TernaryExpression" ? `(${inner})` : inner;
}

function parenthesizeIfNeeded(
  expr: Expression,
  parentOp: string,
  side: "left" | "right",
  ctx: GenContext,
): string {
  if (expr.type !== "BinaryExpression") return emitExpression(expr, ctx);
  const parentPrec = BIN_PRECEDENCE[parentOp] ?? 0;
  const childPrec = BIN_PRECEDENCE[expr.operator] ?? 0;
  const inner = emitBinary(expr, ctx);

  // `??` may not be mixed with `||`/`&&` without parentheses, even when the
  // precedence numbers would allow it: `a || b ?? c` is a JavaScript
  // SyntaxError, not a slow path.
  if (
    (parentOp === "??" && (expr.operator === "||" || expr.operator === "&&")) ||
    (expr.operator === "??" && (parentOp === "||" || parentOp === "&&"))
  ) {
    return `(${inner})`;
  }

  const needsParens =
    childPrec < parentPrec ||
    (side === "right" && childPrec === parentPrec && RIGHT_ASSOC_OPS.has(parentOp));
  return needsParens ? `(${inner})` : inner;
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
    // Array slicing: arr[1..3] → arr.slice(1, 3)
    if (m.property.type === "BinaryExpression" && m.property.operator === "..") {
      const start = emitExpression(m.property.left, ctx);
      const end = emitExpression(m.property.right, ctx);
      const dot = m.optional ? "?." : ".";
      return `${obj}${dot}slice(${start},${ctx.sp}${end})`;
    }
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
    // Object spread: { ...src } — the value is emitted bare, no key.
    if ((p as any).spread) return `...${emitExpression(p.value, ctx)}`;
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

// Anonymous `fn(...)` expression. Unlike ArrowFunction it honours the
// language's implicit-return rule: a body that is a single bare expression
// returns its value, exactly as a named `fn f(a) = expr` does.
function emitFunctionExpression(fn: any, ctx: GenContext): string {
  const params = fn.params.map((p: any) => emitParam(p, ctx)).join("," + ctx.sp);
  const paramStr = fn.params.length === 1 && !fn.params[0].rest && !fn.params[0].defaultValue
    ? fn.params[0].name
    : `(${params})`;
  const stmts: Statement[] = fn.body ?? [];
  const last = stmts[stmts.length - 1];
  const retLast = fn.implicitReturn && last && last.type === "ExpressionStatement";

  const inner = indented(ctx);
  const body = stmts
    .map((s, i) => {
      const isLast = i === stmts.length - 1;
      if (retLast && isLast) {
        return pad(inner) + `return${ctx.sp}` + emitExpression((s as any).expression, inner) + ";";
      }
      return pad(inner) + emitStatement(s, inner);
    })
    .join(ctx.nl);

  return `${paramStr}${ctx.sp}=>${ctx.sp}{${ctx.nl}${body}${ctx.nl}${pad(ctx)}}`;
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

  // An object literal as an arrow body MUST be parenthesised: `x => { a: 1 }`
  // is a block in JavaScript, and the braces make `...spread` a syntax error.
  const bodyExpr = fn.body as Expression;
  if (bodyExpr && bodyExpr.type === "ObjectExpression") {
    return `${async}${paramStr}${ctx.sp}=>${ctx.sp}(${emitExpression(bodyExpr, ctx)})`;
  }

  return `${async}${paramStr}${ctx.sp}=>${ctx.sp}${emitExpression(bodyExpr, ctx)}`;
}

function emitNew(n: NewExpression, ctx: GenContext): string {
  const callee = emitExpression(n.callee, ctx);
  const args = n.arguments.map((a) => emitExpression(a, ctx)).join("," + ctx.sp);
  return `new ${callee}(${args})`;
}
