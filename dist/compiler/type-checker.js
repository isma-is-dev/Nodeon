const ANY = { kind: "any" };
const VOID = { kind: "primitive", name: "void" };
const STRING = { kind: "primitive", name: "string" };
const NUMBER = { kind: "primitive", name: "number" };
const BOOLEAN = { kind: "primitive", name: "boolean" };
const NULL_TYPE = { kind: "primitive", name: "null" };
const UNDEFINED = { kind: "primitive", name: "undefined" };
class TypeEnv {
  constructor() {
    this.scopes = [{ bindings: new Map(), typeParams: new Map() }];
    this.interfaces = new Map();
  }

  push() {
    return this.scopes.push({ bindings: new Map(), typeParams: new Map() });
  }

  pop() {
    return this.scopes.pop();
  }

  define(name, type) {
    return this.scopes[this.scopes.length - 1].bindings.set(name, type);
  }

  defineTypeParam(name, constraint) {
    const tp = { kind: "typeParam", name: name, constraint: constraint };
    this.scopes[this.scopes.length - 1].typeParams.set(name, tp);
    this.scopes[this.scopes.length - 1].bindings.set(name, tp);
  }

  lookupTypeParam(name) {
    let i = this.scopes.length - 1;
    while (i >= 0) {
      const t = this.scopes[i].typeParams.get(name);
      if (t) {
        return t;
      }
      i = i - 1;
    }
    return null;
  }

