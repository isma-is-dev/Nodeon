import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  InitializeParams,
  InitializeResult,
  Diagnostic,
  DiagnosticSeverity,
  TextDocumentChangeEvent,
  CompletionItem,
  CompletionItemKind,
  Hover,
  MarkupKind,
  TextDocumentPositionParams,
  DefinitionParams,
  Location,
  Range,
  Position,
  TextEdit,
  DocumentFormattingParams,
  RenameParams,
  WorkspaceEdit,
  ReferenceParams,
  SemanticTokens,
  CodeAction,
  CodeActionKind,
  SemanticTokensParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Lexer } from '@lexer/lexer';
import { Parser } from '@parser/parser';
import { KEYWORDS } from '@language/keywords';
import { Program, Statement, Expression, FunctionDeclaration, VariableDeclaration, ClassDeclaration } from '@ast/nodes';
import { typeCheck, TypeDiagnostic } from '@compiler/type-checker';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Cache parsed ASTs per document URI
const astCache = new Map<string, Program>();

// ── Initialization ──────────────────────────────────────────────────

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: ['.', '(', '{', '['],
        resolveProvider: false
      },
      definitionProvider: true,
      documentFormattingProvider: true,
      codeActionProvider: true,
      renameProvider: { prepareProvider: false },
      referencesProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: [
            'function', 'variable', 'class', 'parameter', 'keyword',
            'string', 'number', 'comment', 'operator', 'type',
            'enum', 'interface', 'property'
          ],
          tokenModifiers: ['declaration', 'readonly', 'async', 'static']
        },
        full: true
      }
    }
  };
});

// ── Diagnostics ─────────────────────────────────────────────────────

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
  validateDocument(change.document);
});

function validateDocument(doc: TextDocument): void {
  const source = doc.getText();
  const diagnostics: Diagnostic[] = [];

  if (source.trim().length === 0) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
    return;
  }

  try {
    const tokens = new Lexer(source).tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parseProgram();
    astCache.set(doc.uri, ast);

    // Report recovered parse errors (error-tolerant parsing)
    for (const err of parser.errors) {
      const msg = err.message || String(err);
      const match = msg.match(/at (\d+):(\d+)$/);
      let range: Range;
      if (match) {
        const line = parseInt(match[1], 10) - 1;
        const col = parseInt(match[2], 10) - 1;
        const lineText = source.split('\n')[line] || '';
        range = Range.create(Position.create(line, col), Position.create(line, lineText.length));
      } else {
        range = Range.create(Position.create(0, 0), Position.create(0, 0));
      }
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message: msg.replace(/\s*at \d+:\d+$/, ''),
        source: 'nodeon'
      });
    }

    // Semantic analysis on successful parse
    const semanticDiags = analyzeSemantics(ast, source);
    diagnostics.push(...semanticDiags);

    // Type checking
    const typeDiags = typeCheck(ast);
    for (const td of typeDiags) {
      const lines = source.split('\n');
      const lineText = lines[td.line] || '';
      diagnostics.push({
        severity: td.severity === 'error' ? DiagnosticSeverity.Error
          : td.severity === 'warning' ? DiagnosticSeverity.Warning
          : DiagnosticSeverity.Hint,
        range: Range.create(
          Position.create(td.line, td.column),
          Position.create(td.line, lineText.length)
        ),
        message: td.message,
        source: 'nodeon-types'
      });
    }
  } catch (err: any) {
    const message = err.message || String(err);
    const match = message.match(/at (\d+):(\d+)$/);
    let range: Range;
    if (match) {
      const line = parseInt(match[1], 10) - 1;
      const col = parseInt(match[2], 10) - 1;
      const lineText = source.split('\n')[line] || '';
      range = Range.create(
        Position.create(line, col),
        Position.create(line, lineText.length)
      );
    } else {
      range = Range.create(Position.create(0, 0), Position.create(0, 0));
    }

    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range,
      message: message.replace(/\s*at \d+:\d+$/, ''),
      source: 'nodeon'
    });
  }

  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

// ── Semantic Analysis ───────────────────────────────────────────────

// Built-in globals that should never trigger "undefined variable"
const BUILTIN_GLOBALS = new Set([
  'console', 'Math', 'Date', 'JSON', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy', 'Reflect',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'print', 'require', 'module', 'exports', '__dirname', '__filename',
  'process', 'Buffer', 'globalThis', 'global', 'undefined',
]);

