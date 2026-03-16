/**
 * Nodeon Type Checker — validates type annotations, infers types, reports errors.
 */

import {
  Program, Statement, Expression, TypeAnnotation,
  FunctionDeclaration, VariableDeclaration, ClassDeclaration,
  ImportDeclaration, ExportDeclaration, Param,
  InterfaceDeclaration, InterfaceProperty,
} from "@ast/nodes";

// ── Internal Type Representation ─────────────────────────────────

export type NType =
  | { kind: "primitive"; name: "string" | "number" | "boolean" | "void" | "null" | "undefined" }
  | { kind: "any" }
  | { kind: "never" }
  | { kind: "array"; element: NType }
  | { kind: "tuple"; elements: NType[] }
  | { kind: "object"; properties: Map<string, NType> }
  | { kind: "function"; params: NType[]; returnType: NType; typeParams?: string[] }
  | { kind: "union"; types: NType[] }
  | { kind: "intersection"; types: NType[] }
  | { kind: "named"; name: string }
  | { kind: "generic"; base: string; args: NType[] }
  | { kind: "typeParam"; name: string; constraint?: NType };

export const ANY: NType = { kind: "any" };
export const VOID: NType = { kind: "primitive", name: "void" };
export const STRING: NType = { kind: "primitive", name: "string" };
export const NUMBER: NType = { kind: "primitive", name: "number" };
export const BOOLEAN: NType = { kind: "primitive", name: "boolean" };
export const NULL_TYPE: NType = { kind: "primitive", name: "null" };
export const UNDEFINED: NType = { kind: "primitive", name: "undefined" };

// ── Diagnostics ──────────────────────────────────────────────────

export interface TypeDiagnostic {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "hint";
}

// ── Type Environment / Scope ─────────────────────────────────────

interface InterfaceDef {
  name: string;
  members: Map<string, { type: NType; optional: boolean; method: boolean }>;
  extends: string[];
}

interface TypeScope {
  bindings: Map<string, NType>;
  typeParams: Map<string, NType>;
}

class TypeEnv {
  private scopes: TypeScope[] = [{ bindings: new Map(), typeParams: new Map() }];
  // Interface registry (global — interfaces are hoisted)
  interfaces: Map<string, InterfaceDef> = new Map();
  push(): void { this.scopes.push({ bindings: new Map(), typeParams: new Map() }); }
  pop(): void { this.scopes.pop(); }
  define(name: string, type: NType): void {
    this.scopes[this.scopes.length - 1].bindings.set(name, type);
  }
  defineTypeParam(name: string, constraint?: NType): void {
    const tp: NType = { kind: "typeParam", name, constraint };
    this.scopes[this.scopes.length - 1].typeParams.set(name, tp);
    // Also define as a binding so it can be used in type annotations
    this.scopes[this.scopes.length - 1].bindings.set(name, tp);
  }
  lookupTypeParam(name: string): NType | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const t = this.scopes[i].typeParams.get(name);
      if (t) return t;
    }
    return null;
  }
  lookup(name: string): NType | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const t = this.scopes[i].bindings.get(name);
      if (t) return t;
    }
    return null;
  }
}

// ── TypeAnnotation → NType ───────────────────────────────────────