  lookup(name) {
    let i = this.scopes.length - 1;
    while (i >= 0) {
      const t = this.scopes[i].bindings.get(name);
      if (t) {
        return t;
      }
      i = i - 1;
    }
    return null;
  }
}
function annotationToType(ann) {
  if (!ann) {
    return ANY;
  }
  switch (ann.kind) {
    case "named": {
      const n = ann.name;
      if (n === "string") {
        return STRING;
      }
      if (n === "number") {
        return NUMBER;
      }
      if (n === "boolean") {
        return BOOLEAN;
      }
      if (n === "void") {
        return VOID;
      }
      if (n === "null") {
        return NULL_TYPE;
      }
      if (n === "undefined") {
        return UNDEFINED;
      }
      if (n === "any") {
        return ANY;
      }
      if (n === "never") {
        return { kind: "never" };
      }
      return { kind: "named", name: n };
    }
    case "array": {
      return { kind: "array", element: annotationToType(ann.elementType) };
    }
    case "union": {
      return { kind: "union", types: ann.types.map(annotationToType) };
    }
    case "intersection": {
      return { kind: "intersection", types: ann.types.map(annotationToType) };
    }
    case "generic": {
      return { kind: "generic", base: ann.name, args: ann.args.map(annotationToType) };
    }
    case "function": {
      return { kind: "function", params: ann.params.map(annotationToType), returnType: annotationToType(ann.returnType) };
    }
    case "tuple": {
      return { kind: "tuple", elements: ann.elements.map(annotationToType) };
    }
    case "object": {
      const props = new Map();
      for (const p of ann.properties) {
        props.set(p.key, annotationToType(p.value));
      }
      return { kind: "object", properties: props };
    }
    case "literal": {
      if (typeof ann.value === "string") {
        return STRING;
      }
      if (typeof ann.value === "number") {
        return NUMBER;
      }
      if (typeof ann.value === "boolean") {
        return BOOLEAN;
      }
      return ANY;
    }
    default: {
      return ANY;
    }
  }
}
function typeToString(t) {
  switch (t.kind) {
    case "primitive": {
      return t.name;
    }
    case "any": {
      return "any";
    }
    case "never": {
      return "never";
    }
    case "array": {
      return typeToString(t.element) + "[]";
    }
    case "tuple": {
      return "[" + t.elements.map(typeToString).join(", ") + "]";
    }
    case "union": {
      return t.types.map(typeToString).join(" | ");
    }
    case "intersection": {
      return t.types.map(typeToString).join(" & ");
    }
    case "function": {
      return "(" + t.params.map(typeToString).join(", ") + ") => " + typeToString(t.returnType);
    }
    case "named": {
      return t.name;
    }
    case "generic": {
      return t.base + "<" + t.args.map(typeToString).join(", ") + ">";
    }
    case "typeParam": {
      if (t.constraint) {
        return t.name + " extends " + typeToString(t.constraint);
      }
      return t.name;
    }
    case "object": {
      const entries = Array.from(t.properties).map(entry => entry[0] + ": " + typeToString(entry[1]));
      return "{ " + entries.join("; ") + " }";
    }
    default: {
      return "unknown";
    }
  }
}
function isAssignableTo(source, target) {
  if (target.kind === "any" || source.kind === "any") {
    return true;
  }
  if (source.kind === "never") {
    return true;
  }
  if (source.kind === "primitive" && target.kind === "primitive") {
    return source.name === target.name;
  }
  if (source.kind === "primitive" && (source.name === "null" || source.name === "undefined")) {
    return true;
  }
  if (source.kind === "named" && target.kind === "named") {
    return source.name === target.name;
  }
  if (source.kind === "array" && target.kind === "array") {
    return isAssignableTo(source.element, target.element);
  }
  if (target.kind === "union") {
    return target.types.some(t => isAssignableTo(source, t));
  }
  if (source.kind === "union") {
    return source.types.every(t => isAssignableTo(t, target));
  }
  if (target.kind === "intersection") {
    return target.types.every(t => isAssignableTo(source, t));
  }
  if (source.kind === "function" && target.kind === "function") {
    if (source.params.length !== target.params.length) {
      return false;
    }
    let i = 0;
    while (i < source.params.length) {
      const ok = isAssignableTo(target.params[i], source.params[i]);
      if (!ok) {
        return false;
      }
      i = i + 1;
    }
    return isAssignableTo(source.returnType, target.returnType);
  }
  if (source.kind === "typeParam") {
    if (target.kind === "typeParam" && source.name === target.name) {
      return true;
    }
    if (source.constraint) {
      return isAssignableTo(source.constraint, target);
    }
    return true;
  }
  if (target.kind === "typeParam") {
    if (target.constraint) {
      return isAssignableTo(source, target.constraint);
    }
    return true;
  }
  if (source.kind === "generic" && target.kind === "generic") {
    if (source.base !== target.base) {
      return false;
    }
    if (source.args.length !== target.args.length) {
      return false;
    }
    return source.args.every((arg, i) => isAssignableTo(arg, target.args[i]));
  }
  return false;
}
function substituteTypeParams(type, subs) {
  switch (type.kind) {
    case "typeParam": {
      const sub = subs.get(type.name);
      return sub ?? type;
    }
    case "array": {
      return { kind: "array", element: substituteTypeParams(type.element, subs) };
    }
    case "tuple": {
      return { kind: "tuple", elements: type.elements.map(e => substituteTypeParams(e, subs)) };
    }
    case "union": {
      return { kind: "union", types: type.types.map(t => substituteTypeParams(t, subs)) };
    }
    case "intersection": {
      return { kind: "intersection", types: type.types.map(t => substituteTypeParams(t, subs)) };
    }
    case "function": {
      return { kind: "function", params: type.params.map(p => substituteTypeParams(p, subs)), returnType: substituteTypeParams(type.returnType, subs) };
    }
    case "generic": {
      return { kind: "generic", base: type.base, args: type.args.map(a => substituteTypeParams(a, subs)) };
    }
    case "object": {
      const props = new Map();
      for (const entry of Array.from(type.properties)) {
        props.set(entry[0], substituteTypeParams(entry[1], subs));
      }
      return { kind: "object", properties: props };
    }
    default: {
      return type;
    }
  }
}
function inferExpression(expr, env) {
  switch (expr.type) {
    case "Literal": {
      switch (expr.literalType) {
        case "string": {
          return STRING;
        }
        case "number": {
          return NUMBER;
        }
        case "boolean": {
          return BOOLEAN;
        }
        case "null": {
          return NULL_TYPE;
        }
        default: {
          return ANY;
        }
      }
      break;
    }
    case "Identifier": {
      return env.lookup(expr.name) ?? ANY;
    }
    case "ArrayExpression": {
      if (expr.elements.length === 0) {
        return { kind: "array", element: ANY };
      }
      return { kind: "array", element: inferExpression(expr.elements[0], env) };
    }
    case "ObjectExpression": {
      const props = new Map();
      for (const prop of expr.properties) {
        const key = prop.key.type === "Identifier" ? prop.key.name : String(prop.key.value);
        props.set(key, inferExpression(prop.value, env));
      }
      return { kind: "object", properties: props };
    }
    case "BinaryExpression": {
      if (["+", "-", "*", "/", "%", "**"].includes(expr.operator)) {
        const lt = inferExpression(expr.left, env);
        const rt = inferExpression(expr.right, env);
        if (expr.operator === "+" && (lt.kind === "primitive" && lt.name === "string" || rt.kind === "primitive" && rt.name === "string")) {
          return STRING;
        }
        return NUMBER;
      }
      if (["==", "!=", "===", "!==", "<", ">", "<=", ">=", "instanceof"].includes(expr.operator)) {
        return BOOLEAN;
      }
      if (["&&", "||", "??"].includes(expr.operator)) {
        return inferExpression(expr.right, env);
      }
      return ANY;
    }
    case "UnaryExpression": {
      if (expr.operator === "!") {
        return BOOLEAN;
      }
      if (expr.operator === "typeof") {
        return STRING;
      }
      if (expr.operator === "-" || expr.operator === "+" || expr.operator === "~") {
        return NUMBER;
      }
      return ANY;
    }
    case "TemplateLiteral": {
      return STRING;
    }
    case "CallExpression": {
      if (expr.callee.type === "Identifier") {
        const fnType = env.lookup(expr.callee.name);
        if (fnType && fnType.kind === "function") {
          return fnType.returnType;
        }
      }
      return ANY;
    }
    case "ArrowFunction": {
      return { kind: "function", params: expr.params.map(p => annotationToType(p.typeAnnotation)), returnType: annotationToType(expr.returnType) };
    }
    case "TernaryExpression": {
      return inferExpression(expr.consequent, env);
    }
    case "AsExpression": {
      return annotationToType(expr.typeAnnotation);
    }
    case "AwaitExpression": {
      return inferExpression(expr.argument, env);
    }
    case "IfExpression": {
      if (expr.consequent.length > 0) {
        const last = expr.consequent[expr.consequent.length - 1];
        if (last.expression) {
          return inferExpression(last.expression, env);
        }
        if (last.value) {
          return inferExpression(last.value, env);
        }
        return inferExpression(last, env);
      }
      return ANY;
    }
    case "NewExpression": {
      if (expr.callee.type === "Identifier") {
        return { kind: "named", name: expr.callee.name };
      }
      return ANY;
    }
    default: {
      return ANY;
    }
  }
}
function getLine(stmt) {
  return stmt?.loc?.line ? stmt.loc.line - 1 : 0;
}
function getCol(stmt) {
  return stmt?.loc?.column ? stmt.loc.column - 1 : 0;
}
const TYPEOF_MAP = { "string": STRING, "number": NUMBER, "boolean": BOOLEAN, "undefined": UNDEFINED, "object": { kind: "named", name: "object" }, "function": { kind: "function", params: [], returnType: ANY } };
function extractTypeGuard(cond) {
  if (cond.type !== "BinaryExpression") {
    return null;
  }
  if (cond.operator !== "===" && cond.operator !== "==") {
    return null;
  }
  if (cond.left.type === "UnaryExpression" && cond.left.operator === "typeof" && cond.left.argument.type === "Identifier" && cond.right.type === "Literal" && typeof cond.right.value === "string") {
    const mapped = TYPEOF_MAP[cond.right.value];
    if (mapped) {
      return { name: cond.left.argument.name, narrowedType: mapped };
    }
  }
  if (cond.right.type === "UnaryExpression" && cond.right.operator === "typeof" && cond.right.argument.type === "Identifier" && cond.left.type === "Literal" && typeof cond.left.value === "string") {
    const mapped = TYPEOF_MAP[cond.left.value];
    if (mapped) {
      return { name: cond.right.argument.name, narrowedType: mapped };
    }
  }
  return null;
}
function checkStatements(stmts, env, diags) {
  for (const stmt of stmts) {
    checkStatement(stmt, env, diags);
  }
}
function checkStatement(stmt, env, diags) {
  switch (stmt.type) {
    case "VariableDeclaration": {
      const declaredType = annotationToType(stmt.typeAnnotation);
      const initType = inferExpression(stmt.value, env);
      if (declaredType.kind !== "any" && initType.kind !== "any") {
        const assignable = isAssignableTo(initType, declaredType);
        if (!assignable) {
          diags.push({ line: getLine(stmt), column: getCol(stmt), message: "Type '" + typeToString(initType) + "' is not assignable to type '" + typeToString(declaredType) + "'", severity: "error" });
        }
      }
      const resolvedType = declaredType.kind !== "any" ? declaredType : initType;
      if (stmt.name) {
        env.define(stmt.name.name, resolvedType);
      }
      break;
    }
    case "FunctionDeclaration": {
      env.push();
      const tpNames = stmt.typeParams || [];
      for (const tp of tpNames) {
        env.defineTypeParam(tp);
      }
      const paramTypes = stmt.params.map(p => {
        const ann = annotationToType(p.typeAnnotation);
        if (ann.kind === "named" && tpNames.includes(ann.name)) {
          return env.lookupTypeParam(ann.name) ?? ann;
        }
        return ann;
      });
      const retAnn = annotationToType(stmt.returnType);
      let retType = retAnn;
      if (retAnn.kind === "named" && tpNames.includes(retAnn.name)) {
        retType = env.lookupTypeParam(retAnn.name) ?? retAnn;
      }
      const fnType = { kind: "function", params: paramTypes, returnType: retType, typeParams: tpNames.length > 0 ? tpNames : undefined };
      env.pop();
      env.define(stmt.name.name, fnType);
      env.push();
      for (const tp of tpNames) {
        env.defineTypeParam(tp);
      }
      let pi = 0;
      while (pi < stmt.params.length) {
        env.define(stmt.params[pi].name, paramTypes[pi]);
        pi = pi + 1;
      }
      checkStatements(stmt.body, env, diags);
      if (retType.kind !== "any" && retType.kind !== "typeParam") {
        checkReturnTypes(stmt.body, retType, env, diags);
      }
      env.pop();
      break;
    }
    case "ClassDeclaration": {
      env.define(stmt.name.name, { kind: "named", name: stmt.name.name });
      if (stmt.implements && stmt.implements.length > 0) {
        checkImplements(stmt, env, diags);
      }
      break;
    }
    case "ExpressionStatement": {
      inferExpression(stmt.expression, env);
      break;
    }
    case "IfStatement": {
      inferExpression(stmt.condition, env);
      env.push();
      const guard = extractTypeGuard(stmt.condition);
      if (guard) {
        env.define(guard.name, guard.narrowedType);
      }
      checkStatements(stmt.consequent, env, diags);
      env.pop();
      if (stmt.alternate) {
        env.push();
        checkStatements(stmt.alternate, env, diags);
        env.pop();
      }
      break;
    }
    case "ReturnStatement": {
      if (stmt.value) {
        inferExpression(stmt.value, env);
      }
      break;
    }
    case "ForStatement": {
      env.push();
      if (stmt.variable.type === "Identifier") {
        env.define(stmt.variable.name, ANY);
      }
      checkStatements(stmt.body, env, diags);
      env.pop();
      break;
    }
    case "WhileStatement": {
      inferExpression(stmt.condition, env);
      env.push();
      checkStatements(stmt.body, env, diags);
      env.pop();
      break;
    }
    case "DoWhileStatement": {
      inferExpression(stmt.condition, env);
      env.push();
      checkStatements(stmt.body, env, diags);
      env.pop();
      break;
    }
    case "ImportDeclaration": {
      if (stmt.defaultImport) {
        env.define(stmt.defaultImport, ANY);
      }
      for (const spec of stmt.namedImports) {
        env.define(spec.alias ?? spec.name, ANY);
      }
      break;
    }
    case "ExportDeclaration": {
      if (stmt.declaration) {
        checkStatement(stmt.declaration, env, diags);
      }
      break;
    }
    case "TryCatchStatement": {
      env.push();
      checkStatements(stmt.tryBlock, env, diags);
      env.pop();
      if (stmt.catchBlock.length > 0) {
        env.push();
        if (stmt.catchParam) {
          env.define(stmt.catchParam.name, ANY);
        }
        checkStatements(stmt.catchBlock, env, diags);
        env.pop();
      }
      if (stmt.finallyBlock) {
        env.push();
        checkStatements(stmt.finallyBlock, env, diags);
        env.pop();
      }
      break;
    }
    case "EnumDeclaration": {
      env.define(stmt.name.name, { kind: "named", name: stmt.name.name });
      break;
    }
    case "InterfaceDeclaration": {
      env.define(stmt.name.name, { kind: "named", name: stmt.name.name });
      const members = new Map();
      for (const prop of stmt.properties) {
        let propType = annotationToType(prop.valueType);
        if (prop.method) {
          const mParams = prop.params || [].map(annotationToType);
          propType = { kind: "function", params: mParams, returnType: annotationToType(prop.valueType) };
        }
        members.set(prop.name.name, { type: propType, optional: prop.optional, method: prop.method });
      }
      const extendNames = stmt.extends || [].map(id => id.name);
      env.interfaces.set(stmt.name.name, { name: stmt.name.name, members: members, extends: extendNames });
      break;
    }
  }
}
function collectInterfaceMembers(ifaceName, env) {
  const iface = env.interfaces.get(ifaceName);
  if (!iface) {
    return new Map();
  }
  const all = new Map();
  for (const parent of iface.extends) {
    const parentMembers = collectInterfaceMembers(parent, env);
    for (const entry of Array.from(parentMembers)) {
      all.set(entry[0], entry[1]);
    }
  }
  for (const entry of Array.from(iface.members)) {
    all.set(entry[0], entry[1]);
  }
  return all;
}
function checkImplements(cls, env, diags) {
  if (!cls.implements) {
    return;
  }
  for (const ifaceId of cls.implements) {
    const ifaceDef = env.interfaces.get(ifaceId.name);
    if (!ifaceDef) {
      diags.push({ line: getLine(cls), column: getCol(cls), message: "Interface '" + ifaceId.name + "' is not defined", severity: "error" });
      continue;
    }
    const required = collectInterfaceMembers(ifaceId.name, env);
    const classMembers = new Map();
    for (const member of cls.body) {
      if (member.type === "ClassMethod") {
        const mName = member.name.name || member.name.value;
        if (mName && member.kind !== "constructor") {
          classMembers.set(mName, { isMethod: true });
        }
      } else if (member.type === "ClassField") {
        const fName = member.name.name || member.name.value;
        if (fName) {
          classMembers.set(fName, { isMethod: false });
        }
      }
    }
    for (const entry of Array.from(required)) {
      const memberName = entry[0];
      const memberDef = entry[1];
      if (memberDef.optional) {
        continue;
      }
      const classMember = classMembers.get(memberName);
      if (!classMember) {
        const memberKind = memberDef.method ? "method" : "property";
        diags.push({ line: getLine(cls), column: getCol(cls), message: "Class '" + cls.name.name + "' is missing required " + memberKind + " '" + memberName + "' from interface '" + ifaceId.name + "'", severity: "error" });
      }
    }
  }
}
function checkReturnTypes(body, expected, env, diags) {
  for (const stmt of body) {
    if (stmt.type === "ReturnStatement" && stmt.value) {
      const actual = inferExpression(stmt.value, env);
      const assignOk = isAssignableTo(actual, expected);
      if (actual.kind !== "any" && !assignOk) {
        diags.push({ line: getLine(stmt), column: getCol(stmt), message: "Type '" + typeToString(actual) + "' is not assignable to return type '" + typeToString(expected) + "'", severity: "error" });
      }
    }
    if (stmt.type === "IfStatement") {
      checkReturnTypes(stmt.consequent, expected, env, diags);
      if (stmt.alternate) {
        checkReturnTypes(stmt.alternate, expected, env, diags);
      }
    }
  }
}
export function typeCheck(ast) {
  const diags = [];
  const env = new TypeEnv();
  checkStatements(ast.body, env, diags);
  return diags;
}