interface SymbolInfo {
  line: number;
  used: boolean;
  kind: 'let' | 'const' | 'var' | 'fn' | 'class' | 'param' | 'for' | 'import' | 'catch' | 'enum';
}

interface Scope {
  symbols: Map<string, SymbolInfo>;
}

function analyzeSemantics(ast: Program, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split('\n');
  const scopes: Scope[] = [{ symbols: new Map() }];

  function currentScope(): Scope {
    return scopes[scopes.length - 1];
  }

  function pushScope(): void {
    scopes.push({ symbols: new Map() });
  }

  function popScope(): void {
    const scope = scopes.pop();
    if (!scope) return;
    // Report unused variables (only for variables, not params/imports in top-level)
    for (const [name, info] of scope.symbols) {
      if (!info.used && info.kind !== 'import' && info.kind !== 'catch' && name !== '_') {
        const line = info.line;
        const col = findIdentifierColumn(lines[line] || '', name);
        diagnostics.push({
          severity: DiagnosticSeverity.Hint,
          range: Range.create(
            Position.create(line, col),
            Position.create(line, col + name.length)
          ),
          message: `'${name}' is declared but never used`,
          source: 'nodeon',
          tags: [1] // DiagnosticTag.Unnecessary
        });
      }
    }
  }

  function declare(name: string, line: number, kind: SymbolInfo['kind']): void {
    const scope = currentScope();
    if (scope.symbols.has(name)) {
      const existing = scope.symbols.get(name)!;
      // Allow re-assignment for 'let' and 'var', but warn for 'const', 'fn', 'class'
      if (existing.kind === 'const' || existing.kind === 'class' || existing.kind === 'enum') {
        const col = findIdentifierColumn(lines[line] || '', name);
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: Range.create(
            Position.create(line, col),
            Position.create(line, col + name.length)
          ),
          message: `'${name}' is already declared in this scope (line ${existing.line + 1})`,
          source: 'nodeon'
        });
      }
    }
    scope.symbols.set(name, { line, used: false, kind });
  }

  function reference(name: string, line: number): void {
    if (BUILTIN_GLOBALS.has(name)) return;
    if (KEYWORDS.has(name)) return;

    // Walk scopes from innermost to outermost
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].symbols.has(name)) {
        scopes[i].symbols.get(name)!.used = true;
        return;
      }
    }

    // Not found — undefined variable
    const col = findIdentifierColumn(lines[line] || '', name);
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(
        Position.create(line, col),
        Position.create(line, col + name.length)
      ),
      message: `'${name}' is not defined`,
      source: 'nodeon'
    });
  }

  function findIdentifierColumn(lineText: string, name: string): number {
    // Try to find the identifier in the line text
    const idx = lineText.indexOf(name);
    return idx >= 0 ? idx : 0;
  }

  function getLine(node: any): number {
    if (node?.loc) return node.loc.line - 1;
    return 0;
  }

  // ── AST walkers ─────────────────────────────────────────────────

  function walkStatements(stmts: Statement[]): void {
    for (const stmt of stmts) walkStatement(stmt);
  }

  function walkStatement(stmt: Statement): void {
    const line = getLine(stmt);

    switch (stmt.type) {
      case 'VariableDeclaration': {
        // Walk the value first (it may reference existing variables)
        walkExpression(stmt.value, line);
        declare(stmt.name.name, line, stmt.kind as 'let' | 'const' | 'var');
        break;
      }
      case 'DestructuringDeclaration': {
        walkExpression(stmt.value, line);
        declarePattern(stmt.pattern, line, stmt.kind as 'let' | 'const' | 'var');
        break;
      }
      case 'FunctionDeclaration': {
        declare(stmt.name.name, line, 'fn');
        pushScope();
        for (const p of stmt.params) {
          if (p.pattern) {
            declarePattern(p.pattern, line, 'param');
          } else {
            declare(p.name, line, 'param');
          }
          if (p.defaultValue) walkExpression(p.defaultValue, line);
        }
        walkStatements(stmt.body);
        popScope();
        break;
      }
      case 'ClassDeclaration': {
        declare(stmt.name.name, line, 'class');
        if (stmt.superClass) reference(stmt.superClass.name, line);
        pushScope();
        declare('this', line, 'param'); // 'this' is always available inside class
        for (const member of stmt.body) {
          if (member.type === 'ClassField') {
            if (member.value) walkExpression(member.value, getLine(member));
            continue;
          }
          // ClassMethod
          pushScope();
          for (const p of member.params) {
            if (p.pattern) {
              declarePattern(p.pattern, getLine(member), 'param');
            } else {
              declare(p.name, getLine(member), 'param');
            }
            if (p.defaultValue) walkExpression(p.defaultValue, getLine(member));
          }
          walkStatements(member.body);
          popScope();
        }
        popScope();
        break;
      }
      case 'IfStatement': {
        walkExpression(stmt.condition, line);
        pushScope();
        walkStatements(stmt.consequent);
        popScope();
        if (stmt.alternate) {
          pushScope();
          walkStatements(stmt.alternate);
          popScope();
        }
        break;
      }
      case 'ForStatement': {
        pushScope();
        walkExpression(stmt.iterable, line);
        if (stmt.variable.type === 'Identifier') {
          declare(stmt.variable.name, line, 'for');
        } else {
          declarePattern(stmt.variable, line, 'for');
        }
        walkStatements(stmt.body);
        popScope();
        break;
      }
      case 'WhileStatement': {
        walkExpression(stmt.condition, line);
        pushScope();
        walkStatements(stmt.body);
        popScope();
        break;
      }
      case 'DoWhileStatement': {
        pushScope();
        walkStatements(stmt.body);
        popScope();
        walkExpression(stmt.condition, line);
        break;
      }
      case 'ReturnStatement': {
        if (stmt.value) walkExpression(stmt.value, line);
        break;
      }
      case 'ThrowStatement': {
        walkExpression(stmt.value, line);
        break;
      }
      case 'ExpressionStatement': {
        walkExpression(stmt.expression, line);
        break;
      }
      case 'ImportDeclaration': {
        if (stmt.defaultImport) {
          // Ignore "* as X" — take just the alias name
          const importName = stmt.defaultImport.startsWith('* as ')
            ? stmt.defaultImport.slice(5)
            : stmt.defaultImport;
          declare(importName, line, 'import');
        }
        for (const spec of stmt.namedImports) {
          declare(spec.alias ?? spec.name, line, 'import');
        }
        break;
      }
      case 'ExportDeclaration': {
        if (stmt.declaration) walkStatement(stmt.declaration);
        break;
      }
      case 'TryCatchStatement': {
        pushScope();
        walkStatements(stmt.tryBlock);
        popScope();
        pushScope();
        if (stmt.catchParam) declare(stmt.catchParam.name, line, 'catch');
        walkStatements(stmt.catchBlock);
        popScope();
        if (stmt.finallyBlock) {
          pushScope();
          walkStatements(stmt.finallyBlock);
          popScope();
        }
        break;
      }
      case 'SwitchStatement': {
        walkExpression(stmt.discriminant, line);
        for (const c of stmt.cases) {
          if (c.test) walkExpression(c.test, line);
          pushScope();
          walkStatements(c.consequent);
          popScope();
        }
        break;
      }
      case 'MatchStatement': {
        walkExpression(stmt.discriminant, line);
        for (const c of stmt.cases) {
          if (c.pattern) walkExpression(c.pattern, line);
          if (c.guard) walkExpression(c.guard, line);
          pushScope();
          walkStatements(c.body);
          popScope();
        }
        break;
      }
      case 'EnumDeclaration': {
        declare(stmt.name.name, line, 'enum');
        for (const member of stmt.members) {
          if (member.value) walkExpression(member.value, line);
        }
        break;
      }
      case 'InterfaceDeclaration': {
        // Interfaces are type-only, no runtime checks needed
        declare(stmt.name.name, line, 'class');
        break;
      }
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'DebuggerStatement':
        break;
    }
  }

  function declarePattern(pattern: any, line: number, kind: SymbolInfo['kind']): void {
    if (pattern.type === 'ObjectPattern') {
      for (const prop of pattern.properties) {
        if (prop.value.type === 'Identifier') {
          declare(prop.value.name, line, kind);
        } else {
          declarePattern(prop.value, line, kind);
        }
      }
      if (pattern.rest) declare(pattern.rest.name, line, kind);
    } else if (pattern.type === 'ArrayPattern') {
      for (const el of pattern.elements) {
        if (!el) continue;
        if (el.type === 'Identifier') {
          declare(el.name, line, kind);
        } else {
          declarePattern(el, line, kind);
        }
      }
      if (pattern.rest) declare(pattern.rest.name, line, kind);
    }
  }

  function walkExpression(expr: Expression | null | undefined, fallbackLine: number): void {
    if (!expr) return;
    const line = (expr as any)?.loc ? (expr as any).loc.line - 1 : fallbackLine;

    switch (expr.type) {
      case 'Identifier':
        reference(expr.name, line);
        break;
      case 'Literal':
        break;
      case 'TemplateLiteral':
        for (const part of expr.parts) {
          if (part.kind === 'Expression') walkExpression(part.expression, line);
        }
        break;
      case 'BinaryExpression':
        walkExpression(expr.left, line);
        walkExpression(expr.right, line);
        break;
      case 'UnaryExpression':
        walkExpression(expr.argument, line);
        break;
      case 'UpdateExpression':
        walkExpression(expr.argument, line);
        break;
      case 'CallExpression':
        walkExpression(expr.callee, line);
        for (const arg of expr.arguments) walkExpression(arg, line);
        break;
      case 'MemberExpression':
        walkExpression(expr.object, line);
        if (expr.computed) walkExpression(expr.property, line);
        break;
      case 'ArrayExpression':
        for (const el of expr.elements) walkExpression(el, line);
        break;
      case 'ObjectExpression':
        for (const prop of expr.properties) walkExpression(prop.value, line);
        break;
      case 'ArrowFunction': {
        pushScope();
        for (const p of expr.params) {
          if (p.pattern) {
            declarePattern(p.pattern, line, 'param');
          } else {
            declare(p.name, line, 'param');
          }
          if (p.defaultValue) walkExpression(p.defaultValue, line);
        }
        if (Array.isArray(expr.body)) {
          walkStatements(expr.body);
        } else {
          walkExpression(expr.body, line);
        }
        popScope();
        break;
      }
      case 'AssignmentExpression':
        walkExpression(expr.right, line);
        // For bare assignments (x = value), if x is an Identifier, treat it as
        // an implicit declaration in Nodeon (similar to Python)
        if (expr.left.type === 'Identifier') {
          // Check if it already exists in scope — if so, just mark used
          let found = false;
          for (let i = scopes.length - 1; i >= 0; i--) {
            if (scopes[i].symbols.has(expr.left.name)) {
              scopes[i].symbols.get(expr.left.name)!.used = true;
              found = true;
              break;
            }
          }
          if (!found) {
            declare(expr.left.name, line, 'let');
          }
        } else {
          walkExpression(expr.left, line);
        }
        break;
      case 'CompoundAssignmentExpression':
        walkExpression(expr.left, line);
        walkExpression(expr.right, line);
        break;
      case 'NewExpression':
        walkExpression(expr.callee, line);
        for (const arg of expr.arguments) walkExpression(arg, line);
        break;
      case 'AwaitExpression':
        walkExpression(expr.argument, line);
        break;
      case 'SpreadExpression':
        walkExpression(expr.argument, line);
        break;
      case 'TernaryExpression':
        walkExpression(expr.condition, line);
        walkExpression(expr.consequent, line);
        walkExpression(expr.alternate, line);
        break;
      case 'TypeofExpression':
        walkExpression(expr.argument, line);
        break;
      case 'VoidExpression':
        walkExpression(expr.argument, line);
        break;
      case 'DeleteExpression':
        walkExpression(expr.argument, line);
        break;
      case 'YieldExpression':
        if (expr.argument) walkExpression(expr.argument, line);
        break;
      case 'ObjectPattern':
      case 'ArrayPattern':
        // Patterns are handled by declarePattern
        break;
    }
  }

  // Run the analysis
  walkStatements(ast.body);

  // Pop the global scope (reports unused globals)
  popScope();

  return diagnostics;
}