function annotationToType(ann: TypeAnnotation | undefined): NType {
  if (!ann) return ANY;
  switch (ann.kind) {
    case "named": {
      const n = ann.name;
      if (n === "string") return STRING;
      if (n === "number") return NUMBER;
      if (n === "boolean") return BOOLEAN;
      if (n === "void") return VOID;
      if (n === "null") return NULL_TYPE;
      if (n === "undefined") return UNDEFINED;
      if (n === "any") return ANY;
      if (n === "never") return { kind: "never" };
      return { kind: "named", name: n };
    }
    case "array":
      return { kind: "array", element: annotationToType(ann.elementType) };
    case "union":
      return { kind: "union", types: ann.types.map(annotationToType) };
    case "intersection":
      return { kind: "intersection", types: ann.types.map(annotationToType) };
    case "generic":
      return { kind: "generic", base: ann.name, args: ann.args.map(annotationToType) };
    case "function":
      return { kind: "function", params: ann.params.map(annotationToType), returnType: annotationToType(ann.returnType) };
    case "tuple":
      return { kind: "tuple", elements: ann.elements.map(annotationToType) };
    case "object": {
      const props = new Map<string, NType>();
      for (const p of ann.properties) props.set(p.key, annotationToType(p.value));
      return { kind: "object", properties: props };
    }
    case "literal":
      if (typeof ann.value === "string") return STRING;
      if (typeof ann.value === "number") return NUMBER;
      if (typeof ann.value === "boolean") return BOOLEAN;
      return ANY;
    case "nullable":
      return { kind: "union", types: [annotationToType(ann.inner), NULL_TYPE, UNDEFINED] };
    default:
      return ANY;
  }
}

// ── Type Display ─────────────────────────────────────────────────

export function typeToString(t: NType): string {
  switch (t.kind) {
    case "primitive": return t.name;
    case "any": return "any";
    case "never": return "never";
    case "array": return `${typeToString(t.element)}[]`;
    case "tuple": return `[${t.elements.map(typeToString).join(", ")}]`;
    case "union": return t.types.map(typeToString).join(" | ");
    case "intersection": return t.types.map(typeToString).join(" & ");
    case "function": return `(${t.params.map(typeToString).join(", ")}) => ${typeToString(t.returnType)}`;
    case "named": return t.name;
    case "generic": return `${t.base}<${t.args.map(typeToString).join(", ")}>`;
    case "typeParam": return t.constraint ? `${t.name} extends ${typeToString(t.constraint)}` : t.name;
    case "object": {
      const entries = Array.from(t.properties).map(([k, v]) => `${k}: ${typeToString(v)}`);
      return `{ ${entries.join("; ")} }`;
    }
  }
}

export function isNullableType(t: NType): boolean {
  if (t.kind === "union") {
    return t.types.some(inner => inner.kind === "primitive" && (inner.name === "null" || inner.name === "undefined"));
  }
  return false;
}

// ── Type Compatibility ───────────────────────────────────────────

function isAssignableTo(source: NType, target: NType): boolean {
  if (target.kind === "any" || source.kind === "any") return true;
  if (source.kind === "never") return true;
  if (source.kind === "primitive" && (source.name === "null" || source.name === "undefined")) return true;
  if (source.kind === "primitive" && target.kind === "primitive") return source.name === target.name;
  if (source.kind === "named" && target.kind === "named") return source.name === target.name;
  if (source.kind === "array" && target.kind === "array") return isAssignableTo(source.element, target.element);
  if (target.kind === "union") return target.types.some(t => isAssignableTo(source, t));
  if (source.kind === "union") return source.types.every(t => isAssignableTo(t, target));
  if (target.kind === "intersection") return target.types.every(t => isAssignableTo(source, t));
  if (source.kind === "function" && target.kind === "function") {
    if (source.params.length !== target.params.length) return false;
    for (let i = 0; i < source.params.length; i++) {
      if (!isAssignableTo(target.params[i], source.params[i])) return false;
    }
    return isAssignableTo(source.returnType, target.returnType);
  }
  // Type parameters: a type param is assignable to its constraint or any
  if (source.kind === "typeParam") {
    if (target.kind === "typeParam" && source.name === target.name) return true;
    if (source.constraint) return isAssignableTo(source.constraint, target);
    return true; // unconstrained type param is compatible with anything
  }
  if (target.kind === "typeParam") {
    if (target.constraint) return isAssignableTo(source, target.constraint);
    return true; // unconstrained type param accepts anything
  }
  // Generic types: Map<string, number> vs Map<K, V>
  if (source.kind === "generic" && target.kind === "generic") {
    if (source.base !== target.base) return false;
    if (source.args.length !== target.args.length) return false;
    return source.args.every((arg, i) => isAssignableTo(arg, target.args[i]));
  }
  return false;
}

// ── Generic Type Instantiation ───────────────────────────────────

