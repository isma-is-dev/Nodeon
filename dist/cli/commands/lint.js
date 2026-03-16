import { GREEN, RED, DIM, YELLOW, CYAN, BOLD, RESET } from "../utils/colors.js";
const fs = require("fs");
const path = require("path");
const BUILTIN_RULES = { "no-unused-vars": { description: "Warn about declared variables that are never used", defaultLevel: "warn", check: checkNoUnusedVars }, "no-any": { description: "Warn when using 'any' type annotation explicitly", defaultLevel: "off", check: checkNoAny }, "no-implicit-return": { description: "Warn when a function lacks an explicit return type annotation", defaultLevel: "off", check: checkNoImplicitReturn }, "prefer-const": { description: "Warn when let is used but never reassigned", defaultLevel: "warn", check: checkPreferConst }, "max-line-length": { description: "Warn when lines exceed a maximum length", defaultLevel: "off", check: checkMaxLineLength, options: { max: 120 } }, "no-console": { description: "Warn when using print/console.log in production code", defaultLevel: "off", check: checkNoConsole }, "no-empty-fn": { description: "Warn about empty function bodies", defaultLevel: "warn", check: checkNoEmptyFn } };
function checkNoUnusedVars(ast, source, opts) {
  const issues = [];
  const declared = new Map();
  const used = new Set();
  function walkStmts(stmts) {
    for (const stmt of stmts) {
      if (stmt.type === "VariableDeclaration" && stmt.name) {
        declared.set(stmt.name.name, stmt);
      }
      if (stmt.type === "FunctionDeclaration" && stmt.name) {
        declared.set(stmt.name.name, stmt);
        for (const p of stmt.params) {
          declared.set(p.name, stmt);
        }
        walkStmts(stmt.body || []);
      }
      if (stmt.type === "IfStatement") {
        walkStmts(stmt.consequent || []);
        if (stmt.alternate) {
          walkStmts(stmt.alternate);
        }
      }
      if (stmt.type === "ForStatement" || stmt.type === "WhileStatement" || stmt.type === "DoWhileStatement") {
        walkStmts(stmt.body || []);
      }
      if (stmt.type === "ExportDeclaration" && stmt.declaration) {
        if (stmt.declaration.name) {
          used.add(stmt.declaration.name.name);
        }
      }
      collectUsedIdentifiers(stmt, used);
    }
  }
  function collectUsedIdentifiers(node, usedSet) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (node.type === "Identifier" && node.name) {
      usedSet.add(node.name);
    }
    const keys = Object.keys(node);
    for (const key of keys) {
      if (key === "name" && node.type === "VariableDeclaration") {
        continue;
      }
      if (key === "name" && node.type === "FunctionDeclaration") {
        continue;
      }
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          collectUsedIdentifiers(item, usedSet);
        }
      } else if (val && typeof val === "object" && val.type) {
        collectUsedIdentifiers(val, usedSet);
      }
    }
  }
  walkStmts(ast.body);
  for (const entry of Array.from(declared)) {
    const name = entry[0];
    const stmt = entry[1];
    if (!used.has(name) && !name.startsWith("_")) {
      issues.push({ rule: "no-unused-vars", message: "'" + name + "' is declared but never used", line: stmt?.loc?.line ?? 0, column: stmt?.loc?.column ?? 0 });
    }
  }
  return issues;
}
function checkNoAny(ast, source, opts) {
  const issues = [];
  function walkNode(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (node.typeAnnotation && node.typeAnnotation.kind === "named" && node.typeAnnotation.name === "any") {
      issues.push({ rule: "no-any", message: "Avoid using 'any' type annotation", line: node?.loc?.line ?? 0, column: node?.loc?.column ?? 0 });
    }
    const keys = Object.keys(node);
    for (const key of keys) {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          walkNode(item);
        }
      } else if (val && typeof val === "object" && val.type) {
        walkNode(val);
      }
    }
  }
  for (const stmt of ast.body) {
    walkNode(stmt);
  }
  return issues;
}
function checkNoImplicitReturn(ast, source, opts) {
  const issues = [];
  for (const stmt of ast.body) {
    if (stmt.type === "FunctionDeclaration" && !stmt.returnType) {
      issues.push({ rule: "no-implicit-return", message: "Function '" + (stmt.name?.name ?? "anonymous") + "' lacks a return type annotation", line: stmt?.loc?.line ?? 0, column: stmt?.loc?.column ?? 0 });
    }
    if (stmt.type === "ExportDeclaration" && stmt.declaration?.type === "FunctionDeclaration" && !stmt.declaration.returnType) {
      issues.push({ rule: "no-implicit-return", message: "Function '" + (stmt.declaration.name?.name ?? "anonymous") + "' lacks a return type annotation", line: stmt?.loc?.line ?? 0, column: stmt?.loc?.column ?? 0 });
    }
  }
  return issues;
}
function checkPreferConst(ast, source, opts) {
  const issues = [];
  const letDecls = new Map();
  const reassigned = new Set();
  function walkStmts(stmts) {
    for (const stmt of stmts) {
      if (stmt.type === "VariableDeclaration" && stmt.kind === "let" && stmt.name) {
        letDecls.set(stmt.name.name, stmt);
      }
      if (stmt.type === "ExpressionStatement" && stmt.expression?.type === "AssignmentExpression") {
        if (stmt.expression.left?.type === "Identifier") {
          reassigned.add(stmt.expression.left.name);
        }
      }
      if (stmt.body) {
        walkStmts(stmt.body);
      }
      if (stmt.consequent) {
        walkStmts(stmt.consequent);
      }
      if (stmt.alternate) {
        walkStmts(stmt.alternate);
      }
    }
  }
  walkStmts(ast.body);
  for (const entry of Array.from(letDecls)) {
    const name = entry[0];
    const stmt = entry[1];
    if (!reassigned.has(name)) {
      issues.push({ rule: "prefer-const", message: "'" + name + "' is never reassigned, use 'const' instead of 'let'", line: stmt?.loc?.line ?? 0, column: stmt?.loc?.column ?? 0 });
    }
  }
  return issues;
}
function checkMaxLineLength(ast, source, opts) {
  const issues = [];
  const maxLen = opts?.max ?? 120;
  const lines = source.split("\n");
  let lineNum = 1;
  for (const line of lines) {
    if (line.length > maxLen) {
      issues.push({ rule: "max-line-length", message: "Line exceeds " + maxLen + " characters (" + line.length + ")", line: lineNum, column: maxLen });
    }
    lineNum = lineNum + 1;
  }
  return issues;
}
function checkNoConsole(ast, source, opts) {
  const issues = [];
  function walkNode(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "print") {
      issues.push({ rule: "no-console", message: "Unexpected 'print' statement", line: node?.loc?.line ?? 0, column: node?.loc?.column ?? 0 });
    }
    if (node.type === "CallExpression" && node.callee?.type === "MemberExpression" && node.callee.object?.name === "console") {
      issues.push({ rule: "no-console", message: "Unexpected 'console." + (node.callee.property?.name ?? "log") + "' call", line: node?.loc?.line ?? 0, column: node?.loc?.column ?? 0 });
    }
    const keys = Object.keys(node);
    for (const key of keys) {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          walkNode(item);
        }
      } else if (val && typeof val === "object" && val.type) {
        walkNode(val);
      }
    }
  }
  for (const stmt of ast.body) {
    walkNode(stmt);
  }
  return issues;
}
function checkNoEmptyFn(ast, source, opts) {
  const issues = [];
  function walkStmts(stmts) {
    for (const stmt of stmts) {
      if (stmt.type === "FunctionDeclaration" && (!stmt.body || stmt.body.length === 0)) {
        issues.push({ rule: "no-empty-fn", message: "Function '" + (stmt.name?.name ?? "anonymous") + "' has an empty body", line: stmt?.loc?.line ?? 0, column: stmt?.loc?.column ?? 0 });
      }
      if (stmt.body) {
        walkStmts(stmt.body);
      }
      if (stmt.consequent) {
        walkStmts(stmt.consequent);
      }
      if (stmt.alternate) {
        walkStmts(stmt.alternate);
      }
    }
  }
  walkStmts(ast.body);
  return issues;
}
function loadLintConfig() {
  const configPath = path.resolve(process.cwd(), "nodeon.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.lint ?? {};
  } catch (e) {
    return {};
  }
}
function collectFiles(inputPath) {
  const absPath = path.resolve(inputPath);
  if (!fs.existsSync(absPath)) {
    return [];
  }
  const stat = fs.statSync(absPath);
  if (stat.isFile() && absPath.endsWith(".no")) {
    return [absPath];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const results = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "dist") {
          continue;
        }
        walk(full);
      } else if (entry.name.endsWith(".no")) {
        results.push(full);
      }
    }
  }
  walk(absPath);
  return results;
}
export function runLint(args) {
  const config = loadLintConfig();
  const inputPath = args[0] ?? "src";
  const fix = args.includes("--fix");
  const ruleConfig = {};
  const ruleNames = Object.keys(BUILTIN_RULES);
  for (const name of ruleNames) {
    const rule = BUILTIN_RULES[name];
    ruleConfig[name] = { level: config[name] ?? rule.defaultLevel, options: config[name + "-options"] ?? rule.options ?? {} };
  }
  const files = collectFiles(inputPath);
  if (files.length === 0) {
    console.log("  " + DIM + "No .no files found in " + inputPath + RESET);
    return;
  }
  const compiler = require("../../compiler/compile.js");
  let totalIssues = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const file of files) {
    try {
      const source = fs.readFileSync(file, "utf8");
      const ast = compiler.compileToAST(source);
      const relFile = path.relative(process.cwd(), file);
      let fileIssues = [];
      for (const name of ruleNames) {
        const rc = ruleConfig[name];
        if (rc.level === "off") {
          continue;
        }
        const rule = BUILTIN_RULES[name];
        const issues = rule.check(ast, source, rc.options);
        for (const issue of issues) {
          issue.level = rc.level;
          fileIssues.push(issue);
        }
      }
      if (fileIssues.length > 0) {
        console.log("");
        console.log("  " + BOLD + relFile + RESET);
        for (const issue of fileIssues) {
          const color = issue.level === "error" ? RED : YELLOW;
          const label = issue.level === "error" ? "error" : "warn ";
          console.log("    " + color + label + RESET + " " + issue.message + " " + DIM + "(" + issue.rule + " L" + issue.line + ")" + RESET);
          if (issue.level === "error") {
            totalErrors = totalErrors + 1;
          }
          if (issue.level === "warn") {
            totalWarnings = totalWarnings + 1;
          }
          totalIssues = totalIssues + 1;
        }
      }
    } catch (err) {
      console.log("  " + RED + "✗" + RESET + " " + path.relative(process.cwd(), file) + ": " + err.message);
    }
  }
  console.log("");
  if (totalIssues === 0) {
    console.log("  " + GREEN + "✓ No lint issues found" + RESET + " " + DIM + "(" + files.length + " files)" + RESET);
  } else {
    console.log("  " + totalIssues + " issues " + DIM + "(" + totalErrors + " errors, " + totalWarnings + " warnings, " + files.length + " files)" + RESET);
  }
  console.log("");
  if (totalErrors > 0) {
    process.exit(1);
  }
}