// ── Completions ─────────────────────────────────────────────────────

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const items: CompletionItem[] = [];

  // Keyword completions
  const keywordList = Array.from(KEYWORDS);
  for (const kw of keywordList) {
    items.push({
      label: kw,
      kind: CompletionItemKind.Keyword,
      detail: `Nodeon keyword`
    });
  }

  // Built-in functions
  items.push({ label: 'print', kind: CompletionItemKind.Function, detail: 'print(value) → console.log' });

  // Document identifiers (functions, variables, classes)
  const doc = documents.get(params.textDocument.uri);
  if (doc) {
    const symbols = extractSymbols(doc.getText());
    for (const sym of symbols) {
      if (sym.kind === 'function') {
        items.push({ label: sym.name, kind: CompletionItemKind.Function, detail: sym.detail });
      } else if (sym.kind === 'variable') {
        items.push({ label: sym.name, kind: CompletionItemKind.Variable, detail: sym.detail });
      } else if (sym.kind === 'class') {
        items.push({ label: sym.name, kind: CompletionItemKind.Class, detail: sym.detail });
      }
    }
  }

  return items;
});

// ── Hover ───────────────────────────────────────────────────────────

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const word = getWordAtPosition(doc, params.position);
  if (!word) return null;

  // Check keywords
  if (KEYWORDS.has(word)) {
    const desc = KEYWORD_DOCS[word];
    if (desc) {
      return {
        contents: { kind: MarkupKind.Markdown, value: `**\`${word}\`** — ${desc}` }
      };
    }
    return {
      contents: { kind: MarkupKind.Markdown, value: `**\`${word}\`** — Nodeon keyword` }
    };
  }

  // Check document symbols
  const symbols = extractSymbols(doc.getText());
  const sym = symbols.find(s => s.name === word);
  if (sym) {
    return {
      contents: { kind: MarkupKind.Markdown, value: `**\`${sym.name}\`** — ${sym.detail}` }
    };
  }

  return null;
});

