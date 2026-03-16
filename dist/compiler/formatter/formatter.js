export function format(program, opts) {
  const options = { indentSize: opts?.indentSize ?? 2, maxLineWidth: opts?.maxLineWidth ?? 100 };
  const ctx = { indent: 0, options: options };
  const lines = program.body.map(stmt => fmtStatement(stmt, ctx));
  return lines.join("\n") + "\n";
}
function pad(ctx) {
  return " ".repeat(ctx.indent * ctx.options.indentSize);
}
function indented(ctx) {
  return { indent: ctx.indent + 1, options: ctx.options };
}
function fmtStatement(stmt, ctx) {
  switch (stmt.type) {
    case "FunctionDeclaration": {
      return fmtFunction(stmt, ctx);
    }
    case "VariableDeclaration": {
      return fmtVariable(stmt, ctx);
    }
    case "DestructuringDeclaration": {
      return fmtDestructuring(stmt, ctx);
    }
    case "ExpressionStatement": {
      return pad(ctx) + fmtExpression(stmt.expression, ctx);
    }
    case "IfStatement": {
      return fmtIf(stmt, ctx);
    }
    case "ForStatement": {
      return fmtFor(stmt, ctx);
    }
    case "WhileStatement": {
      return fmtWhile(stmt, ctx);
    }
    case "DoWhileStatement": {
      return fmtDoWhile(stmt, ctx);
    }
    case "ReturnStatement": {
      return fmtReturn(stmt, ctx);
    }
    case "ImportDeclaration": {
      return fmtImport(stmt, ctx);
    }
    case "ExportDeclaration": {
      return fmtExport(stmt, ctx);
    }
    case "ClassDeclaration": {
      return fmtClass(stmt, ctx);
    }
    case "TryCatchStatement": {
      return fmtTryCatch(stmt, ctx);
    }
    case "ThrowStatement": {
      return pad(ctx) + "throw " + fmtExpression(stmt.value, ctx);
    }
    case "SwitchStatement": {
      return fmtSwitch(stmt, ctx);
    }
    case "MatchStatement": {
      return fmtMatch(stmt, ctx);
    }
    case "EnumDeclaration": {
      return fmtEnum(stmt, ctx);
    }
    case "InterfaceDeclaration": {
      return fmtInterface(stmt, ctx);
    }
    case "TypeAliasDeclaration": {
      return fmtTypeAlias(stmt, ctx);
    }
    case "ADTDeclaration": {
      return fmtADT(stmt, ctx);
    }
    case "GoStatement": {
      return fmtGo(stmt, ctx);
    }
    case "BreakStatement": {
      return pad(ctx) + "break" + stmt.label ? " " + stmt.label : "";
    }
    case "ContinueStatement": {
      return pad(ctx) + "continue" + stmt.label ? " " + stmt.label : "";
    }
    case "DebuggerStatement": {
      return pad(ctx) + "debugger";
    }
    case "LabeledStatement": {
      return pad(ctx) + stmt.label + ":\n" + fmtStatement(stmt.body, ctx);
    }
    default: {
      return pad(ctx) + "/* unsupported: " + stmt.type + " */";
    }
  }
}
function fmtFunction(f, ctx) {
  const inner = indented(ctx);
  const prefix = f.async ? "async " : "";
  const gen = f.generator ? "*" : "";
  const typeParams = f.typeParams ? "<" + f.typeParams.join(", ") + ">" : "";
  const params = f.params.map(p => fmtParam(p)).join(", ");
  const ret = f.returnType ? ": " + fmtType(f.returnType) : "";
  const body = f.body.map(s => fmtStatement(s, inner)).join("\n");
  let decs = "";
  if (f.decorators && f.decorators.length > 0) {
    decs = f.decorators.map(d => {
      const args = d.arguments ? "(" + d.arguments.map(a => fmtExpression(a, ctx)).join(", ") + ")" : "";
      return pad(ctx) + "@" + d.name + args;
    }).join("\n") + "\n";
  }
  return decs + pad(ctx) + prefix + "fn" + gen + " " + f.name.name + typeParams + "(" + params + ")" + ret + ` {
` + body + "\n" + pad(ctx) + "}";
}
function fmtParam(p) {
  let out = "";
  if (p.rest) {
    out = out + "...";
  }
  if (p.pattern) {
    out = out + fmtPattern(p.pattern);
  } else {
    out = out + p.name;
  }
  if (p.typeAnnotation) {
    out = out + ": " + fmtType(p.typeAnnotation);
  }
  if (p.defaultValue) {
    out = out + " = " + fmtExpression(p.defaultValue, { indent: 0, options: { indentSize: 2, maxLineWidth: 100 } });
  }
  return out;
}
function fmtVariable(v, ctx) {
  const typeStr = v.typeAnnotation ? ": " + fmtType(v.typeAnnotation) : "";
  return pad(ctx) + v.kind + " " + v.name.name + typeStr + " = " + fmtExpression(v.value, ctx);
}
function fmtDestructuring(d, ctx) {
  const pat = fmtPattern(d.pattern);
  return pad(ctx) + d.kind + " " + pat + " = " + fmtExpression(d.value, ctx);
}
function fmtIf(stmt, ctx) {
  const inner = indented(ctx);
  const cond = fmtExpression(stmt.condition, ctx);
  const body = stmt.consequent.map(s => fmtStatement(s, inner)).join("\n");
  let out = pad(ctx) + "if " + cond + ` {
` + body + "\n" + pad(ctx) + "}";
  if (stmt.alternate && stmt.alternate.length > 0) {
    if (stmt.alternate.length === 1 && stmt.alternate[0].type === "IfStatement") {
      const elseIf = fmtIf(stmt.alternate[0], ctx);
      out = out + " else " + elseIf.trimStart();
    } else {
      const alt = stmt.alternate.map(s => fmtStatement(s, inner)).join("\n");
      out = out + ` else {
` + alt + "\n" + pad(ctx) + "}";
    }
  }
  return out;
}
function fmtFor(stmt, ctx) {
  const inner = indented(ctx);
  let variable = "";
  if (stmt.variable.type === "Identifier") {
    variable = stmt.variable.name;
  } else {
    variable = fmtPattern(stmt.variable);
  }
  let iterable = "";
  if (stmt.iterable.type === "BinaryExpression" && stmt.iterable.operator === "..") {
    iterable = fmtExpression(stmt.iterable.left, ctx) + ".." + fmtExpression(stmt.iterable.right, ctx);
  } else {
    iterable = fmtExpression(stmt.iterable, ctx);
  }
  const body = stmt.body.map(s => fmtStatement(s, inner)).join("\n");
  return pad(ctx) + "for " + variable + " " + stmt.kind + " " + iterable + ` {
` + body + "\n" + pad(ctx) + "}";
}
function fmtWhile(stmt, ctx) {
  const inner = indented(ctx);
  const body = stmt.body.map(s => fmtStatement(s, inner)).join("\n");
  return pad(ctx) + "while " + fmtExpression(stmt.condition, ctx) + ` {
` + body + "\n" + pad(ctx) + "}";
}
function fmtDoWhile(stmt, ctx) {
  const inner = indented(ctx);
  const body = stmt.body.map(s => fmtStatement(s, inner)).join("\n");
  return pad(ctx) + `do {
` + body + "\n" + pad(ctx) + "} while " + fmtExpression(stmt.condition, ctx);
}
function fmtReturn(stmt, ctx) {
  if (!stmt.value) {
    return pad(ctx) + "return";
  }
  return pad(ctx) + "return " + fmtExpression(stmt.value, ctx);
}
function fmtImport(stmt, ctx) {
  const src = "'" + stmt.source + "'";
  if (stmt.namedImports.length > 0) {
    const specs = stmt.namedImports.map(s => s.alias ? s.name + " as " + s.alias : s.name).join(", ");
    return pad(ctx) + "import " + "{ " + specs + " }" + " from " + src;
  }
  if (stmt.namespaceImport) {
    return pad(ctx) + "import * as " + stmt.namespaceImport + " from " + src;
  }
  return pad(ctx) + "import " + stmt.defaultImport + " from " + src;
}
function fmtExport(stmt, ctx) {
  if (stmt.exportAll) {
    const alias = stmt.exportAllAlias ? " as " + stmt.exportAllAlias : "";
    return pad(ctx) + "export *" + alias + " from '" + stmt.source + "'";
  }
  if (stmt.namedExports && stmt.namedExports.length > 0) {
    const specs = stmt.namedExports.map(s => s.alias ? s.name + " as " + s.alias : s.name).join(", ");
    const fromClause = stmt.source ? " from '" + stmt.source + "'" : "";
    return pad(ctx) + "export " + "{ " + specs + " }" + fromClause;
  }
  const def = stmt.isDefault ? "default " : "";
  if (stmt.declaration) {
    return pad(ctx) + "export " + def + fmtStatement(stmt.declaration, { indent: 0, options: ctx.options }).trimStart();
  }
  return pad(ctx) + "export " + def;
}
function fmtClass(cls, ctx) {
  const inner = indented(ctx);
  const typeParams = cls.typeParams ? "<" + cls.typeParams.join(", ") + ">" : "";
  const ext = cls.superClass ? " extends " + cls.superClass.name : "";
  const members = cls.body.map(m => fmtClassMember(m, inner)).join("\n\n");
  let decs = "";
  if (cls.decorators && cls.decorators.length > 0) {
    decs = cls.decorators.map(d => {
      const args = d.arguments ? "(" + d.arguments.map(a => fmtExpression(a, ctx)).join(", ") + ")" : "";
      return pad(ctx) + "@" + d.name + args;
    }).join("\n") + "\n";
  }
  return decs + pad(ctx) + "class " + cls.name.name + typeParams + ext + ` {
` + members + "\n" + pad(ctx) + "}";
}
function fmtClassMember(member, ctx) {
  if (member.type === "ClassField") {
    const s = member.static ? "static " : "";
    const key = member.computed ? "[" + fmtExpression(member.name, ctx) + "]" : member.name.name;
    if (member.value) {
      return pad(ctx) + s + key + " = " + fmtExpression(member.value, ctx);
    }
    return pad(ctx) + s + key;
  }
  const inner = indented(ctx);
  const s = member.static ? "static " : "";
  const a = member.async ? "async " : "";
  const gen = member.generator ? "*" : "";
  const key = member.computed ? "[" + fmtExpression(member.name, ctx) + "]" : member.name.name;
  const kindPrefix = member.kind === "get" ? "get " : member.kind === "set" ? "set " : "";
  const params = member.params.map(p => fmtParam(p)).join(", ");
  const ret = member.returnType ? ": " + fmtType(member.returnType) : "";
  const body = member.body.map(st => fmtStatement(st, inner)).join("\n");
  if (member.kind === "constructor") {
    return pad(ctx) + "constructor(" + params + `) {
` + body + "\n" + pad(ctx) + "}";
  }
  return pad(ctx) + s + a + kindPrefix + "fn" + gen + " " + key + "(" + params + ")" + ret + ` {
` + body + "\n" + pad(ctx) + "}";
}
function fmtTryCatch(stmt, ctx) {
  const inner = indented(ctx);
  const tryBody = stmt.tryBlock.map(s => fmtStatement(s, inner)).join("\n");
  const catchParam = stmt.catchParam ? " (" + stmt.catchParam.name + ")" : "";
  const catchBody = stmt.catchBlock.map(s => fmtStatement(s, inner)).join("\n");
  let out = pad(ctx) + `try {
` + tryBody + "\n" + pad(ctx) + "}" + " catch" + catchParam + ` {
` + catchBody + "\n" + pad(ctx) + "}";
  if (stmt.finallyBlock) {
    const finallyBody = stmt.finallyBlock.map(s => fmtStatement(s, inner)).join("\n");
    out = out + ` finally {
` + finallyBody + "\n" + pad(ctx) + "}";
  }
  return out;
}
function fmtSwitch(stmt, ctx) {
  const inner = indented(ctx);
  const cases = stmt.cases.map(c => fmtSwitchCase(c, inner)).join("\n");
  return pad(ctx) + "switch " + fmtExpression(stmt.discriminant, ctx) + ` {
` + cases + "\n" + pad(ctx) + "}";
}
function fmtSwitchCase(c, ctx) {
  const inner = indented(ctx);
  const header = c.test ? "case " + fmtExpression(c.test, ctx) : "default";
  const body = c.consequent.map(s => fmtStatement(s, inner)).join("\n");
  return pad(ctx) + header + ` {
` + body + "\n" + pad(ctx) + "}";
}
function fmtMatch(stmt, ctx) {
  const inner = indented(ctx);
  const cases = stmt.cases.map(c => fmtMatchCase(c, inner)).join("\n");
  return pad(ctx) + "match " + fmtExpression(stmt.discriminant, ctx) + ` {
` + cases + "\n" + pad(ctx) + "}";
}
function fmtMatchCase(c, ctx) {
  const inner = indented(ctx);
  const header = c.pattern ? "case " + fmtExpression(c.pattern, ctx) : "default";
  const guard = c.guard ? " if " + fmtExpression(c.guard, ctx) : "";
  const body = c.body.map(s => fmtStatement(s, inner)).join("\n");
  return pad(ctx) + header + guard + ` {
` + body + "\n" + pad(ctx) + "}";
}
function fmtEnum(stmt, ctx) {
  const inner = indented(ctx);
  const members = stmt.members.map(m => {
    if (m.value) {
      return pad(inner) + m.name.name + " = " + fmtExpression(m.value, inner);
    }
    return pad(inner) + m.name.name;
  }).join("\n");
  return pad(ctx) + "enum " + stmt.name.name + ` {
` + members + "\n" + pad(ctx) + "}";
}
function fmtInterface(stmt, ctx) {
  const inner = indented(ctx);
  const ext = stmt.extends ? " extends " + stmt.extends.map(e => e.name).join(", ") : "";
  const props = stmt.properties.map(p => {
    const opt = p.optional ? "?" : "";
    if (p.method) {
      const params = p.params ? p.params.map(t => fmtType(t)).join(", ") : "";
      return pad(inner) + p.name.name + opt + "(" + params + "): " + fmtType(p.valueType);
    }
    return pad(inner) + p.name.name + opt + ": " + fmtType(p.valueType);
  }).join("\n");
  return pad(ctx) + "interface " + stmt.name.name + ext + ` {
` + props + "\n" + pad(ctx) + "}";
}
function fmtTypeAlias(stmt, ctx) {
  const typeParams = stmt.typeParams ? "<" + stmt.typeParams.join(", ") + ">" : "";
  return pad(ctx) + "type " + stmt.name.name + typeParams + " = " + fmtType(stmt.value);
}
function fmtADT(stmt, ctx) {
  const typeParams = stmt.typeParams ? "<" + stmt.typeParams.join(", ") + ">" : "";
  const variants = stmt.variants.map(v => {
    if (v.fields.length === 0) {
      return v.name.name;
    }
    const fields = v.fields.map(f => {
      if (f.name) {
        return f.name.name + ": " + fmtType(f.typeAnnotation);
      }
      return fmtType(f.typeAnnotation);
    }).join(", ");
    return v.name.name + "(" + fields + ")";
  }).join(" | ");
  return pad(ctx) + "type " + stmt.name.name + typeParams + " = " + variants;
}
function fmtGo(stmt, ctx) {
  if (stmt.body) {
    const inner = indented(ctx);
    const body = stmt.body.map(s => fmtStatement(s, inner)).join("\n");
    return pad(ctx) + `go {
` + body + "\n" + pad(ctx) + "}";
  }
  return pad(ctx) + "go " + fmtExpression(stmt.expression, ctx);
}
function fmtExpression(expr, ctx) {
  switch (expr.type) {
    case "Identifier": {
      return expr.name;
    }
    case "Literal": {
      return fmtLiteral(expr);
    }
    case "CallExpression": {
      return fmtCall(expr, ctx);
    }
    case "BinaryExpression": {
      return fmtBinary(expr, ctx);
    }
    case "UnaryExpression": {
      return expr.operator + fmtExpression(expr.argument, ctx);
    }
    case "UpdateExpression": {
      if (expr.prefix) {
        return expr.operator + fmtExpression(expr.argument, ctx);
      }
      return fmtExpression(expr.argument, ctx) + expr.operator;
    }
    case "TemplateLiteral": {
      return fmtTemplate(expr, ctx);
    }
    case "MemberExpression": {
      return fmtMember(expr, ctx);
    }
    case "ArrayExpression": {
      return fmtArray(expr, ctx);
    }
    case "ObjectExpression": {
      return fmtObject(expr, ctx);
    }
    case "ArrowFunction": {
      return fmtArrow(expr, ctx);
    }
    case "AssignmentExpression": {
      return fmtExpression(expr.left, ctx) + " = " + fmtExpression(expr.right, ctx);
    }
    case "CompoundAssignmentExpression": {
      return fmtExpression(expr.left, ctx) + " " + expr.operator + " " + fmtExpression(expr.right, ctx);
    }
    case "NewExpression": {
      const args = expr.arguments.map(a => fmtExpression(a, ctx)).join(", ");
      return "new " + fmtExpression(expr.callee, ctx) + "(" + args + ")";
    }
    case "AwaitExpression": {
      return "await " + fmtExpression(expr.argument, ctx);
    }
    case "SpreadExpression": {
      return "..." + fmtExpression(expr.argument, ctx);
    }
    case "TernaryExpression": {
      return fmtExpression(expr.condition, ctx) + " ? " + fmtExpression(expr.consequent, ctx) + " : " + fmtExpression(expr.alternate, ctx);
    }
    case "TypeofExpression": {
      return "typeof " + fmtExpression(expr.argument, ctx);
    }
    case "VoidExpression": {
      return "void " + fmtExpression(expr.argument, ctx);
    }
    case "DeleteExpression": {
      return "delete " + fmtExpression(expr.argument, ctx);
    }
    case "YieldExpression": {
      const del = expr.delegate ? "*" : "";
      if (!expr.argument) {
        return "yield" + del;
      }
      return "yield" + del + " " + fmtExpression(expr.argument, ctx);
    }
    case "AsExpression": {
      return fmtExpression(expr.expression, ctx) + " as " + fmtType(expr.typeAnnotation);
    }
    case "ComptimeExpression": {
      if (expr.body) {
        const inner = indented(ctx);
        const body = expr.body.map(s => fmtStatement(s, inner)).join("\n");
        return `comptime {
` + body + "\n" + pad(ctx) + "}";
      }
      return "comptime " + fmtExpression(expr.expression, ctx);
    }
    case "IfExpression": {
      const inner = indented(ctx);
      const cond = fmtExpression(expr.condition, ctx);
      const thenBody = expr.consequent.map(s => fmtStatement(s, inner)).join("\n");
      const elseBody = expr.alternate.map(s => fmtStatement(s, inner)).join("\n");
      return "if " + cond + ` {
` + thenBody + "\n" + pad(ctx) + `} else {
` + elseBody + "\n" + pad(ctx) + "}";
    }
    case "RegExpLiteral": {
      return expr.flags ? "/" + expr.pattern + "/" + expr.flags : "/" + expr.pattern + "/";
    }
    case "ObjectPattern": {
      return fmtPattern(expr);
    }
    case "ArrayPattern": {
      return fmtPattern(expr);
    }
    default: {
      return "/* unsupported: " + expr.type + " */";
    }
  }
}
function fmtLiteral(lit) {
  switch (lit.literalType) {
    case "number": {
      return String(lit.value);
    }
    case "string": {
      const escaped = String(lit.value).replace(/"/g, "\\\"");
      return "\"" + escaped + "\"";
    }
    case "boolean": {
      return String(lit.value);
    }
    case "null": {
      return "null";
    }
    case "undefined": {
      return "undefined";
    }
    default: {
      return String(lit.value);
    }
  }
}
function fmtCall(call, ctx) {
  const callee = fmtExpression(call.callee, ctx);
  const chain = call.optional ? "?." : "";
  const parts = call.arguments.map(a => fmtExpression(a, ctx));
  if (call.namedArgs && call.namedArgs.length > 0) {
    for (const na of call.namedArgs) {
      parts.push(na.name.name + ": " + fmtExpression(na.value, ctx));
    }
  }
  return callee + chain + "(" + parts.join(", ") + ")";
}
function fmtBinary(bin, ctx) {
  const left = fmtExpression(bin.left, ctx);
  const right = fmtExpression(bin.right, ctx);
  return left + " " + bin.operator + " " + right;
}
function fmtMember(mem, ctx) {
  const obj = fmtExpression(mem.object, ctx);
  const chain = mem.optional ? "?." : "";
  if (mem.computed) {
    return obj + chain + "[" + fmtExpression(mem.property, ctx) + "]";
  }
  const prop = fmtExpression(mem.property, ctx);
  return obj + chain + chain ? "" : "." + prop;
}
function fmtArray(arr, ctx) {
  const els = arr.elements.map(e => fmtExpression(e, ctx)).join(", ");
  return "[" + els + "]";
}
function fmtObject(obj, ctx) {
  if (obj.properties.length === 0) {
    return "{}";
  }
  const props = obj.properties.map(p => fmtObjectProp(p, ctx)).join(", ");
  return "{ " + props + " }";
}
function fmtObjectProp(prop, ctx) {
  if (prop.shorthand) {
    return fmtExpression(prop.key, ctx);
  }
  let keyStr = "";
  if (prop.computed) {
    keyStr = "[" + fmtExpression(prop.key, ctx) + "]";
  } else {
    keyStr = fmtExpression(prop.key, ctx);
  }
  return keyStr + ": " + fmtExpression(prop.value, ctx);
}
function fmtArrow(f, ctx) {
  const prefix = f.async ? "async " : "";
  const params = f.params.map(p => fmtParam(p)).join(", ");
  const ret = f.returnType ? ": " + fmtType(f.returnType) : "";
  if (Array.isArray(f.body)) {
    const inner = indented(ctx);
    const body = f.body.map(s => fmtStatement(s, inner)).join("\n");
    return prefix + "(" + params + ")" + ret + ` => {
` + body + "\n" + pad(ctx) + "}";
  }
  return prefix + "(" + params + ")" + ret + " => " + fmtExpression(f.body, ctx);
}
function fmtTemplate(tmpl, ctx) {
  let out = "`";
  for (const part of tmpl.parts) {
    if (part.kind === "Text") {
      out = out + part.value;
    } else {
      out = out + "${" + fmtExpression(part.expression, ctx) + "}";
    }
  }
  out = out + "`";
  return out;
}
function fmtPattern(pat) {
  if (pat.type === "ObjectPattern") {
    const props = pat.properties.map(p => {
      if (p.shorthand) {
        return p.key.name;
      }
      const val = p.value.type === "Identifier" ? p.value.name : fmtPattern(p.value);
      let out = p.key.name + ": " + val;
      if (p.defaultValue) {
        out = out + " = " + fmtExpression(p.defaultValue, { indent: 0, options: { indentSize: 2, maxLineWidth: 100 } });
      }
      return out;
    });
    if (pat.rest) {
      props.push("..." + pat.rest.name);
    }
    return "{ " + props.join(", ") + " }";
  }
  const els = pat.elements.map(e => {
    if (e === null) {
      return "";
    }
    if (e.type === "Identifier") {
      return e.name;
    }
    return fmtPattern(e);
  });
  if (pat.rest) {
    els.push("..." + pat.rest.name);
  }
  return "[" + els.join(", ") + "]";
}
function fmtType(t) {
  switch (t.kind) {
    case "named": {
      return t.name;
    }
    case "array": {
      return fmtType(t.elementType) + "[]";
    }
    case "union": {
      return t.types.map(x => fmtType(x)).join(" | ");
    }
    case "intersection": {
      return t.types.map(x => fmtType(x)).join(" & ");
    }
    case "generic": {
      return t.name + "<" + t.args.map(x => fmtType(x)).join(", ") + ">";
    }
    case "function": {
      const params = t.params.map(x => fmtType(x)).join(", ");
      return "(" + params + ") => " + fmtType(t.returnType);
    }
    case "object": {
      const props = t.properties.map(p => {
        const opt = p.optional ? "?" : "";
        return p.key + opt + ": " + fmtType(p.value);
      }).join(", ");
      return "{ " + props + " }";
    }
    case "tuple": {
      return "[" + t.elements.map(x => fmtType(x)).join(", ") + "]";
    }
    case "literal": {
      return JSON.stringify(t.value);
    }
    case "nullable": {
      return fmtType(t.inner) + "?";
    }
    default: {
      return "any";
    }
  }
}