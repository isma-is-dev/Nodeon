export function walkProgram(program, stmtVisitor, exprVisitor) {
  for (const stmt of program.body) {
    walkStatement(stmt, stmtVisitor, exprVisitor);
  }
}
export function walkStatement(stmt, sv, ev) {
  if (sv) {
    const handler = sv[stmt.type];
    if (handler) {
      handler(stmt);
    }
  }
  switch (stmt.type) {
    case "FunctionDeclaration": {
      for (const p of stmt.params) {
        walkParam(p, ev);
      }
      walkStatements(stmt.body, sv, ev);
      break;
    }
    case "VariableDeclaration": {
      walkExpression(stmt.value, ev);
      break;
    }
    case "DestructuringDeclaration": {
      walkExpression(stmt.value, ev);
      break;
    }
    case "ExpressionStatement": {
      walkExpression(stmt.expression, ev);
      break;
    }
    case "IfStatement": {
      walkExpression(stmt.condition, ev);
      walkStatements(stmt.consequent, sv, ev);
      if (stmt.alternate) {
        walkStatements(stmt.alternate, sv, ev);
      }
      break;
    }
    case "ForStatement": {
      walkExpression(stmt.iterable, ev);
      walkStatements(stmt.body, sv, ev);
      break;
    }
    case "WhileStatement": {
      walkExpression(stmt.condition, ev);
      walkStatements(stmt.body, sv, ev);
      break;
    }
    case "DoWhileStatement": {
      walkExpression(stmt.condition, ev);
      walkStatements(stmt.body, sv, ev);
      break;
    }
    case "ReturnStatement": {
      if (stmt.value) {
        walkExpression(stmt.value, ev);
      }
      break;
    }
    case "ExportDeclaration": {
      if (stmt.declaration) {
        walkStatement(stmt.declaration, sv, ev);
      }
      break;
    }
    case "ClassDeclaration": {
      for (const m of stmt.body) {
        walkClassMember(m, sv, ev);
      }
      break;
    }
    case "TryCatchStatement": {
      walkStatements(stmt.tryBlock, sv, ev);
      walkStatements(stmt.catchBlock, sv, ev);
      if (stmt.finallyBlock) {
        walkStatements(stmt.finallyBlock, sv, ev);
      }
      break;
    }
    case "ThrowStatement": {
      walkExpression(stmt.value, ev);
      break;
    }
    case "SwitchStatement": {
      walkExpression(stmt.discriminant, ev);
      for (const c of stmt.cases) {
        if (c.test) {
          walkExpression(c.test, ev);
        }
        walkStatements(c.consequent, sv, ev);
      }
      break;
    }
    case "MatchStatement": {
      walkExpression(stmt.discriminant, ev);
      for (const c of stmt.cases) {
        if (c.pattern) {
          walkExpression(c.pattern, ev);
        }
        if (c.guard) {
          walkExpression(c.guard, ev);
        }
        walkStatements(c.body, sv, ev);
      }
      break;
    }
    case "LabeledStatement": {
      walkStatement(stmt.body, sv, ev);
      break;
    }
    default: {

      break;
    }
  }
}
export function walkStatements(stmts, sv, ev) {
  for (const s of stmts) {
    walkStatement(s, sv, ev);
  }
}
export function walkExpression(expr, ev) {
  if (!ev) {
    return;
  }
  const handler = ev[expr.type];
  if (handler) {
    handler(expr);
  }
  switch (expr.type) {
    case "CallExpression": {
      walkExpression(expr.callee, ev);
      for (const a of expr.arguments) {
        walkExpression(a, ev);
      }
      break;
    }
    case "BinaryExpression": {
      walkExpression(expr.left, ev);
      walkExpression(expr.right, ev);
      break;
    }
    case "UnaryExpression": {
      walkExpression(expr.argument, ev);
      break;
    }
    case "AwaitExpression": {
      walkExpression(expr.argument, ev);
      break;
    }
    case "SpreadExpression": {
      walkExpression(expr.argument, ev);
      break;
    }
    case "TypeofExpression": {
      walkExpression(expr.argument, ev);
      break;
    }
    case "VoidExpression": {
      walkExpression(expr.argument, ev);
      break;
    }
    case "DeleteExpression": {
      walkExpression(expr.argument, ev);
      break;
    }
    case "UpdateExpression": {
      walkExpression(expr.argument, ev);
      break;
    }
    case "MemberExpression": {
      walkExpression(expr.object, ev);
      walkExpression(expr.property, ev);
      break;
    }
    case "ArrayExpression": {
      for (const e of expr.elements) {
        walkExpression(e, ev);
      }
      break;
    }
    case "ObjectExpression": {
      for (const p of expr.properties) {
        walkExpression(p.key, ev);
        walkExpression(p.value, ev);
      }
      break;
    }
    case "ArrowFunction": {
      for (const p of expr.params) {
        walkParam(p, ev);
      }
      if (!Array.isArray(expr.body)) {
        walkExpression(expr.body, ev);
      }
      break;
    }
    case "AssignmentExpression": {
      walkExpression(expr.left, ev);
      walkExpression(expr.right, ev);
      break;
    }
    case "CompoundAssignmentExpression": {
      walkExpression(expr.left, ev);
      walkExpression(expr.right, ev);
      break;
    }
    case "NewExpression": {
      walkExpression(expr.callee, ev);
      for (const a of expr.arguments) {
        walkExpression(a, ev);
      }
      break;
    }
    case "TernaryExpression": {
      walkExpression(expr.condition, ev);
      walkExpression(expr.consequent, ev);
      walkExpression(expr.alternate, ev);
      break;
    }
    case "TemplateLiteral": {
      for (const part of expr.parts) {
        if (part.kind === "Expression") {
          walkExpression(part.expression, ev);
        }
      }
      break;
    }
    case "YieldExpression": {
      if (expr.argument) {
        walkExpression(expr.argument, ev);
      }
      break;
    }
    case "AsExpression": {
      walkExpression(expr.expression, ev);
      break;
    }
    case "IfExpression": {
      walkExpression(expr.condition, ev);
      break;
    }
    default: {

      break;
    }
  }
}
function walkClassMember(member, sv, ev) {
  if (member.type === "ClassField") {
    if (member.value) {
      walkExpression(member.value, ev);
    }
  } else {
    for (const p of member.params) {
      walkParam(p, ev);
    }
    walkStatements(member.body, sv, ev);
  }
}
function walkParam(p, ev) {
  if (p.defaultValue && ev) {
    walkExpression(p.defaultValue, ev);
  }
}
export function collectIdentifiers(program) {
  const names = [];
  walkProgram(program, undefined, { Identifier: expr => {
    names.push(expr.name);
  } });
  return names;
}
export function collectFunctions(program) {
  const fns = [];
  walkProgram(program, { FunctionDeclaration: stmt => {
    fns.push(stmt);
  } });
  return fns;
}
export function collectClasses(program) {
  const classes = [];
  walkProgram(program, { ClassDeclaration: stmt => {
    classes.push(stmt);
  } });
  return classes;
}