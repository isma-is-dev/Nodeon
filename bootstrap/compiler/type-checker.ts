/**
 * Nodeon Type Checker — validates type annotations, infers types, reports errors.
 * Supports cross-file type resolution for .no imports.
 */

import {
  Program, Statement, Expression, TypeAnnotation,
  FunctionDeclaration, VariableDeclaration, ClassDeclaration,
  ImportDeclaration, ExportDeclaration, Param,
  InterfaceDeclaration, InterfaceProperty, ExpressionStatement,
  TypeAliasDeclaration,
} from "@ast/nodes";

// ── Internal Type Representation ─────────────────────────────────

export type NType =
  | { kind: "primitive"; name: "string" | "number" | "boolean" | "void" | "null" | "undefined" }
  | { kind: "any" }
  | { kind: "never" }
  | { kind: "array"; element: NType }
  | { kind: "tuple"; elements: NType[] }
  | { kind: "object"; properties: Map<string, NType>; optional?: Set<string> }
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

interface TypeAliasDef {
  annotation: TypeAnnotation;
  typeParams: string[];
}

interface TypeScope {
  bindings: Map<string, NType>;
  typeParams: Map<string, NType>;
  /** Names bound with an *explicit* type annotation. Only these are enforced
   *  on later assignments — inferred bindings are never re-checked, because
   *  inference is intentionally loose (e.g. a 1-element array literal). */
  annotated: Set<string>;
}

class TypeEnv {
  private scopes: TypeScope[] = [newScope()];
  // Interface registry (global — interfaces are hoisted)
  interfaces: Map<string, InterfaceDef> = new Map();
  // Type-alias registry (global — aliases are hoisted so forward references work)
  typeAliases: Map<string, TypeAliasDef> = new Map();
  /** Names currently being expanded for a structural comparison. Guards against
   *  recursive / mutually-recursive aliases and self-referential interfaces. */
  resolveStack: Set<string> = new Set();
  /** Memoised expansions of non-generic aliases (populated per typeCheck run). */
  aliasCache: Map<string, NType> = new Map();
  /** Hard cap on structural resolutions per run — guarantees termination. */
  resolveBudget = 20000;
  filePath?: string;

  push(): void { this.scopes.push(newScope()); }
  pop(): void { this.scopes.pop(); }
  define(name: string, type: NType, annotated = false): void {
    const scope = this.scopes[this.scopes.length - 1];
    scope.bindings.set(name, type);
    if (annotated) scope.annotated.add(name);
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
  /** True when the nearest binding for `name` carries an explicit annotation. */
  isAnnotated(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].bindings.has(name)) return this.scopes[i].annotated.has(name);
    }
    return false;
  }
}

