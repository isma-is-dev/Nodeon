# Contributing to Nodeon

Thank you for your interest in contributing to Nodeon! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** >= 18.x
- **npm** >= 9.x
- **Git**

### Getting Started

```bash
git clone https://github.com/isma-is-dev/Nodeon.git
cd Nodeon
npm install
```

### Build the Compiler

Nodeon is self-hosting — the compiler is written in Nodeon (`.no` files in `src/`).

```bash
# Build the self-hosted compiler (auto-detects, falls back to TS bootstrap)
npm run build

# Build with fixpoint verification (output must be byte-identical)
npm run build:verify

# Force rebuild from TS bootstrap compiler
npm run build:bootstrap
```

### Run Tests

```bash
# Run all tests
npm test

# Run a specific test suite
npx vitest run tests/e2e.test.ts

# Run tests in watch mode
npx vitest watch
```

### Project Structure

```
Nodeon/
├── src/                    # Self-hosted compiler source (.no files)
│   ├── compiler/           # Lexer, Parser, Generator, TypeChecker, IR
│   ├── cli/                # CLI commands (build, run, dev, deploy, etc.)
│   └── language/           # Keywords, operators, tokens, precedence
├── packages/
│   ├── nova/               # Nova framework (signals, DI, template, router, etc.)
│   ├── core/               # @nodeon/core standard library
│   ├── db/                 # @nodeon/db database layer
│   ├── http/               # @nodeon/http HTTP client/server
│   ├── json/               # @nodeon/json JSON utilities
│   ├── string/             # @nodeon/string string utilities
│   ├── test/               # @nodeon/test test framework
│   ├── language-server/    # LSP implementation
│   └── vscode-extension/   # VS Code extension
├── tests/                  # Vitest test suites
├── dist-no/                # Compiled self-hosted output
├── scripts/                # Build scripts
└── docs/                   # Architecture documents
```

### Key Files

| File | Purpose |
|------|---------|
| `src/compiler/parser/parser.no` | Main parser (Pratt parsing) |
| `src/compiler/generator/js-generator.no` | JavaScript code generator |
| `src/compiler/type-checker.no` | Type checker |
| `src/cli/index.no` | CLI entry point and command router |
| `packages/nova/src/index.no` | Nova framework entry |

## How to Contribute

### Reporting Bugs

Open an issue with:
1. Minimal `.no` code that reproduces the bug
2. Expected output vs actual output
3. Node.js version and OS

### Adding a Feature

1. **Check the roadmap** — See `docs/platform-architecture.md` §15 for planned features
2. **Open an issue** — Discuss the feature before implementing
3. **Fork and branch** — Create a feature branch from `main`
4. **Write tests first** — Add tests to `tests/e2e.test.ts` or a new test file
5. **Implement** — Make changes in both TS (`src/`) and .no (`src-no/` or `src/`) compilers if applicable
6. **Run tests** — `npm test` must pass with 0 failures
7. **Submit PR** — Reference the issue, describe changes

### Coding Style

- **No semicolons** in `.no` files (the language doesn't support them)
- Use `fn` for functions, not `function`
- Use `//` for comments (`#` is for private fields, not comments)
- Double-quoted strings support interpolation: `"Hello {name}"`
- Single-quoted strings are raw: `'no interpolation'`
- `==` compiles to `===` (strict equality by default)

### Nodeon Language Quick Reference

```
// Variables
let x = 10
const name = "World"

// Functions
fn add(a: number, b: number): number {
  return a + b
}

// Implicit return (single expression)
fn double(x) = x * 2

// Classes
class Point {
  x: number
  y: number

  fn constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }

  fn distance() {
    return Math.sqrt(this.x ** 2 + this.y ** 2)
  }
}

// Pattern matching
match value {
  case 1 { "one" }
  case 2 { "two" }
  default { "other" }
}

// For loops
for item in items {
  print(item)
}
for i in 0..10 {
  print(i)
}
```

### Test Conventions

- Tests use Vitest (`describe`, `it`, `expect`)
- E2E tests compile `.no` source and verify JS output
- Bootstrap tests verify self-hosting fixpoint
- Add regression tests for every bug fix

### Commit Messages

Use descriptive commit messages:
```
feat: add nodeon doctor command
fix: BUG-013 parser crash on empty match block
test: add e2e tests for named arguments
docs: update architecture audit
```

## Architecture Overview

### Compiler Pipeline

```
Source (.no) → Lexer → Tokens → Parser → AST → TypeChecker → Generator → JavaScript
                                                    ↓
                                              IR (optional)
                                                    ↓
                                            WASM (experimental)
```

### Self-Hosting

The compiler compiles itself. The build process:
1. TS bootstrap compiler compiles .no source to JS
2. Self-hosted compiler compiles .no source to JS
3. Output is verified byte-identical (fixpoint)

### Nova Framework

Angular × Astro hybrid: server-first rendering, zero JS by default, selective hydration via `@island` components, dependency injection, signals for reactivity.

## Getting Help

- Open a GitHub issue for bugs or feature requests
- Check `docs/platform-architecture.md` for the full platform vision
- Check `audit.md` for current implementation status

## License

By contributing, you agree that your contributions will be licensed under the project's license.