// ── Go-to-Definition ────────────────────────────────────────────────

connection.onDefinition((params: DefinitionParams): Location | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const word = getWordAtPosition(doc, params.position);
  if (!word) return null;

  const source = doc.getText();
  const lines = source.split('\n');

  // Search for function, class, or variable declarations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // fn <name>(
    const fnMatch = line.match(new RegExp(`\\bfn\\s+${escapeRegex(word)}\\b`));
    if (fnMatch) {
      const col = fnMatch.index! + fnMatch[0].indexOf(word);
      return Location.create(params.textDocument.uri, Range.create(i, col, i, col + word.length));
    }
    // class <name>
    const classMatch = line.match(new RegExp(`\\bclass\\s+${escapeRegex(word)}\\b`));
    if (classMatch) {
      const col = classMatch.index! + classMatch[0].indexOf(word);
      return Location.create(params.textDocument.uri, Range.create(i, col, i, col + word.length));
    }
    // let/const/var <name> = or <name> =
    const varMatch = line.match(new RegExp(`\\b(?:let|const|var)\\s+${escapeRegex(word)}\\b`));
    if (varMatch) {
      const col = varMatch.index! + varMatch[0].indexOf(word);
      return Location.create(params.textDocument.uri, Range.create(i, col, i, col + word.length));
    }
  }

  return null;
});

