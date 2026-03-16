![Nodeon Logo](packages/vscode-extension/assets/no-image.svg)

**Nodeon** is a programming language that compiles to JavaScript. It combines Python's simplicity with TypeScript's robustness while maintaining full compatibility with the JS/Node.js ecosystem.

```
fn greet(name) {
  print("Hello {name}!")
}

greet("World")
```

## Why Nodeon

- **No noise** — no semicolons, no mandatory parentheses in `if`/`for`/`while`, implicit returns
- **Natural interpolation** — `"Hello {name}"` with double quotes, `'raw strings'` without interpolation
- **Optional typing** — write types when you need them, erased at compile time
- **Strict equality by default** — `==` compiles to `===`, `!=` to `!==`
- **Full JS ecosystem** — imports, classes, async/await, everything compiles to standard JS
- **DX first** — CLI with colored errors, VS Code extension, full Language Server
- **Self-hosting** — the compiler is written in Nodeon and compiles itself

## Installation

Requirements: **Node.js 18+**, npm.

### From npm (recommended)

```bash
npm install -g nodeon-lang   # instala el CLI global

# o por proyecto
npm install nodeon-lang --save-dev

# ejecutar
nodeon run main.no
```

### Desde el repo

```bash
npm install           # install dependencies
npm test              # run 307 tests
```

## CLI

```bash
# Compile .no → .js
node cli/bin.js build hello.no

# Compile with minification
node cli/bin.js build -min hello.no

# Compile with source map
node cli/bin.js build --map hello.no

# Compile and run in memory
node cli/bin.js run hello.no

# Version
node cli/bin.js --version
```

Compilation errors show line, column, and caret:
```
error: Unexpected character '@' at 3:5
  --> example.no:3:5
   3 | x = @invalid
     |     ^
```

## Quick Syntax Reference

| Nodeon | JavaScript |
|--------|-----------|
| `x = 42` | `let x = 42;` |
| `const PI = 3.14` | `const PI = 3.14;` |
| `fn add(a, b) { a + b }` | `function add(a, b) { return a + b; }` |
| `print("Hello {name}")` | `` console.log(`Hello ${name}`) `` |
| `if x > 0 { ... }` | `if (x > 0) { ... }` |
| `for i in 0..10 { ... }` | `for (let i = 0; i <= 10; i++) { ... }` |
| `for item in items { ... }` | `for (const item of items) { ... }` |
| `x == 5` | `x === 5` |
| `obj?.prop ?? fallback` | `obj?.prop ?? fallback` |
| `match x { case 1 { ... } }` | `if (x === 1) { ... }` |
| `const { a, b } = obj` | `const { a, b } = obj;` |
| `fn add(a: number, b: number) { ... }` | `function add(a, b) { ... }` |

### Strings
- **Double-quoted** `"Hello {name}"` — interpolation with `{expr}`
- **Single-quoted** `'raw {no interpolation}'` — literal, no interpolation
- **Backtick** `` `Hello ${name}` `` — JS-standard interpolation

### Functions
```
fn double(x) { x * 2 }                    // implicit return
fn clamp(v, min = 0, max = 100) { ... }   // default parameters
fn sum(...nums) { ... }                    // rest parameters
async fn fetch(url) { ... }               // async functions
add = (a, b) => a + b                     // arrow functions
fn* generate() { yield 1 }               // generators
```

### Classes
```
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
}
```

### Control Flow
```
// if / else if / else
if score >= 90 { print("A") }
else if score >= 80 { print("B") }
else { print("F") }

// switch (block-style, no fall-through)
switch color {
  case "red" { print("Stop") }
  case "green" { print("Go") }
  default { print("Unknown") }
}

// pattern matching with guard clauses
match shape {
  case "circle" { return PI * r * r }
  case "square" when side > 0 { return side * side }
  default { return 0 }
}

// loops
for i in 0..10 { print(i) }
for item in items { print(item) }
while x > 0 { x = x - 1 }
do { x = x - 1 } while x > 0
```

### Destructuring & Types
```
const { name, age } = person         // object destructuring
const [first, ...rest] = items       // array destructuring

fn add(a: number, b: number): number {   // type annotations
  return a + b                           // (erased at compile time)
}
```

### Enums & Interfaces
```
enum Color { Red, Green, Blue }      // → Object.freeze({Red: 0, ...})

interface Shape {                    // type-only (stripped from output)
  area(): number
}
```

### Comments
```
// Line comment
/* Block comment */
```

> **Note:** `#` is NOT for comments — it's for private class fields (`#name`).

## Project Structure