function newScope(): TypeScope {
  return { bindings: new Map(), typeParams: new Map(), annotated: new Set() };
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

// ── Named-Type Resolution (aliases + interfaces) ─────────────────

/**
 * Rewrite `{ kind: "named", name: X }` into `{ kind: "typeParam", name: X }`
 * when X is one of the declared alias type parameters, so that
 * `substituteTypeParams` can later replace it.
 */
function markTypeParams(t: NType, names: string[]): NType {
  if (names.length === 0) return t;
  switch (t.kind) {
    case "named":
      return names.includes(t.name) ? { kind: "typeParam", name: t.name } : t;
    case "array":
      return { kind: "array", element: markTypeParams(t.element, names) };
    case "tuple":
      return { kind: "tuple", elements: t.elements.map(e => markTypeParams(e, names)) };
    case "union":
      return { kind: "union", types: t.types.map(x => markTypeParams(x, names)) };
    case "intersection":
      return { kind: "intersection", types: t.types.map(x => markTypeParams(x, names)) };
    case "function":
      return { kind: "function", params: t.params.map(p => markTypeParams(p, names)), returnType: markTypeParams(t.returnType, names) };
    case "generic":
      return { kind: "generic", base: t.base, args: t.args.map(a => markTypeParams(a, names)) };
    case "object": {
      const props = new Map<string, NType>();
      for (const [k, v] of t.properties) props.set(k, markTypeParams(v, names));
      return { kind: "object", properties: props, optional: t.optional };
    }
    default:
      return t;
  }
}

/**
 * Expand the alias `name` into a structural NType. Returns null when the name
 * is not a registered alias, when it is already being expanded (cycle), or
 * when the resolution budget is exhausted — in every one of those cases the
 * caller must fall back to a permissive answer rather than a false error.
 */
function expandAlias(name: string, env: TypeEnv): NType | null {
  const def = env.typeAliases.get(name);
  if (!def) return null;
  if (env.resolveStack.has(name)) return null;
  if (env.resolveBudget <= 0) return null;

  if (def.typeParams.length === 0) {
    const cached = env.aliasCache.get(name);
    if (cached) return cached;
  }

  env.resolveBudget--;
  env.resolveStack.add(name);
  let result: NType;
  try {
    const subs = new Map<string, NType>();
    for (const tp of def.typeParams) {
      const bound = env.lookupTypeParam(tp);
      if (bound) subs.set(tp, bound);
    }
    const raw = markTypeParams(annotationToType(def.annotation), def.typeParams);
    result = resolveNamedNodes(substituteTypeParams(raw, subs), env);
  } finally {
    env.resolveStack.delete(name);
  }

  // Only memoise expansions that were not truncated by a cycle, otherwise a
  // partially-expanded form would poison later comparisons.
  if (def.typeParams.length === 0 && result.kind !== "named") env.aliasCache.set(name, result);
  return result;
}

/**
 * Instantiate a registered generic alias: `Pair<number, string>` becomes
 * `{ first: number; second: string }`. Returns null when `base` is not an alias.
 */
function instantiateGenericAlias(t: NType & { kind: "generic" }, env: TypeEnv): NType | null {
  const def = env.typeAliases.get(t.base);
  if (!def) return null;
  if (env.resolveStack.has(t.base)) return null;
  if (env.resolveBudget <= 0) return null;
  if (t.args.length !== def.typeParams.length) return null;

  env.resolveBudget--;
  env.resolveStack.add(t.base);
  let result: NType;
  try {
    const subs = new Map<string, NType>();
    def.typeParams.forEach((p, i) => subs.set(p, resolveNamedNodes(t.args[i], env)));
    const raw = markTypeParams(annotationToType(def.annotation), def.typeParams);
    result = resolveNamedNodes(substituteTypeParams(raw, subs), env);
  } finally {
    env.resolveStack.delete(t.base);
  }
  return result;
}

/**
 * Replace named references to aliases / generic aliases by their structural
 * form, recursively. Self-referential aliases terminate because `expandAlias`
 * refuses to re-enter a name already on `env.resolveStack`.
 */
function resolveNamedNodes(t: NType, env: TypeEnv): NType {
  switch (t.kind) {
    case "named": {
      const expanded = expandAlias(t.name, env);
      return expanded ?? t;
    }
    case "generic": {
      const inst = instantiateGenericAlias(t, env);
      if (inst) return inst;
      return { kind: "generic", base: t.base, args: t.args.map(a => resolveNamedNodes(a, env)) };
    }
    case "array":
      return { kind: "array", element: resolveNamedNodes(t.element, env) };
    case "tuple":
      return { kind: "tuple", elements: t.elements.map(e => resolveNamedNodes(e, env)) };
    case "union":
      return { kind: "union", types: t.types.map(x => resolveNamedNodes(x, env)) };
    case "intersection":
      return { kind: "intersection", types: t.types.map(x => resolveNamedNodes(x, env)) };
    case "function":
      return {
        kind: "function",
        params: t.params.map(p => resolveNamedNodes(p, env)),
        returnType: resolveNamedNodes(t.returnType, env),
      };
    case "object": {
      const props = new Map<string, NType>();
      for (const [k, v] of t.properties) props.set(k, resolveNamedNodes(v, env));
      return { kind: "object", properties: props, optional: t.optional };
    }
    default:
      return t;
  }
}

/**
 * Structural form of a registered interface, merged across `extends`.
 * Returns null when the name is not an interface (classes/enums stay nominal).
 */
function interfaceToObject(name: string, env: TypeEnv): NType | null {
  if (!env.interfaces.has(name)) return null;
  if (env.resolveStack.has(name)) return null;
  if (env.resolveBudget <= 0) return null;

  env.resolveBudget--;
  env.resolveStack.add(name);
  try {
    const members = collectInterfaceMembers(name, env);
    const props = new Map<string, NType>();
    const optional = new Set<string>();
    for (const [k, v] of members) {
      props.set(k, v.type);
      if (v.optional) optional.add(k);
    }
    return { kind: "object", properties: props, optional };
  } finally {
    env.resolveStack.delete(name);
  }
}

// ── Type Compatibility ───────────────────────────────────────────

/**
 * Structural object compatibility. Every property required by `target` must be
 * present on `source` and assignable to it; extra properties on `source` are
 * allowed (no freshness/excess-property check — object values flow through
 * variables too, and rejecting them would be a false positive).
 */
function isObjectAssignableTo(source: NType & { kind: "object" }, target: NType & { kind: "object" }, env?: TypeEnv): boolean {
  for (const [key, targetType] of target.properties) {
    const sourceType = source.properties.get(key);
    if (sourceType === undefined) {
      if (target.optional?.has(key)) continue;
      return false;
    }
    if (!isAssignableTo(sourceType, targetType, env)) return false;
  }
  return true;
}

/**
 * A union arm that names an alias/interface we are already expanding (a
 * recursive type such as `type node = string | node[]`) cannot be resolved, so
 * it is skipped rather than accepted — otherwise one recursive arm would mask
 * every other arm. The union is only accepted when *all* arms are cyclic,
 * because then nothing at all is verifiable.
 */
function isAssignableToUnion(source: NType, target: NType & { kind: "union" }, env?: TypeEnv): boolean {
  let cyclicOnly = true;
  for (const arm of target.types) {
    const cyclic = !!env && arm.kind === "named" && env.resolveStack.has(arm.name) &&
      (env.typeAliases.has(arm.name) || env.interfaces.has(arm.name));
    if (cyclic) continue; // unresolvable recursive arm — not evidence of a match
    cyclicOnly = false;
    if (isAssignableTo(source, arm, env)) return true;
  }
  return cyclicOnly;
}

function isAssignableTo(source: NType, target: NType, env?: TypeEnv): boolean {
  if (target.kind === "any" || source.kind === "any") return true;
  if (source.kind === "never") return true;

  // ── Resolve named references so aliases and interfaces compare structurally.
  if (env) {
    if (target.kind === "named") {
      if (env.typeAliases.has(target.name) || env.interfaces.has(target.name)) {
        // Recursive / mutually-recursive definition, or budget exhausted:
        // accept rather than report an unverifiable error.
        if (env.resolveStack.has(target.name)) return true;
        const expanded = target.kind === "named" && env.typeAliases.has(target.name)
          ? expandAlias(target.name, env)
          : interfaceToObject(target.name, env);
        if (!expanded) return true;
        env.resolveStack.add(target.name);
        const ok = isAssignableTo(source, expanded, env);
        env.resolveStack.delete(target.name);
        return ok;
      }
    }
    if (source.kind === "named") {
      if (env.typeAliases.has(source.name) || env.interfaces.has(source.name)) {
        if (env.resolveStack.has(source.name)) return true;
        const expanded = env.typeAliases.has(source.name)
          ? expandAlias(source.name, env)
          : interfaceToObject(source.name, env);
        if (!expanded) return true;
        env.resolveStack.add(source.name);
        const ok = isAssignableTo(expanded, target, env);
        env.resolveStack.delete(source.name);
        return ok;
      }
    }
    if (source.kind === "generic" && env.typeAliases.has(source.base)) {
      const inst = instantiateGenericAlias(source, env);
      if (!inst) return true;
      env.resolveStack.add(source.base);
      const ok = isAssignableTo(inst, target, env);
      env.resolveStack.delete(source.base);
      return ok;
    }
    if (target.kind === "generic" && env.typeAliases.has(target.base)) {
      const inst = instantiateGenericAlias(target, env);
      if (!inst) return true;
      env.resolveStack.add(target.base);
      const ok = isAssignableTo(source, inst, env);
      env.resolveStack.delete(target.base);
      return ok;
    }
  }

  if (source.kind === "primitive" && (source.name === "null" || source.name === "undefined")) return true;
  if (source.kind === "primitive" && target.kind === "primitive") return source.name === target.name;
  if (source.kind === "named" && target.kind === "named") return source.name === target.name;
  if (source.kind === "array" && target.kind === "array") return isAssignableTo(source.element, target.element, env);
  if (source.kind === "array" && target.kind === "tuple") {
    // A homogeneous array is not a tuple — only an `any[]` seed is.
    return source.element.kind === "any";
  }
  if (source.kind === "tuple" && target.kind === "tuple") {
    if (source.elements.length !== target.elements.length) return false;
    return target.elements.every((tt, i) => isAssignableTo(source.elements[i], tt, env));
  }
  if (source.kind === "object" && target.kind === "object") return isObjectAssignableTo(source, target, env);
  if (source.kind === "object" && target.kind === "array") {
    // An object is never an array unless it is an `any[]`-shaped thing.
    return false;
  }
  if (target.kind === "union") return isAssignableToUnion(source, target, env);
  if (source.kind === "union") return source.types.every(t => isAssignableTo(t, target, env));
  if (target.kind === "intersection") return target.types.every(t => isAssignableTo(source, t, env));
  if (source.kind === "intersection") return source.types.some(t => isAssignableTo(target, t, env));
  if (source.kind === "function" && target.kind === "function") {
    if (source.params.length !== target.params.length) return false;
    for (let i = 0; i < source.params.length; i++) {
      if (!isAssignableTo(target.params[i], source.params[i], env)) return false;
    }
    return isAssignableTo(source.returnType, target.returnType, env);
  }
  // Type parameters: a type param is assignable to its constraint or any
  if (source.kind === "typeParam") {
    if (target.kind === "typeParam" && source.name === target.name) return true;
    if (source.constraint) return isAssignableTo(source.constraint, target, env);
    return true; // unconstrained type param is compatible with anything
  }
  if (target.kind === "typeParam") {
    if (target.constraint) return isAssignableTo(source, target.constraint, env);
    return true; // unconstrained type param accepts anything
  }
  // Generic types: Map<string, number> vs Map<K, V>
  if (source.kind === "generic" && target.kind === "generic") {
    if (source.base !== target.base) return false;
    if (source.args.length !== target.args.length) return false;
    return source.args.every((arg, i) => isAssignableTo(arg, target.args[i], env));
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
      return { kind: "object", properties: props, optional: type.optional };
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
    case "AssignmentExpression": {
      const rhsType = inferExpression(expr.right, env);
      if (expr.left.type === "Identifier") {
        const declared = env.lookup(expr.left.name);
        if (declared) return declared;
      }
      return rhsType;
    }
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

interface TypeGuard {
  name: string;
  narrowedType: NType;
  kind: "positive" | "negative";
}

function extractTypeGuard(cond: Expression): TypeGuard | null {
  // Truthiness check: if (x) → narrows out null/undefined
  if (cond.type === "Identifier") {
    return { name: cond.name, narrowedType: { kind: "union", types: [NULL_TYPE, UNDEFINED] }, kind: "negative" };
  }

  // Negation: if (!x) → x is falsy in consequent
  if (cond.type === "UnaryExpression" && (cond as any).operator === "!") {
    const inner = (cond as any).argument;
    if (inner && inner.type === "Identifier") {
      return { name: inner.name, narrowedType: { kind: "union", types: [NULL_TYPE, UNDEFINED] }, kind: "positive" };
    }
  }

  if (cond.type !== "BinaryExpression") return null;

  // typeof x === "string"
  if (cond.operator === "===" || cond.operator === "==") {
    const leftIsTypeof = (cond.left.type === "TypeofExpression") ||
      (cond.left.type === "UnaryExpression" && (cond.left as any).operator === "typeof");
    if (leftIsTypeof && cond.right.type === "Literal" && typeof cond.right.value === "string") {
      const arg = (cond.left as any).argument;
      if (arg && arg.type === "Identifier") {
        const mapped = TYPEOF_MAP[cond.right.value as string];
        if (mapped) return { name: arg.name, narrowedType: mapped, kind: "positive" };
      }
    }
    // "string" === typeof x (reversed)
    const rightIsTypeof = (cond.right.type === "TypeofExpression") ||
      (cond.right.type === "UnaryExpression" && (cond.right as any).operator === "typeof");
    if (rightIsTypeof && cond.left.type === "Literal" && typeof cond.left.value === "string") {
      const arg = (cond.right as any).argument;
      if (arg && arg.type === "Identifier") {
        const mapped = TYPEOF_MAP[cond.left.value as string];
        if (mapped) return { name: arg.name, narrowedType: mapped, kind: "positive" };
      }
    }
    // x === null / x === undefined
    if (cond.left.type === "Identifier" && cond.right.type === "Literal") {
      if (cond.right.value === null) return { name: cond.left.name, narrowedType: NULL_TYPE, kind: "positive" };
    }
    if (cond.left.type === "Identifier" && cond.right.type === "Identifier" && cond.right.name === "undefined") {
      return { name: cond.left.name, narrowedType: UNDEFINED, kind: "positive" };
    }
  }

  // typeof x !== "string" → narrow negatively
  if (cond.operator === "!==" || cond.operator === "!=") {
    const leftIsTypeof = (cond.left.type === "TypeofExpression") ||
      (cond.left.type === "UnaryExpression" && (cond.left as any).operator === "typeof");
    if (leftIsTypeof && cond.right.type === "Literal" && typeof cond.right.value === "string") {
      const arg = (cond.left as any).argument;
      if (arg && arg.type === "Identifier") {
        const mapped = TYPEOF_MAP[cond.right.value as string];
        if (mapped) return { name: arg.name, narrowedType: mapped, kind: "negative" };
      }
    }
    // x !== null → narrow out null
    if (cond.left.type === "Identifier" && cond.right.type === "Literal") {
      if (cond.right.value === null) return { name: cond.left.name, narrowedType: NULL_TYPE, kind: "negative" };
    }
    if (cond.left.type === "Identifier" && cond.right.type === "Identifier" && cond.right.name === "undefined") {
      return { name: cond.left.name, narrowedType: UNDEFINED, kind: "negative" };
    }
  }

  // x instanceof MyClass
  if (cond.operator === "instanceof" as any && cond.left.type === "Identifier" && cond.right.type === "Identifier") {
    return { name: cond.left.name, narrowedType: { kind: "named", name: cond.right.name }, kind: "positive" };
  }
  return null;
}

/**
 * Apply a positive type guard: narrow the variable to the given type.
 */
function applyPositiveNarrowing(name: string, narrowedType: NType, env: TypeEnv): void {
  env.define(name, narrowedType, env.isAnnotated(name));
}

/**
 * Apply a negative type guard: remove the given type from the variable's current type.
 * e.g., x: string | number, narrowedType: string → x becomes number
 */
function applyNegativeNarrowing(name: string, excludeType: NType, env: TypeEnv): void {
  const current = env.lookup(name);
  if (!current || current.kind === "any") return;

  if (current.kind === "union") {
    const remaining = current.types.filter(t => !isAssignableTo(t, excludeType, env));
    if (remaining.length === 0) return;
    if (remaining.length === 1) {
      env.define(name, remaining[0], env.isAnnotated(name));
    } else {
      env.define(name, { kind: "union", types: remaining }, env.isAnnotated(name));
    }
  }
}

/**
 * Apply a type guard to the environment.
 */
function applyGuard(guard: TypeGuard, env: TypeEnv): void {
  if (guard.kind === "positive") {
    applyPositiveNarrowing(guard.name, guard.narrowedType, env);
  } else {
    applyNegativeNarrowing(guard.name, guard.narrowedType, env);
  }
}

/**
 * Apply the inverse of a type guard (for else branches).
 */
function applyInverseGuard(guard: TypeGuard, env: TypeEnv): void {
  if (guard.kind === "positive") {
    applyNegativeNarrowing(guard.name, guard.narrowedType, env);
  } else {
    applyPositiveNarrowing(guard.name, guard.narrowedType, env);
  }
}

// ── Cross-File Type Resolution ──────────────────────────────────

const moduleTypeCache = new Map<string, Map<string, NType>>();

interface CrossFileDeps {
  resolveImport: (source: string, fromFile: string) => string | null;
  compileToAST: (source: string) => Program;
}

let crossFileDeps: CrossFileDeps | null = null;
let crossFileDepsProbed = false;

/**
 * Cross-file type resolution needs `./resolver.js` and `./compile.js`. Those
 * only exist next to the *compiled* checker (dist/), not in the TypeScript tree,
 * so under ts-node (which is what `bin/nodeon.js` and the language server use)
 * the require fails. Probe once, explicitly, instead of throwing a
 * MODULE_NOT_FOUND inside every import statement.
 */
function getCrossFileDeps(): CrossFileDeps | null {
  if (crossFileDepsProbed) return crossFileDeps;
  crossFileDepsProbed = true;
  try {
    const resolver = require("./resolver.js");
    const compiler = require("./compile.js");
    if (typeof resolver?.resolveImport === "function" && typeof compiler?.compileToAST === "function") {
      crossFileDeps = { resolveImport: resolver.resolveImport, compileToAST: compiler.compileToAST };
    }
  } catch {
    crossFileDeps = null; // bootstrap tree — cross-file checking stays disabled
  }
  return crossFileDeps;
}

/**
 * Extract exported type information from a module's AST statements.
 */
function extractExportedTypes(stmts: Statement[]): Map<string, NType> {
  const exports = new Map<string, NType>();
  for (const stmt of stmts) {
    if (stmt.type === "ExportDeclaration") {
      const decl = (stmt as ExportDeclaration).declaration;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration") {
        const fn = decl as FunctionDeclaration;
        const paramTypes = fn.params.map((p: Param) => annotationToType(p.typeAnnotation));
        const retType = annotationToType(fn.returnType);
        exports.set(fn.name.name, { kind: "function", params: paramTypes, returnType: retType });
      } else if (decl.type === "VariableDeclaration") {
        const v = decl as VariableDeclaration;
        if (v.name) {
          const t = v.typeAnnotation ? annotationToType(v.typeAnnotation) : ANY;
          exports.set(v.name.name, t);
        }
      } else if (decl.type === "ClassDeclaration") {
        const cls = decl as ClassDeclaration;
        exports.set(cls.name.name, { kind: "named", name: cls.name.name });
      } else if (decl.type === "InterfaceDeclaration") {
        const iface = decl as InterfaceDeclaration;
        exports.set(iface.name.name, { kind: "named", name: iface.name.name });
      } else if (decl.type === "TypeAliasDeclaration") {
        const alias = decl as TypeAliasDeclaration;
        exports.set(alias.name.name, { kind: "named", name: alias.name.name });
      }
    }
    // Top-level exported function/class/variable (export fn foo, export class Bar)
    if (stmt.type === "FunctionDeclaration" && (stmt as any).exported) {
      const fn = stmt as FunctionDeclaration;
      const paramTypes = fn.params.map((p: Param) => annotationToType(p.typeAnnotation));
      exports.set(fn.name.name, { kind: "function", params: paramTypes, returnType: annotationToType(fn.returnType) });
    }
    if (stmt.type === "ClassDeclaration" && (stmt as any).exported) {
      exports.set((stmt as ClassDeclaration).name.name, { kind: "named", name: (stmt as ClassDeclaration).name.name });
    }
  }
  return exports;
}

/**
 * Resolve types from an imported module.
 * For .no relative imports, parse the source file and extract exported types.
 * For npm/builtin imports, returns empty map (all types default to any).
 */
function resolveModuleTypes(source: string, env: TypeEnv): Map<string, NType> {
  // Only resolve relative .no imports
  if (!source || (!source.startsWith("./") && !source.startsWith("../"))) {
    return new Map();
  }

  // Without the importing file we cannot resolve the specifier at all. This is
  // the normal case: no call site in the tree passes `filePath` today.
  if (!env.filePath) return new Map();

  const deps = getCrossFileDeps();
  if (!deps) return new Map();

  // Cache key is (importing file, specifier) — keying on the bare specifier
  // collides as soon as two files import the same relative name.
  const key = env.filePath + " " + source;
  const cached = moduleTypeCache.get(key);
  if (cached) return cached;

  let types = new Map<string, NType>();
  try {
    const fs = require("fs");
    const resolved = deps.resolveImport(source, env.filePath);
    if (resolved && fs.existsSync(resolved)) {
      const fileSource = fs.readFileSync(resolved, "utf8");
      types = extractExportedTypes(deps.compileToAST(fileSource).body);
    }
  } catch {
    // Unreadable / unparsable imported file: imported names stay `any`.
    types = new Map();
  }
  moduleTypeCache.set(key, types);
  return types;
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
        if (!isAssignableTo(initType, declaredType, env)) {
          diags.push({
            line: getLine(stmt), column: getCol(stmt),
            message: `Type '${typeToString(initType)}' is not assignable to type '${typeToString(declaredType)}'`,
            severity: "error",
          });
        }
      }
      const resolvedType = declaredType.kind !== "any" ? declaredType : initType;
      if (stmt.name) env.define(stmt.name.name, resolvedType, !!stmt.typeAnnotation && declaredType.kind !== "any");
      checkFunctionExpressionReturns(stmt.value, env, diags, getLine(stmt), getCol(stmt));
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
      for (let i = 0; i < fn.params.length; i++) {
        env.define(fn.params[i].name, paramTypes[i], !!fn.params[i].typeAnnotation && paramTypes[i].kind !== "any");
      }
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
      checkExpressionStatement(stmt, env, diags);
      break;
    }
    case "IfStatement": {
      inferExpression(stmt.condition, env);
      const guard = extractTypeGuard(stmt.condition);
      // Consequent: apply guard
      env.push();
      if (guard) applyGuard(guard, env);
      checkStatements(stmt.consequent, env, diags);
      env.pop();
      // Alternate: apply inverse guard
      if (stmt.alternate) {
        env.push();
        if (guard) applyInverseGuard(guard, env);
        checkStatements(stmt.alternate, env, diags);
        env.pop();
      }
      break;
    }
    case "MatchStatement": {
      // Exhaustiveness: check that all union members are covered
      const matchExpr = (stmt as any).discriminant ?? (stmt as any).expression;
      if (matchExpr) {
        const exprType = inferExpression(matchExpr, env);
        const cases = (stmt as any).cases || [];
        let hasDefault = false;
        for (const c of cases) {
          if (c.isDefault || !c.pattern) hasDefault = true;
          env.push();
          if (c.guard) inferExpression(c.guard, env);
          checkStatements(c.body || [], env, diags);
          env.pop();
        }
        // Warn if union type is not exhaustively matched and no default
        if (!hasDefault && exprType.kind === "union") {
          diags.push({
            line: getLine(stmt), column: getCol(stmt),
            message: `Match may not be exhaustive. Consider adding a default case.`,
            severity: "warning",
          });
        }
      }
      break;
    }
    case "SwitchStatement": {
      const switchExpr = (stmt as any).discriminant;
      if (switchExpr) inferExpression(switchExpr, env);
      const cases = (stmt as any).cases || [];
      let hasDefault = false;
      for (const c of cases) {
        if (c.isDefault) hasDefault = true;
        env.push();
        checkStatements(c.body || c.consequent || [], env, diags);
        env.pop();
      }
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
      // Try cross-file type resolution
      const exportedTypes = resolveModuleTypes(imp.source, env);
      if (imp.defaultImport) {
        env.define(imp.defaultImport, exportedTypes.get("default") ?? ANY);
      }
      if (imp.namespaceImport) env.define(imp.namespaceImport, ANY);
      for (const spec of imp.namedImports) {
        const resolved = exportedTypes.get(spec.name) ?? ANY;
        env.define(spec.alias ?? spec.name, resolved);
      }
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
    case "TypeAliasDeclaration": {
      const alias = stmt as TypeAliasDeclaration;
      env.typeAliases.set(alias.name.name, { annotation: alias.value, typeParams: alias.typeParams || [] });
      env.define(alias.name.name, { kind: "named", name: alias.name.name });
      break;
    }
    case "LabeledStatement":
      checkStatement((stmt as any).body, env, diags);
      break;
    case "GoStatement": {
      const goStmt = stmt as any;
      if (goStmt.expression) inferExpression(goStmt.expression, env);
      if (goStmt.body) { env.push(); checkStatements(goStmt.body, env, diags); env.pop(); }
      break;
    }
    case "InterfaceDeclaration": {
      registerInterface(stmt as InterfaceDeclaration, env);
      break;
    }
  }
}