// ── Formatting ──────────────────────────────────────────────────────

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const source = doc.getText();
  const formatted = formatNodeon(source, params.options.tabSize ?? 2);
  if (formatted === source) return [];

  // Replace entire document
  const lastLine = doc.lineCount - 1;
  const lastChar = doc.getText(Range.create(lastLine, 0, lastLine + 1, 0)).length;
  return [TextEdit.replace(Range.create(0, 0, lastLine, lastChar), formatted)];
});

function formatNodeon(source: string, tabSize: number): string {
  const indent = ' '.repeat(tabSize);
  const lines = source.split('\n');
  const result: string[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Skip empty lines (preserve them)
    if (line.length === 0) {
      result.push('');
      continue;
    }

    // Decrease indent for closing braces
    if (line.startsWith('}') || line.startsWith(']') || line.startsWith(')')) {
      depth = Math.max(0, depth - 1);
    }
    // Handle `} else {`, `} catch`, `} finally`, `} while` on same line
    if (/^}\s*(else|catch|finally|while)/.test(line)) {
      // Already decreased above, don't decrease again
    }

    // Apply indentation
    const indented = indent.repeat(depth) + line;
    result.push(indented);

    // Count net brace changes for next line
    let netOpen = 0;
    let inString = false;
    let stringChar = '';
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inString) {
        if (ch === '\\') { j++; continue; }
        if (ch === stringChar) inString = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }
      // Skip line comments
      if (ch === '#') break;
      if (ch === '/' && j + 1 < line.length && line[j + 1] === '/') break;
      if (ch === '{' || ch === '(' && isBlockParen(line, j) || ch === '[') {
        if (ch === '{') netOpen++;
      }
      if (ch === '}') netOpen--;
    }
    depth = Math.max(0, depth + netOpen);
  }

  // Trim trailing empty lines, ensure single trailing newline
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result.join('\n') + '\n';
}

