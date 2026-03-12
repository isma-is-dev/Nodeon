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
  DocumentFormattingParams
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Lexer } from '@lexer/lexer';
import { Parser } from '@parser/parser';
import { KEYWORDS } from '@language/keywords';
import { Program, Statement, FunctionDeclaration, VariableDeclaration, ClassDeclaration } from '@ast/nodes';

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
      documentFormattingProvider: true
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
    const ast = new Parser(tokens).parseProgram();
    astCache.set(doc.uri, ast);
  } catch (err: any) {
    const message = err.message || String(err);
    // Extract line:col from messages like "Unexpected token at 3:5"
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

// ── Start ───────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