/**
 * Register an interface's members for conformance *and* structural checking,
 * and bind its name in the current scope.
 */
function registerInterface(iface: InterfaceDeclaration, env: TypeEnv): void {
  env.define(iface.name.name, { kind: "named", name: iface.name.name });
  const members = new Map<string, { type: NType; optional: boolean; method: boolean }>();
  for (const prop of iface.properties) {
    const propType = prop.method
      ? { kind: "function" as const, params: (prop.params || []).map(annotationToType), returnType: annotationToType(prop.valueType) }
      : annotationToType(prop.valueType);
    members.set(prop.name.name, { type: propType, optional: prop.optional, method: prop.method });
  }
  const extendNames = (iface.extends || []).map(id => id.name);
  env.interfaces.set(iface.name.name, { name: iface.name.name, members, extends: extendNames });
}

/**
 * Hoist top-level type aliases and interfaces so forward references resolve.
 * Only declarations at the top level are hoisted; nested declarations stay
 * order-dependent, exactly as before.
 */
function collectTypeDeclarations(stmts: Statement[], env: TypeEnv): void {
  for (const stmt of stmts) {
    if (stmt.type === "TypeAliasDeclaration") {
      const alias = stmt as TypeAliasDeclaration;
      env.typeAliases.set(alias.name.name, { annotation: alias.value, typeParams: alias.typeParams || [] });
      env.define(alias.name.name, { kind: "named", name: alias.name.name });
    } else if (stmt.type === "InterfaceDeclaration") {
      registerInterface(stmt as InterfaceDeclaration, env);
    } else if (stmt.type === "ExportDeclaration" && stmt.declaration) {
      collectTypeDeclarations([stmt.declaration], env);
    }
  }
}

