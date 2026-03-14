/**
 * AST Visitor / Walker Pattern
 *
 * Generic traversal utilities for the Nodeon AST.
 * Eliminates duplicated switch statements across the codebase.
 */

import {
  Program, Statement, Expression,
  FunctionDeclaration, ClassDeclaration, ClassMethod, ClassField,
  IfStatement, ForStatement, WhileStatement, DoWhileStatement,
  TryCatchStatement, SwitchStatement, MatchStatement,
  ExportDeclaration, LabeledStatement,
  CallExpression, BinaryExpression, MemberExpression,
  ArrayExpression, ObjectExpression, ArrowFunction,
  AssignmentExpression, CompoundAssignmentExpression,
  NewExpression, TernaryExpression, TemplateLiteral,
  Param,
} from "./nodes";

// ── Visitor Interfaces ─────────────────────────────────────────────

export interface StatementVisitor {
  FunctionDeclaration?: (stmt: FunctionDeclaration) => void;
  VariableDeclaration?: (stmt: any) => void;
  DestructuringDeclaration?: (stmt: any) => void;
  ExpressionStatement?: (stmt: any) => void;
  IfStatement?: (stmt: IfStatement) => void;
  ForStatement?: (stmt: ForStatement) => void;
  WhileStatement?: (stmt: WhileStatement) => void;
  DoWhileStatement?: (stmt: DoWhileStatement) => void;
  ReturnStatement?: (stmt: any) => void;
  ImportDeclaration?: (stmt: any) => void;
  ExportDeclaration?: (stmt: ExportDeclaration) => void;
  ClassDeclaration?: (stmt: ClassDeclaration) => void;
  TryCatchStatement?: (stmt: TryCatchStatement) => void;
  ThrowStatement?: (stmt: any) => void;
  SwitchStatement?: (stmt: SwitchStatement) => void;
  MatchStatement?: (stmt: MatchStatement) => void;
  EnumDeclaration?: (stmt: any) => void;
  InterfaceDeclaration?: (stmt: any) => void;
  TypeAliasDeclaration?: (stmt: any) => void;
  BreakStatement?: (stmt: any) => void;
  ContinueStatement?: (stmt: any) => void;
  DebuggerStatement?: (stmt: any) => void;
  LabeledStatement?: (stmt: LabeledStatement) => void;
}

export interface ExpressionVisitor {
  Identifier?: (expr: any) => void;
  Literal?: (expr: any) => void;
  CallExpression?: (expr: CallExpression) => void;
  BinaryExpression?: (expr: BinaryExpression) => void;
  UnaryExpression?: (expr: any) => void;
  UpdateExpression?: (expr: any) => void;
  TemplateLiteral?: (expr: TemplateLiteral) => void;
  MemberExpression?: (expr: MemberExpression) => void;
  ArrayExpression?: (expr: ArrayExpression) => void;
  ObjectExpression?: (expr: ObjectExpression) => void;
  ArrowFunction?: (expr: ArrowFunction) => void;
  AssignmentExpression?: (expr: AssignmentExpression) => void;
  CompoundAssignmentExpression?: (expr: CompoundAssignmentExpression) => void;
  NewExpression?: (expr: NewExpression) => void;
  AwaitExpression?: (expr: any) => void;
  SpreadExpression?: (expr: any) => void;
  TernaryExpression?: (expr: TernaryExpression) => void;
  TypeofExpression?: (expr: any) => void;
  VoidExpression?: (expr: any) => void;
  DeleteExpression?: (expr: any) => void;
  YieldExpression?: (expr: any) => void;
  AsExpression?: (expr: any) => void;
  RegExpLiteral?: (expr: any) => void;
  ObjectPattern?: (expr: any) => void;
  ArrayPattern?: (expr: any) => void;
}

// ── Walk Functions ─────────────────────────────────────────────────

/**
 * Walk all statements in a program, calling the visitor for each.
 * Automatically recurses into nested blocks (functions, if, for, etc.).
 */
export function walkProgram(program: Program, stmtVisitor?: StatementVisitor, exprVisitor?: ExpressionVisitor): void {
  for (const stmt of program.body) {
    walkStatement(stmt, stmtVisitor, exprVisitor);
  }
}