/**
 * Substitute type parameters with concrete types throughout a type.
 * e.g., given T→string, replaces all occurrences of typeParam "T" with string.
 */
function substituteTypeParams(type: NType, subs: Map<string, NType>): NType {
  switch (type.kind) {
    case "typeParam": {
      const sub = subs.get(type.name);
      return sub ?? type;
    }
    case "array":
      return { kind: "array", element: substituteTypeParams(type.element, subs) };
    case "tuple":
      return { kind: "tuple", elements: type.elements.map(e => substituteTypeParams(e, subs)) };
    case "union":
      return { kind: "union", types: type.types.map(t => substituteTypeParams(t, subs)) };
    case "intersection":
      return { kind: "intersection", types: type.types.map(t => substituteTypeParams(t, subs)) };
    case "function":
      return {
        kind: "function",
        params: type.params.map(p => substituteTypeParams(p, subs)),
        returnType: substituteTypeParams(type.returnType, subs),
      };
    case "generic":
      return { kind: "generic", base: type.base, args: type.args.map(a => substituteTypeParams(a, subs)) };
    case "object": {
      const props = new Map<string, NType>();
      for (const [k, v] of type.properties) props.set(k, substituteTypeParams(v, subs));
      return { kind: "object", properties: props };
    }
    default:
      return type;
  }
}

/**
 * Resolve a named type annotation, checking if it's a type parameter in scope.
 */
function resolveNamedType(name: string, env: TypeEnv): NType {
  const tp = env.lookupTypeParam(name);
  if (tp) return tp;
  if (name === "string") return STRING;
  if (name === "number") return NUMBER;
  if (name === "boolean") return BOOLEAN;
  if (name === "void") return VOID;
  if (name === "null") return NULL_TYPE;
  if (name === "undefined") return UNDEFINED;
  if (name === "any") return ANY;
  if (name === "never") return { kind: "never" };
  return { kind: "named", name };
}

// ── Expression Type Inference ────────────────────────────────────

function inferExpression(expr: Expression, env: TypeEnv): NType {
  switch (expr.type) {
    case "Literal":
      switch (expr.literalType) {
        case "string": return STRING;
        case "number": return NUMBER;
        case "boolean": return BOOLEAN;
        case "null": return NULL_TYPE;
        default: return ANY;
      }
    case "Identifier":
      return env.lookup(expr.name) ?? ANY;
    case "ArrayExpression":
      if (expr.elements.length === 0) return { kind: "array", element: ANY };
      return { kind: "array", element: inferExpression(expr.elements[0], env) };
    case "ObjectExpression": {
      const props = new Map<string, NType>();
      for (const prop of expr.properties) {
        const key = prop.key.type === "Identifier" ? prop.key.name : String((prop.key as any).value);
        props.set(key, inferExpression(prop.value, env));
      }
      return { kind: "object", properties: props };
    }
    case "BinaryExpression": {
      if (["+", "-", "*", "/", "%", "**"].includes(expr.operator)) {
        const lt = inferExpression(expr.left, env);
        const rt = inferExpression(expr.right, env);
        if (expr.operator === "+" && ((lt.kind === "primitive" && lt.name === "string") || (rt.kind === "primitive" && rt.name === "string"))) return STRING;
        return NUMBER;
      }
      if (["==", "!=", "===", "!==", "<", ">", "<=", ">=", "instanceof"].includes(expr.operator)) return BOOLEAN;
      if (["&&", "||", "??"].includes(expr.operator)) return inferExpression(expr.right, env);
      return ANY;
    }
    case "UnaryExpression":
      if (expr.operator === "!") return BOOLEAN;
      if (expr.operator === "typeof") return STRING;
      if (expr.operator === "-" || expr.operator === "+" || expr.operator === "~") return NUMBER;
      return ANY;
    case "TemplateLiteral": return STRING;
    case "CallExpression":
      if (expr.callee.type === "Identifier") {
        const fnType = env.lookup(expr.callee.name);
        if (fnType && fnType.kind === "function") return fnType.returnType;
      }
      return ANY;
    case "ArrowFunction":
      return { kind: "function", params: expr.params.map((p: Param) => annotationToType(p.typeAnnotation)), returnType: annotationToType(expr.returnType) };
    case "TernaryExpression": return inferExpression(expr.consequent, env);
    case "AsExpression": return annotationToType(expr.typeAnnotation);
    case "AwaitExpression": return inferExpression(expr.argument, env);
    case "IfExpression": return inferExpression(expr.consequent.length > 0 ? (expr.consequent[expr.consequent.length - 1] as any).expression ?? (expr.consequent[expr.consequent.length - 1] as any).value ?? expr.consequent[expr.consequent.length - 1] : expr as any, env);
    case "NewExpression":
      if (expr.callee.type === "Identifier") return { kind: "named", name: expr.callee.name };
      return ANY;
    default: return ANY;
  }
}