/**
 * Check an `x = value` re-assignment. Nodeon has no redeclaration concept — the
 * first `x = v` parses as a VariableDeclaration, every later one as an
 * ExpressionStatement — so only *annotated* bindings are enforced, and there
 * is no "already declared" diagnostic of any kind.
 */
function checkAssignment(expr: any, env: TypeEnv, diags: TypeDiagnostic[], line: number, column: number): void {
  if (!expr || expr.type !== "AssignmentExpression") return;
  // `a = b = v` — check each link of the chain.
  if (expr.right && expr.right.type === "AssignmentExpression") {
    checkAssignment(expr.right, env, diags, line, column);
  }
  const lhs = expr.left;
  if (!lhs || lhs.type !== "Identifier") { inferExpression(expr, env); return; }
  const declared = env.lookup(lhs.name);
  if (!declared || declared.kind === "any" || !env.isAnnotated(lhs.name)) {
    inferExpression(expr, env);
    return;
  }
  const valueType = inferExpression(expr.right, env);
  if (valueType.kind === "any") return;
  if (!isAssignableTo(valueType, declared, env)) {
    diags.push({
      line, column,
      message: `Type '${typeToString(valueType)}' is not assignable to type '${typeToString(declared)}'`,
      severity: "error",
    });
  }
}