```
src-ts-deprecated/            # TypeScript compiler (Deprecated)
  compiler/
    lexer/                    # Tokenizer with line:col tracking
    parser/                   # Pratt parser (1700 lines)
    ast/                      # 70+ AST node type definitions
    generator/                # JS code generator + source map builder
    type-checker.ts           # Structural type checker with inference
    compile.ts                # Public API: compile(), compileToAST()
  language/                   # Keywords, operators, tokens, precedence
src/                          # Self-hosted compiler (15 .no modules)
  compiler/                   # Componentized: lexer, parser (5 files), generator, type-checker
  language/                   # Language definitions in Nodeon
dist/                         # Compiled self-hosted compiler
  nodeon-compiler.cjs         # Bundled compiler (98.5kb)
cli/                          # CLI (build/run/version)
packages/
  language-server/            # Full LSP server (1400+ lines)
  vscode-extension/           # VS Code extension (syntax + LSP client)
scripts/                      # Build scripts for bootstrap pipeline
tests/                        # 307 Vitest tests (lexer, parser, e2e, bootstrap)
examples/                     # Example .no programs
docs/                         # Technical documentation
```

## Testing

```bash
npm test              # run all 307 tests
npm run test:watch    # watch mode
```

**307 tests** covering:
- **Lexer** — tokens, numbers (hex/bin/oct/sci/bigint), strings, template literals, operators, comments, position tracking
- **Parser** — declarations, functions, control flow, switch, try/catch, expressions, interpolation, classes, imports, destructuring, pattern matching, type annotations
- **E2E** — full compilation .no → .js verifying correct output
- **Bootstrap** — self-compilation: compiled compiler compiles all 15 of its own .no source files

## VS Code Extension

The extension provides professional IDE support:

- **Syntax highlighting** — functions, methods, classes, parameters, properties, constants, types, interpolation, regex
- **Semantic tokens** — AST-based highlighting that differentiates function calls, method calls, class references, parameters, and properties
- **Diagnostics** — real-time parse errors + type warnings + semantic analysis (undefined variables, unused declarations)
- **Hover** — keyword documentation + symbol info
- **Completions** — keywords + built-ins + document symbols
- **Go-to-Definition** — jump to fn/class/variable declarations
- **Find References** — locate all usages of a symbol
- **Rename Symbol** — rename across document
- **Formatting** — auto-indent with brace tracking
- **Code Actions** — quick fixes (declare with `let`, type suggestions)

### Install Extension
```bash
cd packages/vscode-extension
npm install
npm run build
# F5 in VS Code to launch Extension Development Host
```

### Package VSIX
```bash
cd packages/vscode-extension
npx vsce package
code --install-extension nodeon-vscode-extension-0.0.1.vsix
```

## Self-Hosting

The Nodeon compiler is self-hosting — it can compile its own source code:

```bash
node scripts/build-no.js     # Compile 15 .no files → dist-no/*.js
node scripts/bundle-no.js    # Bundle → dist-no/nodeon-compiler.cjs
```

The self-hosted compiler is a full reimplementation in Nodeon (15 modules, ~3000 lines) with a componentized parser architecture:

```
ParserBase → ParserTypes → ParserExpressions → ParserStatements → Parser
```

## Documentation

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for exhaustive technical documentation covering:
- Complete language specification
- Compiler pipeline (lexer → parser → type checker → generator)
- AST node reference (70+ node types)
- LSP implementation details
- Self-hosting bootstrap process
- Design decisions and rationale

## Roadmap

### Completed ✅
- [x] Lexer with line:col tracking
- [x] Pratt parser with ES2020+ support
- [x] JS generator with minification
- [x] CLI build/run with colored errors
- [x] Destructuring (object/array)
- [x] Type annotations (TypeScript-style erasure)
- [x] Pattern matching with guard clauses
- [x] Source maps (V3 spec with VLQ encoding)
- [x] Full LSP (diagnostics, hover, completions, go-to-definition, formatting, rename, references, semantic tokens, code actions)
- [x] VS Code extension with professional syntax highlighting
- [x] Self-hosting bootstrap (compiler compiles itself)
- [x] 307 tests with Vitest
- [x] GitHub Actions CI (Node 18/20/22)

### Next 🚧
- [ ] **npm publish** — `npm install -g nodeon`
- [ ] **Multi-file compilation** — resolve imports across .no files
- [ ] **Exhaustive type checking** — narrowing, exhaustiveness checks
- [ ] **VS Code Marketplace** — publish extension

### Future 🔭
- [ ] **Nodeon stdlib** — idiomatic wrappers for fs, path, http
- [ ] **WASM target** — compile to WebAssembly
- [ ] **Integrated bundler** — resolve imports and emit a single .js

## License

MIT