// ── Statement Type Checking ──────────────────────────────────────

function getLine(stmt: any): number { return stmt?.loc?.line ? stmt.loc.line - 1 : 0; }
function getCol(stmt: any): number { return stmt?.loc?.column ? stmt.loc.column - 1 : 0; }

// ── Type Narrowing ───────────────────────────────────────────────

const TYPEOF_MAP: Record<string, NType> = {
  string: STRING, number: NUMBER, boolean: BOOLEAN,
  undefined: UNDEFINED, object: { kind: "named", name: "object" },
  function: { kind: "function", params: [], returnType: ANY },
};

function extractTypeGuard(cond: Expression): { name: string; narrowedType: NType } | null {
  if (cond.type !== "BinaryExpression") return null;
  if (cond.operator !== "===" && cond.operator !== "==") return null;

  // typeof x === "string" (UnaryExpression or TypeofExpression)
  const leftIsTypeof = (cond.left.type === "TypeofExpression") ||
    (cond.left.type === "UnaryExpression" && (cond.left as any).operator === "typeof");
  if (leftIsTypeof && cond.right.type === "Literal" && typeof cond.right.value === "string") {
    const arg = (cond.left as any).argument;
    if (arg && arg.type === "Identifier") {
      const mapped = TYPEOF_MAP[cond.right.value as string];
      if (mapped) return { name: arg.name, narrowedType: mapped };
    }
  }
  // "string" === typeof x (reversed)
  const rightIsTypeof = (cond.right.type === "TypeofExpression") ||
    (cond.right.type === "UnaryExpression" && (cond.right as any).operator === "typeof");
  if (rightIsTypeof && cond.left.type === "Literal" && typeof cond.left.value === "string") {
    const arg = (cond.right as any).argument;
    if (arg && arg.type === "Identifier") {
      const mapped = TYPEOF_MAP[cond.left.value as string];
      if (mapped) return { name: arg.name, narrowedType: mapped };
    }
  }
  // x instanceof MyClass
  if (cond.operator === "instanceof" as any && cond.left.type === "Identifier" && cond.right.type === "Identifier") {
    return { name: cond.left.name, narrowedType: { kind: "named", name: cond.right.name } };
  }
  return null;
}

function checkStatements(stmts: Statement[], env: TypeEnv, diags: TypeDiagnostic[]): void {
  for (const stmt of stmts) checkStatement(stmt, env, diags);
}