function checkExpressionStatement(stmt: ExpressionStatement, env: TypeEnv, diags: TypeDiagnostic[]): void {
  const expr: any = stmt.expression;
  if (expr && expr.type === "AssignmentExpression") {
    checkAssignment(expr, env, diags, getLine(stmt), getCol(stmt));
    return;
  }
  if (expr && (expr.type === "ArrowFunction" || expr.type === "FunctionExpression")) {
    checkFunctionExpressionReturns(expr, env, diags, getLine(stmt), getCol(stmt));
    return;
  }
  inferExpression(expr, env);
}

/**
 * Check the declared return type of an arrow / anonymous function, whether its
 * body is a block (`{ return x }`) or a bare expression (`=> x`).
 */
function checkFunctionExpressionReturns(value: any, env: TypeEnv, diags: TypeDiagnostic[], line: number, column: number): void {
  if (!value || (value.type !== "ArrowFunction" && value.type !== "FunctionExpression")) return;
  const retType = annotationToType(value.returnType);
  if (retType.kind === "any") return;

  const tpNames: string[] = value.typeParams || [];
  env.push();
  for (const tp of tpNames) env.defineTypeParam(tp);
  for (const p of value.params || []) {
    const ann = annotationToType(p.typeAnnotation);
    env.define(p.name, ann, !!p.typeAnnotation && ann.kind !== "any");
  }
  try {
    if (Array.isArray(value.body)) {
      // Block body — every `return` must match. Skip a bare-`return` function.
      if (retType.kind !== "typeParam") checkReturnTypes(value.body, retType, env, diags);
    } else if (value.body && value.body.type) {
      // Expression body — the tail expression is the return value.
      const actual = inferExpression(value.body, env);
      if (actual.kind !== "any" && !isAssignableTo(actual, retType, env)) {
        diags.push({
          line, column,
          message: `Type '${typeToString(actual)}' is not assignable to return type '${typeToString(retType)}'`,
          severity: "error",
        });
      }
    }
  } finally {
    env.pop();
  }
}

