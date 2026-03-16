/**
 * Nodeon Compiler Error System
 *
 * Structured errors with error codes, source context, and help suggestions.
 */

// ── Error Codes ─────────────────────────────────────────────────────

export enum ErrorCode {
  // Syntax errors (E01xx)
  E0100 = "E0100", // Generic syntax error
  E0101 = "E0101", // Expected token not found
  E0102 = "E0102", // Unexpected token
  E0103 = "E0103", // Unterminated string
  E0104 = "E0104", // Unterminated template literal
  E0105 = "E0105", // Expected expression
  E0106 = "E0106", // Expected statement
  E0107 = "E0107", // Expected identifier
  E0108 = "E0108", // Expected block '{'
  E0109 = "E0109", // Unterminated block
  E0110 = "E0110", // Invalid assignment target

  // Import/Export errors (E02xx)
  E0200 = "E0200", // Expected module source
  E0201 = "E0201", // Expected 'from' in import
  E0202 = "E0202", // Expected 'as' after '*'

  // Type errors (E03xx)
  E0300 = "E0300", // Type mismatch
  E0301 = "E0301", // Unknown type
  E0302 = "E0302", // Expected type annotation

  // Code generation errors (E04xx)
  E0400 = "E0400", // Unsupported statement
  E0401 = "E0401", // Range operator outside for loop
  E0402 = "E0402", // Unsupported expression
}

// ── Error Suggestions ────────────────────────────────────────────────

const ERROR_SUGGESTIONS: Record<string, string[]> = {
  // Missing delimiters
  "Expected ')'": [
    "You might have forgotten a closing parenthesis.",
    "Check that every '(' has a matching ')'.",
  ],
  "Expected '}'": [
    "You might have forgotten a closing brace.",
    "Check that every '{' has a matching '}'.",
  ],
  "Expected ']'": [
    "You might have forgotten a closing bracket.",
    "Check that every '[' has a matching ']'.",
  ],
  "Expected '{'": [
    "Block statements require opening braces.",
    "Nodeon uses { } for blocks, not indentation.",
  ],
  "Expected '('": [
    "Function calls and declarations require parentheses.",
  ],

  // Assignment
  "Expected '=' in assignment": [
    "Variables must be initialized when declared.",
    "Example: x = 42  or  let x = 42",
  ],
  "Expected '=' after destructuring pattern": [
    "Destructuring requires an initializer.",
    "Example: { a, b } = obj  or  [x, y] = arr",
  ],

  // Functions
  "Expected function name": [
    "Functions declared with 'fn' must have a name.",
    "Example: fn myFunction() { ... }",
    "For anonymous functions, use arrow syntax: (x) => x * 2",
  ],
  "Expected parameter name": [
    "Function parameters must be identifiers.",
    "Example: fn add(a, b) { a + b }",
  ],

  // Expressions
  "Expected expression": [
    "An expression was expected here (value, variable, function call, etc.).",
    "Check for missing operands or extra operators.",
  ],

  // Imports
  "Expected module source string": [
    "Import source must be a string literal.",
    "Example: import { foo } from 'my-module'",
  ],
  "Expected 'as' after '*'": [
    "Namespace imports require 'as' keyword.",
    "Example: import * as utils from './utils'",
  ],

  // Keywords as identifiers
  "Expected variable name": [
    "Variable names must be valid identifiers.",
    "Keywords like 'fn', 'if', 'for', 'class' cannot be used as variable names.",
  ],
};

// ── NodeonError Class ─────────────────────────────────────────────────

export class NodeonError extends SyntaxError {
  code: ErrorCode;
  line: number;
  column: number;
  sourceLine: string | null;
  help: string[];

  constructor(
    code: ErrorCode,
    message: string,
    line: number,
    column: number,
    sourceLine: string | null = null,
  ) {
    // Keep the line:col in the message for backward compatibility
    super(`${message} at ${line}:${column}`);
    this.name = "NodeonError";
    this.code = code;
    this.line = line;
    this.column = column;
    this.sourceLine = sourceLine;
    this.help = findSuggestions(message);
  }
}

function findSuggestions(message: string): string[] {
  // Check direct matches first
  for (const [pattern, suggestions] of Object.entries(ERROR_SUGGESTIONS)) {
    if (message.includes(pattern)) {
      return suggestions;
    }
  }

  // Pattern-based suggestions
  if (message.includes("Expected keyword")) {
    const match = message.match(/Expected keyword '(\w+)'/);
    if (match) {
      return [`The keyword '${match[1]}' was expected here.`];
    }
  }

  return [];
}