function isBlockParen(_line: string, _pos: number): boolean {
  return false; // Don't increase indent for parentheses
}

// ── Helpers ─────────────────────────────────────────────────────────

interface DocSymbol {
  name: string;
  kind: 'function' | 'variable' | 'class';
  detail: string;
  line: number;
}

function extractSymbols(source: string): DocSymbol[] {
  const symbols: DocSymbol[] = [];
  const seen = new Set<string>();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fn name(params)
    const fnMatch = line.match(/\bfn\s+(\w+)\s*\(([^)]*)\)/);
    if (fnMatch && !seen.has(fnMatch[1])) {
      seen.add(fnMatch[1]);
      const params = fnMatch[2].trim();
      symbols.push({
        name: fnMatch[1],
        kind: 'function',
        detail: `fn ${fnMatch[1]}(${params})`,
        line: i
      });
    }

    // class Name
    const classMatch = line.match(/\bclass\s+(\w+)/);
    if (classMatch && !seen.has(classMatch[1])) {
      seen.add(classMatch[1]);
      symbols.push({
        name: classMatch[1],
        kind: 'class',
        detail: `class ${classMatch[1]}`,
        line: i
      });
    }

    // let/const/var name =
    const varMatch = line.match(/\b(let|const|var)\s+(\w+)/);
    if (varMatch && !seen.has(varMatch[2])) {
      seen.add(varMatch[2]);
      symbols.push({
        name: varMatch[2],
        kind: 'variable',
        detail: `${varMatch[1]} ${varMatch[2]}`,
        line: i
      });
    }

    // Bare assignment: name = (implicit let)
    const assignMatch = line.match(/^(\w+)\s*=/);
    if (assignMatch && !seen.has(assignMatch[1]) && !KEYWORDS.has(assignMatch[1])) {
      seen.add(assignMatch[1]);
      symbols.push({
        name: assignMatch[1],
        kind: 'variable',
        detail: `${assignMatch[1]} (inferred)`,
        line: i
      });
    }
  }

  return symbols;
}

function getWordAtPosition(doc: TextDocument, pos: Position): string | null {
  const line = doc.getText(Range.create(pos.line, 0, pos.line + 1, 0));
  const before = line.slice(0, pos.character);
  const after = line.slice(pos.character);
  const startMatch = before.match(/(\w+)$/);
  const endMatch = after.match(/^(\w*)/);
  if (!startMatch) return null;
  return startMatch[1] + (endMatch ? endMatch[1] : '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KEYWORD_DOCS: Record<string, string> = {
  fn: 'Declare a function: `fn name(params) { body }`',
  if: 'Conditional statement: `if condition { ... }`',
  else: 'Alternate branch: `else { ... }` or `else if { ... }`',
  for: 'Loop: `for x in collection { ... }` or `for i in 0..10 { ... }`',
  in: 'Iteration keyword used with `for` loops',
  while: 'While loop: `while condition { ... }`',
  do: 'Do-while loop: `do { ... } while condition`',
  return: 'Return a value from a function',
  import: 'Import module: `import name from "module"`',
  export: 'Export declaration: `export fn name() { ... }`',
  class: 'Define a class: `class Name { fn method() { ... } }`',
  extends: 'Class inheritance: `class Child extends Parent { ... }`',
  new: 'Create instance: `new ClassName(args)`',
  const: 'Immutable variable declaration: `const name = value`',
  let: 'Mutable variable declaration: `let name = value`',
  var: 'Variable declaration (function-scoped): `var name = value`',
  match: 'Pattern matching: `match expr { case val { ... } default { ... } }`',
  switch: 'Switch statement: `switch expr { case val { ... } default { ... } }`',
  try: 'Try-catch: `try { ... } catch err { ... } finally { ... }`',
  catch: 'Catch block for error handling',
  finally: 'Finally block — always executes after try/catch',
  throw: 'Throw an error: `throw new Error("msg")`',
  async: 'Mark function as async: `async fn name() { ... }`',
  await: 'Await a promise: `await expression`',
  print: 'Print to console: `print(value)` → `console.log(value)`',
  break: 'Break out of a loop',
  continue: 'Skip to next loop iteration',
  typeof: 'Get type of value: `typeof expr`',
  yield: 'Yield from generator function',
  this: 'Reference to current object instance',
  super: 'Reference to parent class',
  true: 'Boolean literal `true`',
  false: 'Boolean literal `false`',
  null: 'Null literal',
  undefined: 'Undefined literal',
  debugger: 'Debugger breakpoint statement',
  enum: 'Enum declaration: `enum Color { Red, Green, Blue }` — compiles to `Object.freeze({...})`',
  interface: 'Interface declaration: `interface Shape { area(): number }` — type-only, stripped from JS output',
};

// ── Rename Symbol ───────────────────────────────────────────────────

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const word = getWordAtPosition(doc, params.position);
  if (!word || KEYWORDS.has(word)) return null;

  const source = doc.getText();
  const edits: TextEdit[] = [];
  const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(lines[i])) !== null) {
      edits.push(TextEdit.replace(
        Range.create(i, match.index, i, match.index + word.length),
        params.newName
      ));
    }
  }

  if (edits.length === 0) return null;
  return { changes: { [params.textDocument.uri]: edits } };
});