// ── Interface Conformance ────────────────────────────────────────

/**
 * Collect all required members from an interface, including inherited ones.
 */
function collectInterfaceMembers(
  ifaceName: string,
  env: TypeEnv,
  seen: Set<string> = new Set(),
): Map<string, { type: NType; optional: boolean; method: boolean }> {
  const iface = env.interfaces.get(ifaceName);
  if (!iface) return new Map();
  if (seen.has(ifaceName)) return new Map(); // `interface A extends A` guard
  seen.add(ifaceName);

  const all = new Map<string, { type: NType; optional: boolean; method: boolean }>();

  // First collect from parent interfaces
  for (const parent of iface.extends) {
    const parentMembers = collectInterfaceMembers(parent, env, seen);
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

/**
 * Walk every statement form that can contain a `return` and verify it against
 * `expected`. Narrowing guards are re-applied inside branches so that a
 * `typeof`/`instanceof`-guarded return is checked against the narrowed type,
 * and each recursion gets its own scope so narrowing never leaks.
 */
function checkReturnTypes(body: Statement[], expected: NType, env: TypeEnv, diags: TypeDiagnostic[]): void {
  for (const stmt of body) {
    switch (stmt.type) {
      case "ReturnStatement": {
        const value = (stmt as any).value;
        if (!value) break;
        const actual = inferExpression(value, env);
        if (actual.kind !== "any" && !isAssignableTo(actual, expected, env)) {
          diags.push({
            line: getLine(stmt), column: getCol(stmt),
            message: `Type '${typeToString(actual)}' is not assignable to return type '${typeToString(expected)}'`,
            severity: "error",
          });
        }
        break;
      }
      case "IfStatement": {
        const guard = extractTypeGuard((stmt as any).condition);
        env.push();
        if (guard) applyGuard(guard, env);
        checkReturnTypes(stmt.consequent, expected, env, diags);
        env.pop();
        if (stmt.alternate) {
          env.push();
          if (guard) applyInverseGuard(guard, env);
          checkReturnTypes(stmt.alternate, expected, env, diags);
          env.pop();
        }
        break;
      }
      case "ForStatement": {
        env.push();
        if ((stmt as any).variable?.type === "Identifier") env.define((stmt as any).variable.name, ANY);
        checkReturnTypes((stmt as any).body ?? [], expected, env, diags);
        env.pop();
        break;
      }
      case "WhileStatement":
      case "DoWhileStatement": {
        env.push();
        checkReturnTypes((stmt as any).body ?? [], expected, env, diags);
        env.pop();
        break;
      }
      case "SwitchStatement": {
        for (const c of ((stmt as any).cases ?? [])) {
          env.push();
          checkReturnTypes(c.consequent ?? c.body ?? [], expected, env, diags);
          env.pop();
        }
        break;
      }
      case "MatchStatement": {
        for (const c of ((stmt as any).cases ?? [])) {
          env.push();
          checkReturnTypes(c.body ?? [], expected, env, diags);
          env.pop();
        }
        break;
      }
      case "TryCatchStatement": {
        env.push(); checkReturnTypes((stmt as any).tryBlock ?? [], expected, env, diags); env.pop();
        env.push();
        if ((stmt as any).catchParam) env.define((stmt as any).catchParam.name, ANY);
        checkReturnTypes((stmt as any).catchBlock ?? [], expected, env, diags);
        env.pop();
        if ((stmt as any).finallyBlock) {
          env.push(); checkReturnTypes((stmt as any).finallyBlock, expected, env, diags); env.pop();
        }
        break;
      }
      case "LabeledStatement": {
        const inner = (stmt as any).body;
        if (inner) checkReturnTypes([inner], expected, env, diags);
        break;
      }
      case "GoStatement": {
        const body = (stmt as any).body;
        if (Array.isArray(body)) {
          env.push(); checkReturnTypes(body, expected, env, diags); env.pop();
        }
        break;
      }
      default:
        break;
    }
  }
}

// ── Public API ───────────────────────────────────────────────────

export function typeCheck(ast: Program, filePath?: string): TypeDiagnostic[] {
  const diags: TypeDiagnostic[] = [];
  const env = new TypeEnv();
  if (filePath) env.filePath = filePath;
  // Imported-module types are cached per (importing file, specifier); a new run
  // must not reuse another run's view of the filesystem (language server).
  moduleTypeCache.clear();
  collectTypeDeclarations(ast.body, env);
  checkStatements(ast.body, env, diags);
  return diags;
}