export function walkStatement(stmt: Statement, sv?: StatementVisitor, ev?: ExpressionVisitor): void {
  // Call the visitor for this statement type
  const handler = sv?.[stmt.type as keyof StatementVisitor];
  if (handler) (handler as any)(stmt);

  // Recurse into child statements and expressions
  switch (stmt.type) {
    case "FunctionDeclaration":
      for (const p of stmt.params) walkParam(p, ev);
      walkStatements(stmt.body, sv, ev);
      break;
    case "VariableDeclaration":
      walkExpression(stmt.value, ev);
      break;
    case "DestructuringDeclaration":
      walkExpression(stmt.value, ev);
      break;
    case "ExpressionStatement":
      walkExpression(stmt.expression, ev);
      break;
    case "IfStatement":
      walkExpression(stmt.condition, ev);
      walkStatements(stmt.consequent, sv, ev);
      if (stmt.alternate) walkStatements(stmt.alternate, sv, ev);
      break;
    case "ForStatement":
      walkExpression(stmt.iterable, ev);
      walkStatements(stmt.body, sv, ev);
      break;
    case "WhileStatement":
      walkExpression(stmt.condition, ev);
      walkStatements(stmt.body, sv, ev);
      break;
    case "DoWhileStatement":
      walkExpression(stmt.condition, ev);
      walkStatements(stmt.body, sv, ev);
      break;
    case "ReturnStatement":
      if (stmt.value) walkExpression(stmt.value, ev);
      break;
    case "ExportDeclaration":
      if (stmt.declaration) walkStatement(stmt.declaration, sv, ev);
      break;
    case "ClassDeclaration":
      for (const m of stmt.body) walkClassMember(m, sv, ev);
      break;
    case "TryCatchStatement":
      walkStatements(stmt.tryBlock, sv, ev);
      walkStatements(stmt.catchBlock, sv, ev);
      if (stmt.finallyBlock) walkStatements(stmt.finallyBlock, sv, ev);
      break;
    case "ThrowStatement":
      walkExpression(stmt.value, ev);
      break;
    case "SwitchStatement":
      walkExpression(stmt.discriminant, ev);
      for (const c of stmt.cases) {
        if (c.test) walkExpression(c.test, ev);
        walkStatements(c.consequent, sv, ev);
      }
      break;
    case "MatchStatement":
      walkExpression(stmt.discriminant, ev);
      for (const c of stmt.cases) {
        if (c.pattern) walkExpression(c.pattern, ev);
        if (c.guard) walkExpression(c.guard, ev);
        walkStatements(c.body, sv, ev);
      }
      break;
    case "LabeledStatement":
      walkStatement(stmt.body, sv, ev);
      break;
    // ImportDeclaration, EnumDeclaration, InterfaceDeclaration,
    // TypeAliasDeclaration, BreakStatement, ContinueStatement,
    // DebuggerStatement — no child nodes to recurse into
  }
}

export function walkStatements(stmts: Statement[], sv?: StatementVisitor, ev?: ExpressionVisitor): void {
  for (const s of stmts) walkStatement(s, sv, ev);
}

export function walkExpression(expr: Expression, ev?: ExpressionVisitor): void {
  if (!ev) return;

  const handler = ev[expr.type as keyof ExpressionVisitor];
  if (handler) (handler as any)(expr);

  switch (expr.type) {
    case "CallExpression":
      walkExpression(expr.callee, ev);
      for (const a of expr.arguments) walkExpression(a, ev);
      break;
    case "BinaryExpression":
      walkExpression(expr.left, ev);
      walkExpression(expr.right, ev);
      break;
    case "UnaryExpression":
    case "AwaitExpression":
    case "SpreadExpression":
    case "TypeofExpression":
    case "VoidExpression":
    case "DeleteExpression":
      walkExpression(expr.argument, ev);
      break;
    case "UpdateExpression":
      walkExpression(expr.argument, ev);
      break;
    case "MemberExpression":
      walkExpression(expr.object, ev);
      walkExpression(expr.property, ev);
      break;
    case "ArrayExpression":
      for (const e of expr.elements) walkExpression(e, ev);
      break;
    case "ObjectExpression":
      for (const p of expr.properties) {
        walkExpression(p.key as Expression, ev);
        walkExpression(p.value, ev);
      }
      break;
    case "ArrowFunction":
      for (const p of expr.params) walkParam(p, ev);
      if (Array.isArray(expr.body)) {
        // Statement body — but we only have ExpressionVisitor here
        // walkStatements would need both visitors; skip statement walking
      } else {
        walkExpression(expr.body, ev);
      }
      break;
    case "AssignmentExpression":
      walkExpression(expr.left, ev);
      walkExpression(expr.right, ev);
      break;
    case "CompoundAssignmentExpression":
      walkExpression(expr.left, ev);
      walkExpression(expr.right, ev);
      break;
    case "NewExpression":
      walkExpression(expr.callee, ev);
      for (const a of expr.arguments) walkExpression(a, ev);
      break;
    case "TernaryExpression":
      walkExpression(expr.condition, ev);
      walkExpression(expr.consequent, ev);
      walkExpression(expr.alternate, ev);
      break;
    case "TemplateLiteral":
      for (const part of expr.parts) {
        if (part.kind === "Expression") walkExpression(part.expression, ev);
      }
      break;
    case "YieldExpression":
      if (expr.argument) walkExpression(expr.argument, ev);
      break;
    case "AsExpression":
      walkExpression(expr.expression, ev);
      break;
    // Identifier, Literal, RegExpLiteral, ObjectPattern, ArrayPattern
    // — leaf nodes, no children to recurse into
  }
}

function walkClassMember(member: ClassMethod | ClassField, sv?: StatementVisitor, ev?: ExpressionVisitor): void {
  if (member.type === "ClassField") {
    if (member.value) walkExpression(member.value, ev);
  } else {
    for (const p of member.params) walkParam(p, ev);
    walkStatements(member.body, sv, ev);
  }
}

function walkParam(p: Param, ev?: ExpressionVisitor): void {
  if (p.defaultValue && ev) walkExpression(p.defaultValue, ev);
}

// ── Convenience: Collect all expressions of a given type ────────────

/**
 * Collect all identifiers referenced in a program.
 */
export function collectIdentifiers(program: Program): string[] {
  const names: string[] = [];
  walkProgram(program, undefined, {
    Identifier: (expr) => names.push(expr.name),
  });
  return names;
}

/**
 * Collect all function declarations in a program (top-level only).
 */
export function collectFunctions(program: Program): FunctionDeclaration[] {
  const fns: FunctionDeclaration[] = [];
  walkProgram(program, {
    FunctionDeclaration: (stmt) => fns.push(stmt),
  });
  return fns;
}

/**
 * Collect all class declarations in a program.
 */
export function collectClasses(program: Program): ClassDeclaration[] {
  const classes: ClassDeclaration[] = [];
  walkProgram(program, {
    ClassDeclaration: (stmt) => classes.push(stmt),
  });
  return classes;
}