// ── Find References ─────────────────────────────────────────────────

connection.onReferences((params: ReferenceParams): Location[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const word = getWordAtPosition(doc, params.position);
  if (!word) return [];

  const source = doc.getText();
  const locations: Location[] = [];
  const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(lines[i])) !== null) {
      locations.push(Location.create(
        params.textDocument.uri,
        Range.create(i, match.index, i, match.index + word.length)
      ));
    }
  }

  return locations;
});

// ── Semantic Tokens ─────────────────────────────────────────────────

const TOKEN_TYPES = [
  'function', 'variable', 'class', 'parameter', 'keyword',
  'string', 'number', 'comment', 'operator', 'type',
  'enum', 'interface', 'property'
];

function tokenTypeIndex(type: string): number {
  return TOKEN_TYPES.indexOf(type);
}

connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { data: [] };

  const source = doc.getText();
  const data: number[] = [];

  try {
    const tokens = new Lexer(source).tokenize();
    let prevLine = 0;
    let prevChar = 0;

    for (const token of tokens) {
      if (token.type === 'EOF') break;
      if (!token.loc) continue;

      const line = token.loc.line - 1;
      const char = token.loc.column - 1;
      const length = token.value.length;

      let typeIdx = -1;
      switch (token.type) {
        case 'Keyword':
          typeIdx = tokenTypeIndex('keyword');
          break;
        case 'Identifier':
          typeIdx = tokenTypeIndex('variable');
          break;
        case 'Number':
          typeIdx = tokenTypeIndex('number');
          break;
        case 'String':
        case 'RawString':
        case 'TemplateLiteral':
          typeIdx = tokenTypeIndex('string');
          break;
        case 'Operator':
          typeIdx = tokenTypeIndex('operator');
          break;
        case 'RegExp':
          typeIdx = tokenTypeIndex('string');
          break;
      }

      if (typeIdx < 0) continue;

      const deltaLine = line - prevLine;
      const deltaChar = deltaLine === 0 ? char - prevChar : char;

      data.push(deltaLine, deltaChar, length, typeIdx, 0);
      prevLine = line;
      prevChar = char;
    }
  } catch {
    // If lexing fails, return empty tokens — diagnostics will show the error
  }

  return { data };
});

// ── Code Actions (Quick Fixes) ──────────────────────────────────────

connection.onCodeAction((params): CodeAction[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const actions: CodeAction[] = [];

  for (const diag of params.context.diagnostics) {
    // Quick fix: "Add type annotation" for type mismatches
    if (diag.message.includes("not assignable to type")) {
      const match = diag.message.match(/type '(\w+)'/);
      if (match) {
        actions.push({
          title: `Change type to '${match[1]}'`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          isPreferred: true,
        });
      }
    }

    // Quick fix: wrap undeclared variable in let
    if (diag.message.includes("is not defined") || diag.message.includes("undeclared")) {
      const line = doc.getText(diag.range).trim();
      actions.push({
        title: `Declare with 'let'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        edit: {
          changes: {
            [params.textDocument.uri]: [{
              range: Range.create(diag.range.start, diag.range.start),
              newText: "let "
            }]
          }
        }
      });
    }
  }

  return actions;
});

// ── Start ───────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
