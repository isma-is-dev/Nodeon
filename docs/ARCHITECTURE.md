# Nodeon — Technical Architecture

> Exhaustive technical reference for the Nodeon programming language, compiler, tooling, and self-hosting bootstrap.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Language Specification](#3-language-specification)
4. [Compiler Pipeline](#4-compiler-pipeline)
5. [Lexer](#5-lexer)
6. [Parser](#6-parser)
7. [AST Nodes](#7-ast-nodes)
8. [Type Checker](#8-type-checker)
9. [JS Code Generator](#9-js-code-generator)
10. [Source Maps](#10-source-maps)
11. [CLI](#11-cli)
12. [Language Server (LSP)](#12-language-server-lsp)
13. [VS Code Extension](#13-vs-code-extension)
14. [Self-Hosting Bootstrap](#14-self-hosting-bootstrap)
15. [Testing](#15-testing)
16. [Build System](#16-build-system)
17. [CI/CD](#17-cicd)
18. [Design Decisions](#18-design-decisions)

---

## 1. Project Overview

**Nodeon** is a programming language that compiles to JavaScript. It combines Python-like ergonomics with JavaScript's ecosystem compatibility, adding features like optional typing, pattern matching, and string interpolation while removing syntactic noise (semicolons, mandatory parentheses, `function` keyword).

**Key milestones:**
- v0.1.0 — Core compiler (lexer → parser → generator), CLI, 159 tests
- Self-hosting — Compiler rewritten in Nodeon (15 `.no` modules), compiles itself via bootstrap
- Full LSP — Diagnostics, hover, completions, go-to-definition, semantic highlighting, formatting, rename, references, code actions
- 307 tests across lexer, parser, e2e, and bootstrap suites

**Tech stack:** TypeScript, ts-node, tsconfig-paths, Vitest, esbuild, VS Code LSP

---

## 2. Repository Structure

```
Nodeon/
├── src/                          # TypeScript compiler source (reference implementation)
│   ├── compiler/
│   │   ├── ast/
│   │   │   └── nodes.ts          # AST node type definitions (70+ node types)
│   │   ├── lexer/
│   │   │   └── lexer.ts          # Tokenizer with line:col tracking
│   │   ├── parser/
│   │   │   ├── parser-base.ts    # Base class: token navigation, error recovery
│   │   │   └── parser.ts         # Full Pratt parser (1700 lines)
│   │   ├── generator/
│   │   │   ├── js-generator.ts   # AST → JavaScript code emission
│   │   │   └── source-map.ts     # V3 source map builder (VLQ encoding)
│   │   ├── type-checker.ts       # Structural type checker with inference
│   │   ├── resolver.ts           # Import path resolution
│   │   └── compile.ts            # Public API: compile(), compileToAST(), compileWithSourceMap()
│   └── language/
│       ├── keywords.ts           # Set of reserved keywords
│       ├── operators.ts          # Operator character sets
│       ├── precedence.ts         # Operator precedence table + compound assignments
│       ├── symbols.ts            # Delimiter characters
│       └── tokens.ts             # Token type enum
│
├── src-no/                       # Nodeon compiler source (self-hosted implementation)
│   ├── compiler/
│   │   ├── compile.no            # Public API (mirrors compile.ts)
│   │   ├── generator/
│   │   │   └── js-generator.no   # JS generator (516 lines)
│   │   ├── lexer/
│   │   │   └── lexer.no          # Lexer (330 lines)
│   │   ├── parser/
│   │   │   ├── parser-base.no    # Base class
│   │   │   ├── parser-types.no   # Type annotations + destructuring patterns
│   │   │   ├── parser-expressions.no  # Pratt expression parser
│   │   │   ├── parser-statements.no   # Statement parser
│   │   │   └── parser.no         # Top-level parser (inheritance chain)
│   │   ├── resolver.no           # Import resolver
│   │   └── type-checker.no       # Type checker (346 lines)
│   └── language/
│       ├── keywords.no, operators.no, precedence.no, symbols.no, tokens.no
│
├── dist-no/                      # Compiled .no → .js output
│   └── nodeon-compiler.cjs       # Bundled self-hosted compiler (98.5kb)
│
├── packages/
│   ├── language-server/          # LSP server
│   │   ├── src/server.ts         # Full LSP implementation (1400 lines)
│   │   └── start.js              # Bootstrap shim (ts-node + tsconfig-paths)
│   └── vscode-extension/         # VS Code extension
│       ├── src/extension.ts      # LSP client activation
│       ├── syntaxes/nodeon.tmLanguage.json  # TextMate grammar
│       ├── language-configuration.json      # Editor behaviors
│       └── package.json          # Extension manifest + semantic token scopes
│
├── cli/                          # CLI entry point
│   ├── bin.js                    # ts-node shim
│   └── nodeon.ts                 # CLI implementation (build/run/version)
│
├── scripts/
│   ├── build-no.js               # Compile all .no files to dist-no/
│   ├── bundle-no.js              # Bundle dist-no/ into single CJS file
│   └── build-cli.js              # Build CLI for distribution
│
├── tests/
│   ├── lexer.test.ts             # Lexer unit tests
│   ├── parser.test.ts            # Parser unit tests
│   ├── e2e.test.ts               # End-to-end compilation tests
│   ├── bootstrap.test.ts         # Self-hosting bootstrap tests
│   └── fixtures/                 # Test fixture .no files
│
├── examples/                     # Example .no programs
├── tsconfig.json                 # TypeScript config with path aliases
├── vitest.config.ts              # Vitest config with path resolution
└── package.json                  # Monorepo root (npm workspaces)
```

### Path Aliases

Defined in `tsconfig.json` and resolved at runtime by `tsconfig-paths`:

| Alias | Maps to |
|-------|---------|
| `@language/*` | `src/language/*` |
| `@lexer/*` | `src/compiler/lexer/*` |
| `@parser/*` | `src/compiler/parser/*` |
| `@compiler/*` | `src/compiler/*` |
| `@ast/*` | `src/compiler/ast/*` |
| `@cli/*` | `src/cli/*` |
| `@src/*` | `src/*` |

---

## 3. Language Specification

### 3.1 Tokens

| Token Type | Examples | Description |
|-----------|---------|-------------|
| `Identifier` | `foo`, `_bar`, `$baz` | Variable/function/class names |
| `Number` | `42`, `3.14`, `0xFF`, `0b101`, `100n` | Numeric literals (dec/hex/bin/oct/sci/bigint) |
| `String` | `"hello {name}"` | Double-quoted with `{expr}` interpolation |
| `RawString` | `'no interpolation'` | Single-quoted, literal content |
| `TemplateLiteral` | `` `${expr}` `` | Backtick with JS-style `${expr}` interpolation |
| `Keyword` | `fn`, `class`, `if`, `for` | Reserved words (see §3.2) |
| `Operator` | `+`, `==`, `??`, `=>` | Mathematical, logical, comparison operators |
| `Delimiter` | `{`, `}`, `(`, `)`, `[`, `]`, `,`, `:`, `;` | Structural delimiters |
| `EOF` | — | End of file marker |

### 3.2 Keywords

```
fn, if, else, for, in, of, while, do, return, class, extends, new,
import, export, from, const, let, var, true, false, null, undefined,
async, await, yield, typeof, instanceof, void, delete, switch, case,
default, break, continue, try, catch, finally, throw, this, super,
print, match, enum, interface, static, debugger, as, type
```

### 3.3 Statements

**No semicolons.** Statements are separated by newlines. A single line = a single statement unless it ends with `{` (block continuation).

#### Variable Declarations
```no
x = 42              // implicit let
const PI = 3.14     // const
let count = 0       // explicit let
var legacy = true   // var (function-scoped)
```

#### Functions
```no
fn add(a, b) { return a + b }       // explicit return
fn double(x) { x * 2 }              // implicit return (single expression)
fn greet(name = "World") { ... }     // default parameters
fn sum(...nums) { ... }              // rest parameters
async fn fetch(url) { ... }          // async
fn* generate() { yield 1 }          // generator
```

#### Classes
```no
class Dog extends Animal {
  #name                              // private field
  static count = 0                   // static field

  constructor(name) {
    super()
    this.#name = name
  }

  fn bark() {
    print("{this.#name} says Woof!")
  }

  static fn create(name) {
    return new Dog(name)
  }
}
```

#### Control Flow
```no
// Conditionals (no parentheses required)
if score >= 90 { print("A") }
else if score >= 80 { print("B") }
else { print("F") }

// For-in (collection iteration)
for item in items { print(item) }

// For-in range
for i in 0..10 { print(i) }

// While / do-while
while x > 0 { x = x - 1 }
do { x = x - 1 } while x > 0

// Switch (block-style, no fall-through)
switch color {
  case "red" { print("Stop") }
  case "green" { print("Go") }
  default { print("Unknown") }
}

// Pattern matching (compiles to if/else-if chain)
match shape {
  case "circle" { return PI * r * r }
  case "square" when side > 0 { return side * side }
  default { return 0 }
}
```

#### Imports / Exports
```no
import fs from 'fs'
import { readFile, writeFile } from 'fs/promises'
import * as path from 'path'
export fn compile(source) { ... }
export class Parser extends ParserBase { ... }
export default MyClass
export { foo, bar as baz }
```

#### Destructuring
```no
const { name, age } = person
const [first, ...rest] = items
const { a: { b } } = nested      // nested destructuring
```

#### Type Annotations (erased at compile time)
```no
fn add(a: number, b: number): number {
  return a + b
}
const items: string[] = []
const map: Map<string, number> = new Map()
```

### 3.4 Expressions

#### Operators
| Category | Operators | Notes |
|----------|----------|-------|
| Arithmetic | `+`, `-`, `*`, `/`, `%`, `**` | Standard math |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` | `==` → `===`, `!=` → `!==` |
| Logical | `&&`, `\|\|`, `!` | Short-circuit |
| Bitwise | `&`, `\|`, `^`, `~`, `<<`, `>>`, `>>>` | |
| Assignment | `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `&&=`, `\|\|=`, `??=` | |
| Update | `++`, `--` | Pre/post-fix |
| Nullish | `??` | Nullish coalescing |
| Optional | `?.` | Optional chaining |
| Range | `..` | `0..10` → for-loop range |
| Spread | `...` | Spread/rest |
| Ternary | `? :` | Conditional expression |
| Typeof | `typeof x` | Type check |
| Instanceof | `x instanceof T` | Instance check |

#### String Interpolation
```no
"Hello {name}"              // → `Hello ${name}`
"Sum: {a + b}"              // → `Sum: ${a + b}`
"{ literal brace }"         // → "{ literal brace }" (not interpolation!)
'Raw: {not interpolated}'   // → 'Raw: {not interpolated}'
```

**Interpolation rule:** `{` is only treated as interpolation start when followed by an identifier-start character (`a-z`, `A-Z`, `_`, `$`, `!`, `~`, `(`, `[`). Otherwise it's a literal brace.

### 3.5 Comments
```no
// Line comment
/* Block comment */
```

> **Note:** `#` is NOT a comment character. It's used for private fields (`#name`).

---

## 4. Compiler Pipeline

```
Source (.no)
    │
    ▼
┌──────────┐     Tokens[]      ┌──────────┐      AST         ┌──────────┐
│  Lexer   │ ──────────────► │  Parser  │ ──────────────► │Type Check│
└──────────┘                   └──────────┘                   └──────────┘
                                                                   │
                                                                   ▼ AST
                                                             ┌──────────┐
                                                             │Generator │ ──► JavaScript
                                                             └──────────┘
                                                                   │
                                                             (optional)
                                                                   ▼
                                                             Source Map
```

### API

```typescript
// src/compiler/compile.ts
export function compile(source: string): { js: string; ast: Program }
export function compileToAST(source: string): Program
export function compileWithSourceMap(source: string, filename: string):
  { js: string; map: string; ast: Program }
```

---

## 5. Lexer

**File:** `src/compiler/lexer/lexer.ts` (468 lines)

The lexer converts source text into a flat array of tokens with precise `{line, column}` location tracking. It handles:

- **Identifiers and keywords** — identifier characters `[a-zA-Z_$][a-zA-Z0-9_$]*`, checked against the keyword set
- **Numbers** — decimal, hex (`0x`), binary (`0b`), octal (`0o`), scientific (`1e5`), BigInt (`100n`), underscore separators (`1_000_000`)
- **Strings** — three kinds:
  - Double-quoted (`"..."`) → `TokenType.String` — supports `\n`, `\t`, `\r`, `\\`, `\"`, `\0`, `\uXXXX` escapes
  - Single-quoted (`'...'`) → `TokenType.RawString` — only `\\` and `\'` escapes, no interpolation
  - Backtick (`` `...` ``) → `TokenType.TemplateLiteral` — supports JS-style `${}` and all escapes
- **Operators** — one/two/three-char operators, resolved by longest match (`>>>=` before `>>>` before `>>`)
- **Delimiters** — `{`, `}`, `(`, `)`, `[`, `]`, `,`, `:`, `;`
- **Comments** — `//` line and `/* */` block comments (skipped, not tokenized)
- **Whitespace** — consumed but not tokenized; newlines are tracked for line counting

### Location Tracking

Every token carries a `SourceLocation`:
```typescript
interface SourceLocation { line: number; column: number; }
interface Token { type: TokenType; value: string; loc: SourceLocation; }
```

Lines are 1-indexed, columns are 1-indexed.

---

## 6. Parser

**Files:** `src/compiler/parser/parser-base.ts` (136 lines), `src/compiler/parser/parser.ts` (1690 lines)

### 6.1 Architecture

The parser uses **Pratt parsing** (top-down operator precedence) for expressions and recursive descent for statements. The class hierarchy:

```
ParserBase (token navigation, error recovery, peek/advance/consume)
    └── Parser (all parsing logic: statements, expressions, types, patterns)
```

For the self-hosted version (`src-no/`), the parser is split into a deeper hierarchy:
```
ParserBase → ParserTypes → ParserExpressions → ParserStatements → Parser
```

### 6.2 ParserBase

Core token navigation methods:
- `peek()` / `peekNext()` — look ahead without consuming
- `advance()` — consume current token
- `consumeIdentifier(msg)` / `consumePropertyName(msg)` — consume identifier (property name allows keywords)
- `consumeKeyword(kw)` / `consumeDelimiter(d)` / `consumeOperator(op)` — consume specific tokens
- `checkKeyword(kw)` / `matchKeyword(kw)` — test without / with consumption
- `error(tok, msg)` — throw `SyntaxError` with `line:col`
- `errors: Error[]` — collected errors for error-tolerant parsing

### 6.3 Expression Parsing (Pratt)

The main expression loop in `parseExpression()`:
1. Parse prefix/unary via `parseUnary()` → `parsePostfix()` → `parsePrimary()`
2. Loop: check operator precedence, parse binary/ternary/assignment/member/call

**Precedence table** (from `src/language/precedence.ts`):
```
??                          → 1
||                          → 2
&&                          → 3
|                           → 4
^                           → 5
&                           → 6
== != === !==               → 7
< > <= >= in instanceof     → 8
<< >> >>>                   → 9
+ -                         → 10
* / %                       → 11
**                          → 12
```

**Key design:** `parseUnary()` calls `parsePostfix()` (not `parsePrimary()`) for its argument. This ensures `!foo()` parses as `!(foo())` rather than `(!foo)()`. `parsePostfix()` handles call `()`, member `.`, index `[]`, and optional chaining `?.` after primary expressions.

### 6.4 Statement Parsing

The `parseStatement()` method dispatches on the current token:
- Keywords → specific parse methods (`parseIfStatement`, `parseForStatement`, etc.)
- Contextual keywords → `type` alias declaration
- Identifier followed by `:` → labeled statement
- Default → `parseExpressionStatement()`

### 6.5 Error Recovery

The parser supports error-tolerant parsing: when an error is encountered, it's pushed to `parser.errors` and parsing continues. This is essential for the LSP, which needs a partial AST even for incomplete/invalid code.

---

## 7. AST Nodes

**File:** `src/compiler/ast/nodes.ts`

All AST nodes have a `type` discriminant field. Key categories:

### Statements
| Node Type | Fields |
|-----------|--------|
| `VariableDeclaration` | `name`, `value`, `kind` (let/const/var) |
| `DestructuringDeclaration` | `pattern`, `value`, `kind` |
| `FunctionDeclaration` | `name`, `params[]`, `body[]`, `async`, `generator` |
| `ClassDeclaration` | `name`, `superClass`, `body[]` (ClassMethod/ClassField) |
| `IfStatement` | `condition`, `consequent[]`, `alternate[]?` |
| `ForStatement` | `variable`, `iterable`, `body[]` |
| `WhileStatement` | `condition`, `body[]` |
| `DoWhileStatement` | `body[]`, `condition` |
| `ReturnStatement` | `value?` |
| `SwitchStatement` | `discriminant`, `cases[]` |
| `MatchStatement` | `discriminant`, `cases[]` (with guard clauses) |
| `TryCatchStatement` | `tryBlock[]`, `catchParam?`, `catchBlock[]`, `finallyBlock[]?` |
| `ImportDeclaration` | `defaultImport?`, `namedImports[]`, `source` |
| `ExportDeclaration` | `declaration?`, `isDefault`, `namedExports[]`, `source?` |
| `EnumDeclaration` | `name`, `members[]` |
| `InterfaceDeclaration` | `name`, `properties[]` |
| `ThrowStatement` | `value` |
| `ExpressionStatement` | `expression` |
| `BreakStatement` | `label?` |
| `ContinueStatement` | `label?` |
| `DebuggerStatement` | — |

### Expressions
| Node Type | Fields |
|-----------|--------|
| `Literal` | `value`, `literalType` (string/number/boolean/null/undefined/regex) |
| `Identifier` | `name` |
| `TemplateLiteral` | `parts[]` (Text/Expression) |
| `BinaryExpression` | `operator`, `left`, `right` |
| `UnaryExpression` | `operator`, `argument` |
| `UpdateExpression` | `operator`, `argument`, `prefix` |
| `CallExpression` | `callee`, `arguments[]` |
| `MemberExpression` | `object`, `property`, `computed`, `optional` |
| `NewExpression` | `callee`, `arguments[]` |
| `ArrayExpression` | `elements[]` |
| `ObjectExpression` | `properties[]` |
| `ArrowFunction` | `params[]`, `body` (Expression or Statement[]), `async` |
| `AssignmentExpression` | `left`, `right` |
| `CompoundAssignmentExpression` | `operator`, `left`, `right` |
| `TernaryExpression` | `condition`, `consequent`, `alternate` |
| `SpreadExpression` | `argument` |
| `AwaitExpression` | `argument` |
| `YieldExpression` | `argument`, `delegate` |
| `TypeofExpression` | `argument` |
| `DeleteExpression` | `argument` |
| `VoidExpression` | `argument` |

### Patterns
| Node Type | Fields |
|-----------|--------|
| `ObjectPattern` | `properties[]`, `rest?` |
| `ArrayPattern` | `elements[]`, `rest?` |
| `Param` | `name`, `typeAnnotation?`, `defaultValue?`, `pattern?`, `rest` |

### Source Location

Every statement node is intersected with `{ loc?: SourceLoc }`:
```typescript
interface SourceLoc { line: number; column: number; }
type Statement = (VariableDeclaration | FunctionDeclaration | ...) & { loc?: SourceLoc };
```

---

## 8. Type Checker

**File:** `src/compiler/type-checker.ts`

The type checker performs structural type analysis with inference. It runs on the AST after parsing and produces diagnostics (errors, warnings, hints) without modifying the AST.

### Type System

Internal type representation:
```typescript
type Type =
  | { kind: "primitive"; name: string }        // string, number, boolean, void, any, never
  | { kind: "named"; name: string }            // user-defined type names
  | { kind: "array"; elementType: Type }       // T[]
  | { kind: "union"; types: Type[] }           // T | U
  | { kind: "function"; params: Type[]; returnType: Type }
  | { kind: "generic"; base: string; args: Type[] }   // Promise<T>
  | { kind: "object"; properties: Map<string, Type> }  // { key: Type }
```

### Features
- **Type inference** from literals, expressions, and function return types
- **Structural assignability** checks (`isAssignableTo`)
- **Type environment** (`TypeEnv`) with scoped symbol tracking
- **Diagnostics**: type mismatches, invalid operations, typeof comparisons
- **Integration with LSP** — diagnostics are surfaced as editor warnings/errors

---

## 9. JS Code Generator

**File:** `src/compiler/generator/js-generator.ts`

The generator walks the AST and emits JavaScript code. Key transformations:

| Nodeon | JavaScript |
|--------|-----------|
| `print(x)` | `console.log(x)` |
| `x == y` | `x === y` |
| `x != y` | `x !== y` |
| `"Hello {name}"` | `` `Hello ${name}` `` |
| `for i in 0..10 { ... }` | `for (let i = 0; i <= 10; i++) { ... }` |
| `for x in items { ... }` | `for (const x of items) { ... }` |
| `if cond { ... }` | `if (cond) { ... }` |
| `fn name() { ... }` | `function name() { ... }` |
| `match expr { case v { ... } }` | `if (expr === v) { ... }` |
| `enum Color { Red, Green }` | `const Color = Object.freeze({ Red: 0, Green: 1 })` |
| Type annotations | Stripped (erased) |

### Implicit Returns

Single-expression function bodies are auto-wrapped in `return`:
```no
fn double(x) { x * 2 }
```
→
```js
function double(x) { return x * 2; }
```

### Context Tracking

The generator maintains a `GeneratorContext`:
- `indent: number` — current indentation level
- `declaredVars: Set<string>` — tracks declared variables to avoid duplicate `let` declarations
- `inClass: boolean` — whether currently emitting inside a class body

---

## 10. Source Maps

**File:** `src/compiler/generator/source-map.ts`

Implements V3 Source Map specification with VLQ (Variable-Length Quantity) encoding.

### SourceMapBuilder

```typescript
class SourceMapBuilder {
  constructor(sourceFile: string)
  addMapping(genLine: number, genCol: number, srcLine: number, srcCol: number): void
  toJSON(): string  // V3 source map JSON
  toBase64DataUrl(): string  // inline data URL
}
```

### VLQ Encoding

Uses standard Base64-VLQ encoding for compact representation of line/column mappings. Each mapping segment encodes delta values for generated column, source index, source line, and source column.

### Usage

```typescript
const { js, map } = compileWithSourceMap(source, "input.no");
// js includes //# sourceMappingURL=... comment
// map is the JSON source map string
```

---

## 11. CLI

**File:** `cli/nodeon.ts`

### Commands

| Command | Description |
|---------|-------------|
| `nodeon build <file>` | Compile `.no` → `.js`, output to stdout or file |
| `nodeon build -min <file>` | Compile with minification |
| `nodeon build --map <file>` | Compile with source map |
| `nodeon run <file>` | Compile and execute in memory |
| `nodeon --version` | Print version |
| `nodeon --help` | Print help |

### Error Display

Compilation errors are displayed with colored output including file path, line:column, and a source caret:
```
error: Expected expression at 5:12
  --> example.no:5:12
   5 | const x = @
     |            ^
```

---

## 12. Language Server (LSP)

**File:** `packages/language-server/src/server.ts` (1400+ lines)

Full Language Server Protocol implementation providing IDE features.

### Capabilities

| Feature | Implementation |
|---------|---------------|
| **Diagnostics** | Real-time: parse errors + type checker warnings + semantic analysis |
| **Semantic Analysis** | Scope-aware: undefined variables, unused declarations, redeclarations |
| **Hoisting** | Pre-pass hoists top-level `fn`/`class` declarations (forward references work) |
| **Hover** | Keyword docs + document symbol info |
| **Completions** | Keywords + built-in functions + document symbols (functions, classes, variables) |
| **Go-to-Definition** | Regex-based: finds `fn name`, `class name`, `let/const/var name` declarations |
| **Find References** | Word-boundary regex search across document |
| **Rename Symbol** | Word-boundary rename across document |
| **Formatting** | Indent-based reformatter with brace tracking |
| **Code Actions** | Quick fixes: declare with `let`, change type |
| **Semantic Tokens** | AST-based: functions, methods, classes, parameters, properties, enums, interfaces |

### Semantic Tokens

The semantic token provider walks the AST (not just the token stream) to produce rich token classification:

| Token Type | When Applied |
|-----------|-------------|
| `function` | Function declarations, function calls |
| `method` | Method declarations, method calls (`obj.method()`) |
| `class` | Class declarations, `extends` clauses, `new` expressions |
| `parameter` | Function/method/arrow-function parameters, catch params |
| `variable` | Variable declarations, `for` loop variables |
| `property` | Object property access, object literal keys, class fields |
| `enum` | Enum declarations |
| `enumMember` | Enum member declarations |
| `interface` | Interface declarations |

Modifiers: `declaration`, `definition`, `readonly` (const), `static`, `async`, `defaultLibrary`.

### Semantic Analysis

The `analyzeSemantics()` function performs scope-aware analysis:

1. **Pre-pass:** Hoists top-level `fn` and `class` declarations (including `export fn`/`export class`)
2. **Walk:** Traverses the AST, building a scope chain:
   - `declare()` — adds symbol to current scope
   - `reference()` — walks scope chain to find symbol, marks as used
3. **Post-walk:** Reports unused variables (as hints with `DiagnosticTag.Unnecessary`)

Built-in globals (`console`, `Math`, `process`, `print`, etc.) are whitelisted and never trigger "not defined" errors.

---

## 13. VS Code Extension

**Directory:** `packages/vscode-extension/`

### TextMate Grammar

The grammar (`syntaxes/nodeon.tmLanguage.json`) provides tokenization scopes:

| Pattern | Scope |
|---------|-------|
| `fn name(...)` | `entity.name.function.nodeon` |
| `class Name extends Parent` | `entity.name.type.class.nodeon` + `entity.other.inherited-class.nodeon` |
| `obj.method(...)` | `entity.name.function.member.nodeon` |
| `obj.property` | `variable.other.property.nodeon` |
| `#privateField` | `variable.other.property.private.nodeon` |
| `"string {interp}"` | `string.quoted.double.nodeon` + `meta.embedded.expression.nodeon` |
| `ALL_CAPS` | `variable.other.constant.nodeon` |
| `console`, `Math` | `support.class.builtin.nodeon` |
| `print` | `support.function.builtin.nodeon` |
| `x =>` | `variable.parameter.nodeon` (arrow param) |

**Interpolation fix:** The grammar only triggers interpolation for `{` followed by identifier-start characters (`[a-zA-Z_$!([]`), matching the parser behavior. Strings like `"{ }"` are treated as literal text.

### Language Configuration

- **Auto-closing pairs:** `{}`, `[]`, `()`, `""`, `''`, `` `` ``, `/* */`
- **Colorized bracket pairs:** `{}`, `[]`, `()`
- **Indentation rules:** increase on `{`, decrease on `}`
- **Folding markers:** `// #region` / `// #endregion`
- **On-enter rules:** auto-indent after `{`, auto-outdent before `}`, comment continuation
- **Word pattern:** `[a-zA-Z_$][a-zA-Z0-9_$]*`

### Semantic Token Scope Mappings

The extension maps LSP semantic token types to TextMate scopes via `semanticTokenScopes`:
```json
"function" → "entity.name.function.nodeon"
"method"   → "entity.name.function.member.nodeon"
"class"    → "entity.name.type.class.nodeon"
"parameter" → "variable.parameter.nodeon"
"property" → "variable.other.property.nodeon"
"variable.readonly" → "variable.other.constant.nodeon"
```

This ensures that all VS Code color themes automatically apply appropriate colors to Nodeon code elements.

### Default Editor Settings

Applied automatically for `.no` files:
- Semantic highlighting: enabled
- Bracket pair colorization: enabled
- Tab size: 2 spaces
- Insert spaces: true

---

## 14. Self-Hosting Bootstrap

The Nodeon compiler is **self-hosting**: the compiler written in Nodeon can compile its own source code.

### Bootstrap Process

```
┌─────────────────┐      compile      ┌──────────────┐
│ TypeScript       │ ──────────────► │ dist-no/*.js  │  (15 JS modules)
│ Compiler (src/)  │                  └──────┬───────┘
│                  │                         │ esbuild
│ reads src-no/*.no│                         ▼
└─────────────────┘              ┌───────────────────────┐
                                 │ nodeon-compiler.cjs    │  (98.5kb bundle)
                                 │ (self-hosted compiler) │
                                 └───────────┬───────────┘
                                             │ compiles
                                             ▼
                                      src-no/*.no  ✓  (all 15 files)
```

### Pipeline

1. **`scripts/build-no.js`** — Uses the TypeScript compiler to compile all 15 `.no` files from `src-no/` to ES module `.js` files in `dist-no/`, preserving directory structure
2. **`scripts/bundle-no.js`** — Uses esbuild to bundle all `dist-no/*.js` modules into a single CommonJS file `dist-no/nodeon-compiler.cjs` with `compile` as the entry export
3. **Verification** — The bundled compiler is loaded and used to compile all 15 of its own `.no` source files

### Parser Inheritance Chain (Self-Hosted)

The self-hosted parser splits the monolithic `parser.ts` into a componentized inheritance chain:

```
ParserBase (parser-base.no)
    ↓ extends
ParserTypes (parser-types.no)        — type annotations, destructuring patterns
    ↓ extends
ParserExpressions (parser-expressions.no) — Pratt expression parsing, string interpolation
    ↓ extends
ParserStatements (parser-statements.no)   — statement parsing, imports/exports, classes
    ↓ extends
Parser (parser.no)                   — program-level dispatch
```

### Known Bootstrap Constraints

Patterns that must be avoided in `.no` source files due to the JS generator's behavior:

| Constraint | Reason |
|-----------|--------|
| No Nodeon keywords as variable names | `from`, `static`, `async`, etc. are reserved |
| No `{ }` in double-quoted strings | Triggers interpolation — use single quotes |
| No duplicate `let` in same scope | JS generator deduplicates `let` declarations, causing TDZ errors |
| No semicolons as statement separators | Nodeon uses newlines exclusively |

---

## 15. Testing

**Framework:** Vitest 4.1.0

**Total:** 307 tests across 5 test files, all passing.

### Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/lexer.test.ts` | ~50 | Tokenization: numbers, strings, operators, keywords, comments, positions |
| `tests/parser.test.ts` | ~60 | AST generation: all statement/expression types, error recovery |
| `tests/e2e.test.ts` | ~130 | Full compilation: .no → .js output verification |
| `tests/bootstrap.test.ts` | ~35 | Module compilation + self-compilation (15 modules × 2) |
| `tests/source-map.test.ts` | ~30 | Source map generation and VLQ encoding |

### Running Tests

```bash
npm test              # Run all 307 tests
npm run test:watch    # Watch mode
npx vitest run tests/e2e.test.ts  # Single file
```

### Bootstrap Tests

The `bootstrap.test.ts` file includes:
1. **Module compilation** — Each of the 15 `.no` files compiles to JS with content assertions
2. **Compiled lexer integration** — The compiled lexer correctly tokenizes Nodeon source
3. **Self-compilation** — The bundled compiler (`dist-no/nodeon-compiler.cjs`) compiles all 15 of its own `.no` source files

---

## 16. Build System

### Monorepo

npm workspaces with two packages:
- `packages/language-server` — LSP server (uses ts-node + tsconfig-paths at runtime)
- `packages/vscode-extension` — VS Code extension (bundled with esbuild)

### Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `test` | `vitest run` | Run all tests |
| `test:watch` | `vitest` | Watch mode |
| `build:ext` | `npm run build -w nodeon-vscode-extension` | Build VS Code extension |
| `build:cli` | `node scripts/build-cli.js` | Build CLI for distribution |
| `typecheck:lsp` | `tsc --noEmit -p packages/language-server/tsconfig.json` | Type-check LSP server |
| `package:ext` | `npm run package -w nodeon-vscode-extension` | Package VSIX |

### Bootstrap Build

```bash
node scripts/build-no.js     # Compile 15 .no files → dist-no/*.js
node scripts/bundle-no.js    # Bundle → dist-no/nodeon-compiler.cjs (98.5kb)
```

---

## 17. CI/CD

**File:** `.github/workflows/ci.yml`

GitHub Actions CI runs on push/PR to `main`:
- Matrix: Node.js 18, 20, 22
- Steps: install, test (`vitest run`)

---

## 18. Design Decisions

### Why no semicolons?

Nodeon uses newlines as statement separators. This simplifies the language and reduces visual noise. The parser treats each line as a statement boundary unless the line ends with `{` (block continuation) or an operator that expects a right-hand operand.

### Why `fn` instead of `function`?

Shorter, cleaner. Two characters instead of eight. The `function` keyword is still recognized as a keyword for compatibility (e.g., property names).

### Why `==` maps to `===`?

JavaScript's loose equality (`==`) is a common source of bugs. Nodeon makes strict equality the default. There is no way to get loose equality — this is by design.

### Why three string types?

Each serves a distinct purpose:
- **Double-quoted** — most common, with interpolation for dynamic strings
- **Single-quoted** — raw strings for regex patterns, JSON, file paths
- **Backtick** — JS-compatible template literals for interop

### Why Pratt parsing?

Pratt parsing handles operator precedence naturally without deeply nested grammar rules. It's simple to extend with new operators and produces correct AST structure for complex expressions.

### Why split the self-hosted parser?

The TypeScript parser is 1700 lines in a single file. For the self-hosted version, splitting into `ParserBase → ParserTypes → ParserExpressions → ParserStatements → Parser` makes each file manageable (~200-460 lines) and separates concerns clearly.

### Why structural typing?

Nodeon's type checker uses structural (duck) typing rather than nominal typing, matching TypeScript's approach and the dynamic nature of JavaScript. Type annotations are erased at compile time — they're documentation and IDE assistance, not runtime enforcement.

---

*Last updated: March 2026 — Nodeon v0.1.0 (self-hosting, 307 tests)*