function checkStatement(stmt: Statement, env: TypeEnv, diags: TypeDiagnostic[]): void {
  switch (stmt.type) {
    case "VariableDeclaration": {
      const declaredType = annotationToType(stmt.typeAnnotation);
      const initType = inferExpression(stmt.value, env);
      if (declaredType.kind !== "any" && initType.kind !== "any") {
        if (!isAssignableTo(initType, declaredType)) {
          diags.push({
            line: getLine(stmt), column: getCol(stmt),
            message: `Type '${typeToString(initType)}' is not assignable to type '${typeToString(declaredType)}'`,
            severity: "error",
          });
        }
      }
      const resolvedType = declaredType.kind !== "any" ? declaredType : initType;
      if (stmt.name) env.define(stmt.name.name, resolvedType);
      break;
    }
    case "FunctionDeclaration": {
      const fn = stmt as FunctionDeclaration;
      // Register function type first (for recursion)
      env.push();
      // Register type parameters in the function's scope
      const tpNames = fn.typeParams || [];
      for (const tp of tpNames) env.defineTypeParam(tp);
      const paramTypes = fn.params.map((p: Param) => {
        const ann = annotationToType(p.typeAnnotation);
        // Resolve named type annotations that match type params
        if (ann.kind === "named" && tpNames.includes(ann.name)) {
          return env.lookupTypeParam(ann.name) ?? ann;
        }
        return ann;
      });
      const retAnn = annotationToType(fn.returnType);
      const retType = (retAnn.kind === "named" && tpNames.includes(retAnn.name))
        ? (env.lookupTypeParam(retAnn.name) ?? retAnn) : retAnn;
      const fnType: NType = { kind: "function", params: paramTypes, returnType: retType, typeParams: tpNames.length > 0 ? tpNames : undefined };
      // Define the function in the outer scope (pop then define then push back)
      env.pop();
      env.define(fn.name.name, fnType);
      env.push();
      // Re-register type params and params in the body scope
      for (const tp of tpNames) env.defineTypeParam(tp);
      for (let i = 0; i < fn.params.length; i++) env.define(fn.params[i].name, paramTypes[i]);
      checkStatements(fn.body, env, diags);
      if (retType.kind !== "any" && retType.kind !== "typeParam") checkReturnTypes(fn.body, retType, env, diags);
      env.pop();
      break;
    }
    case "ClassDeclaration": {
      const cls = stmt as ClassDeclaration;
      env.define(cls.name.name, { kind: "named", name: cls.name.name });
      // Check implements conformance
      if (cls.implements && cls.implements.length > 0) {
        checkImplements(cls, env, diags);
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
      // Type narrowing: if (typeof x === "string") → narrow x to string in consequent
      const guard = extractTypeGuard(stmt.condition);
      if (guard) env.define(guard.name, guard.narrowedType);
      checkStatements(stmt.consequent, env, diags);
      env.pop();
      if (stmt.alternate) { env.push(); checkStatements(stmt.alternate, env, diags); env.pop(); }
      break;
    }
    case "ReturnStatement": {
      if (stmt.value) inferExpression(stmt.value, env);
      break;
    }
    case "ForStatement": {
      env.push();
      // For-in/of: variable is declared in scope
      if (stmt.variable.type === "Identifier") env.define(stmt.variable.name, ANY);
      checkStatements(stmt.body, env, diags);
      env.pop();
      break;
    }
    case "WhileStatement":
    case "DoWhileStatement": {
      inferExpression(stmt.condition, env);
      env.push(); checkStatements(stmt.body, env, diags); env.pop();
      break;
    }
    case "ImportDeclaration": {
      const imp = stmt as ImportDeclaration;
      if (imp.defaultImport) env.define(imp.defaultImport, ANY);
      if (imp.namespaceImport) env.define(imp.namespaceImport, ANY);
      for (const spec of imp.namedImports) env.define(spec.alias ?? spec.name, ANY);
      break;
    }
    case "ExportDeclaration": {
      const exp = stmt as ExportDeclaration;
      if (exp.declaration) checkStatement(exp.declaration, env, diags);
      break;
    }
    case "TryCatchStatement": {
      env.push(); checkStatements(stmt.tryBlock, env, diags); env.pop();
      if (stmt.catchBlock.length > 0) {
        env.push();
        if (stmt.catchParam) env.define(stmt.catchParam.name, ANY);
        checkStatements(stmt.catchBlock, env, diags);
        env.pop();
      }
      if (stmt.finallyBlock) { env.push(); checkStatements(stmt.finallyBlock, env, diags); env.pop(); }
      break;
    }
    case "EnumDeclaration":
      env.define(stmt.name.name, { kind: "named", name: stmt.name.name });
      break;
    case "InterfaceDeclaration": {
      const iface = stmt as InterfaceDeclaration;
      env.define(iface.name.name, { kind: "named", name: iface.name.name });
      // Register interface members for conformance checking
      const members = new Map<string, { type: NType; optional: boolean; method: boolean }>();
      for (const prop of iface.properties) {
        const propType = prop.method
          ? { kind: "function" as const, params: (prop.params || []).map(annotationToType), returnType: annotationToType(prop.valueType) }
          : annotationToType(prop.valueType);
        members.set(prop.name.name, { type: propType, optional: prop.optional, method: prop.method });
      }
      const extendNames = (iface.extends || []).map(id => id.name);
      env.interfaces.set(iface.name.name, { name: iface.name.name, members, extends: extendNames });
      break;
    }
  }
}

// ── Interface Conformance ────────────────────────────────────────

/**
 * Collect all required members from an interface, including inherited ones.
 */
function collectInterfaceMembers(ifaceName: string, env: TypeEnv): Map<string, { type: NType; optional: boolean; method: boolean }> {
  const iface = env.interfaces.get(ifaceName);
  if (!iface) return new Map();

  const all = new Map<string, { type: NType; optional: boolean; method: boolean }>();

  // First collect from parent interfaces
  for (const parent of iface.extends) {
    const parentMembers = collectInterfaceMembers(parent, env);
    for (const [k, v] of parentMembers) all.set(k, v);
  }

  // Then overlay own members (own members take precedence)
  for (const [k, v] of iface.members) all.set(k, v);

  return all;
}

/**
 * Check that a class implements all required members of its declared interfaces.
 */
function checkImplements(cls: ClassDeclaration, env: TypeEnv, diags: TypeDiagnostic[]): void {
  if (!cls.implements) return;

  for (const ifaceId of cls.implements) {
    const ifaceDef = env.interfaces.get(ifaceId.name);
    if (!ifaceDef) {
      diags.push({
        line: getLine(cls), column: getCol(cls),
        message: `Interface '${ifaceId.name}' is not defined`,
        severity: "error",
      });
      continue;
    }

    const required = collectInterfaceMembers(ifaceId.name, env);

    // Collect class members
    const classMembers = new Map<string, { isMethod: boolean }>();
    for (const member of cls.body) {
      if (member.type === "ClassMethod") {
        const name = (member.name as any).name || (member.name as any).value;
        if (name && member.kind !== "constructor") {
          classMembers.set(name, { isMethod: true });
        }
      } else if (member.type === "ClassField") {
        const name = (member.name as any).name || (member.name as any).value;
        if (name) {
          classMembers.set(name, { isMethod: false });
        }
      }
    }

    // Check each required member
    for (const [memberName, memberDef] of required) {
      if (memberDef.optional) continue; // Optional members don't need implementation

      const classMember = classMembers.get(memberName);
      if (!classMember) {
        diags.push({
          line: getLine(cls), column: getCol(cls),
          message: `Class '${cls.name.name}' is missing required ${memberDef.method ? "method" : "property"} '${memberName}' from interface '${ifaceId.name}'`,
          severity: "error",
        });
      }
    }
  }
}

function checkReturnTypes(body: Statement[], expected: NType, env: TypeEnv, diags: TypeDiagnostic[]): void {
  for (const stmt of body) {
    if (stmt.type === "ReturnStatement" && stmt.value) {
      const actual = inferExpression(stmt.value, env);
      if (actual.kind !== "any" && !isAssignableTo(actual, expected)) {
        diags.push({
          line: getLine(stmt), column: getCol(stmt),
          message: `Type '${typeToString(actual)}' is not assignable to return type '${typeToString(expected)}'`,
          severity: "error",
        });
      }
    }
    if (stmt.type === "IfStatement") {
      checkReturnTypes(stmt.consequent, expected, env, diags);
      if (stmt.alternate) checkReturnTypes(stmt.alternate, expected, env, diags);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────

export function typeCheck(ast: Program): TypeDiagnostic[] {
  const diags: TypeDiagnostic[] = [];
  const env = new TypeEnv();
  checkStatements(ast.body, env, diags);
  return diags;
}
