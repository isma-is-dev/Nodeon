# Nodeon — Comprehensive Project Audit

**Date:** 2025 (updated March 2026)  
**Scope:** Full repository audit — compiler, CLI, LSP, VS Code extension, self-hosting, tests, CI/CD, documentation  
**Goal:** Identify what Nodeon needs to become a usable, professional-grade language and a realistic path toward becoming a new standard

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [Architecture Review](#3-architecture-review)
4. [Identified Bugs](#4-identified-bugs)
5. [Compiler Improvements](#5-compiler-improvements)
6. [Language Feature Gaps](#6-language-feature-gaps)
7. [Type System Evolution](#7-type-system-evolution)
8. [CLI & Tooling](#8-cli--tooling)
9. [LSP & Editor Experience](#9-lsp--editor-experience)
10. [Testing & Quality](#10-testing--quality)
11. [Performance](#11-performance)
12. [Ecosystem & Community](#12-ecosystem--community)
13. [Best Practices to Adopt](#13-best-practices-to-adopt)
14. [Roadmap: Path to Professional Language](#14-roadmap-path-to-professional-language)
15. [Roadmap: Path to New Standard](#15-roadmap-path-to-new-standard)

---

## 1. Executive Summary

Nodeon is an impressively complete project for its stage. It has:

- A **full compiler pipeline** (Lexer → Pratt Parser → Type Checker → JS Generator)
- **Self-hosting with verified fixpoint** — the compiler compiles itself and produces byte-identical output (32 .no source files, bundled to 136.0kb). Self-hosted compiler is now the primary CLI with CLI bundle (`nodeon-cli.cjs`)
- **636 passing tests** across lexer, parser, e2e, bootstrap (compile + self-compile + fixpoint), type-checker, nova (signals, template, DI, island-bundler), regression, and snapshot suites
- **Nova framework** (`packages/nova/`) — file-based routing, static renderer, dev server, island hydration architecture. **All 12 modules migrated from JS to Nodeon (`.no`)** — compiled to JS via the self-hosted compiler
- A **Language Server Protocol** implementation with diagnostics, completions, hover, go-to-definition, semantic tokens, formatting, rename, references, and code actions
- A **VS Code extension** with TextMate grammar + semantic highlighting
- **Source map** generation (V3 spec with VLQ encoding)
- A **CLI** with build, run, repl, init, and watch mode (both self-hosted and TS fallback)
- **CI/CD** via GitHub Actions (Node 18/20/22) with build, fixpoint verification, and dual CLI testing

**Maturity Rating: ~85% toward a usable professional language.**

The core is solid and self-hosting is fully achieved with a verified fixpoint. The self-hosted compiler is now the primary CLI. Structured error messages with codes, source context, and help suggestions are implemented. Significant gaps remain in standard library, package management, documentation for end users, and ecosystem tooling. Below is a detailed breakdown.

---

## 2. Current State Assessment

### What Works Well

| Area | Status | Notes |
|------|--------|-------|
| Lexer | ✅ Solid | Handles hex/bin/oct, regex, template literals, private fields, unicode escapes |
| Parser (Pratt) | ✅ Solid | Full expression/statement coverage, error recovery, 1699 lines |
| JS Generator | ✅ Solid | Clean output, minification, source maps, implicit returns |
| Type Checker | ✅ Improved | Inference, narrowing, assignability, generics (type params + substitution), interface conformance (`implements`) — no exhaustiveness or control flow analysis yet |
| CLI | ✅ Good | build, run, check, fmt, repl, init, watch mode, dependency graph walking, caching |
| LSP Server | ⚠️ Good but Unoptimized | 1426 lines, full feature set with AST-based semantic tokens |
| VS Code Extension | ✅ Good | TextMate + semantic tokens, bracket colorization, language config |
| Self-hosting | ✅ Fixpoint | 32 .no modules, byte-identical output across TS/self/self² builds (141.2kb bundle). Self-hosted is primary CLI. **TS compiler (`src/`) is deprecated** — kept only as bootstrap fallback. |
| Tests | ✅ Good | 636 tests (lexer 35, parser 84, e2e 220, bootstrap 98, type-checker 81, nova-signals 21, nova-template 32, nova-di 21, nova-island-bundler 13, regression 26, snapshot 5) |
| CI | ✅ Improved | Tests + build + fixpoint verify + self-hosted CLI verify + TS CLI fallback |

### What Needs Work

| Area | Priority | Gap |
|------|----------|-----|
| Error messages | ✅ Implemented | Compiler errors use `NodeonError` with error codes (E0100+), source line context, caret, and help suggestions |
| Standard library | 🔴 High | No stdlib at all — `print` → `console.log` is the only builtin mapping |
| Package manager / registry | 🔴 High | No way to share/install Nodeon packages |
| Documentation for users | 🔴 High | `nodeon-design.md` is outdated; no language reference, no tutorial, no playground |
| Type system depth | ⚠️ Improved | ~~No generics checking~~ ✅ Generics + interface conformance implemented. No control flow analysis, no exhaustiveness |
| Parser robustness | ✅ Fixed | ~~Keywords as variables silently drop functions/classes; `!fn()` in loops breaks parser; `import as` drops imports~~ — All three fixed (BUG-009/010/011) |
| Error recovery | ⚠️ Improved | Parser errors now surfaced in diagnostics; brace-depth recovery; no partial AST for LSP yet |
| Multi-file compilation | 🟡 Medium | CLI `build` walks dependencies but doesn't bundle; no module resolution at runtime |
| REPL | 🟡 Medium | No history persistence, no tab completion, no multi-file state |
| Linter | 🟡 Medium | Semantic analysis in LSP is the only lint-like feature |

---

## 3. Architecture Review

### 3.1 Project Structure

```
Nodeon/
├── src/                      # TypeScript compiler source
│   ├── compiler/
│   │   ├── ast/nodes.ts      # 480 lines — AST type definitions
│   │   ├── lexer/lexer.ts    # 468 lines — tokenizer
│   │   ├── parser/
│   │   │   ├── parser-base.ts  # 145 lines — token navigation
│   │   │   └── parser.ts       # 1699 lines — full parser (could be split)
│   │   ├── generator/
│   │   │   ├── js-generator.ts  # 680 lines — code generation
│   │   │   └── source-map.ts    # 138 lines — V3 source maps
│   │   ├── type-checker.ts    # 377 lines — type checking
│   │   ├── compile.ts         # 60 lines — public API
│   │   └── resolver.ts        # 48 lines — import resolution
│   ├── cli/
│   │   ├── index.ts           # CLI entry point
│   │   ├── commands/          # build, run, repl, init, help
│   │   └── utils/             # compile caching, runtime sandbox, errors, colors
│   └── language/              # keywords, operators, tokens, precedence, symbols
├── src-no/                    # Self-hosted compiler (Nodeon source)
├── dist-no/                   # Compiled self-hosted output
├── packages/
│   ├── language-server/       # LSP implementation (1426 lines)
│   └── vscode-extension/      # VS Code extension
├── tests/                     # Vitest test suites
├── examples/                  # Example .no files
├── scripts/                   # Build scripts (build-cli, build-no, bundle-no)
└── docs/                      # ARCHITECTURE.md
```

### 3.2 Architecture Strengths

- **Clean separation of concerns** — lexer, parser, generator, type checker are independent modules
- **Pratt parsing** — proven technique, handles operator precedence elegantly
- **Path aliases** (`@compiler/*`, `@lexer/*`, etc.) — good DX for development
- **npm workspaces** — LSP server and extension are separate packages
- **Lazy loading in CLI** — `ts-node` only loaded when needed, prebuilt bundle preferred
- **Compilation cache** — SHA1-based cache in `.nodeon-cache/` avoids redundant work

### 3.3 Architecture Concerns

1. ~~**`parser.ts` is 1699 lines in a single class**~~ — The self-hosted version splits into `parser-base`, `parser-types`, `parser-expressions`, `parser-statements`, and `parser`. **✅ Done in .no; TS version should still mirror this refactor.**

2. **No intermediate representation (IR)** — The compiler goes directly from AST to JS. Adding an IR layer would enable:
   - Better optimization passes
   - Easier targeting of other backends (WASM, native)
   - Cleaner type checking integration

3. **Type checker is disconnected** — `typeCheck()` runs on the AST independently; its diagnostics aren't integrated into the main compile flow unless `--check` is passed. It should be always-on in the LSP.

4. **LSP server re-implements parsing logic** — The semantic analysis in `server.ts` manually walks AST nodes with its own scope tracking, duplicating logic that should be shared with the compiler's type checker.

5. **Runtime sandbox is limited** — `vm.runInNewContext` for `nodeon run` doesn't support `import`/`export`, limiting what programs can actually run.

6. ~~**No AST visitor pattern**~~ — **✅ Implemented** in `src-no/compiler/ast/visitor.no`. The TS version should still adopt this pattern.

---

## 4. Identified Bugs

### BUG-001: `let` re-declaration in same scope causes TDZ errors in generated JS ✅ FIXED

**Severity:** 🔴 High  
**Location:** `src/compiler/generator/js-generator.ts`

~~The generator deduplicates `let` declarations — if a variable is declared twice with `let` in the same scope, the second one becomes a bare assignment. However, in switch/match cases sharing a scope, this causes Temporal Dead Zone (TDZ) errors because the `let` from one case isn't emitted but the variable is referenced.~~

**Fix applied:** Each switch case is now wrapped in `{ }` braces to give it its own block scope. This prevents TDZ errors when multiple cases declare variables with the same name. Applied to both TS and .no generators.

### BUG-002: Range loop `..` operator leaks into expression context ✅ FIXED

**Severity:** 🟡 Medium  
**Location:** `src/compiler/generator/js-generator.ts`

~~The `..` operator is only meaningful inside `for` loops (compiled to C-style for). If used in an expression context (e.g., `x = 1..5`), the generator emits `1 .. 5` which is invalid JavaScript.~~

**Fix applied:** Both TS and .no generators now throw an error when `..` is used outside `for` loops: "Range operator '..' can only be used inside 'for' loops".

### BUG-003: Parser recovery can skip valid statements ⚠️ PARTIALLY FIXED

**Severity:** 🟡 Medium  
**Location:** `src/compiler/parser/parser.ts` lines 100-117

~~The `recover()` method skips tokens until it finds a `}`, `;`, or statement-starting keyword. This can over-skip when errors occur inside nested blocks, potentially losing valid subsequent statements.~~

**Fix applied:** `recover()` now tracks brace depth so it doesn't skip past closing braces of outer scopes. Parser errors are surfaced in `compile()` diagnostics (were previously silently lost).  
**Remaining:** No partial AST / error nodes for LSP.

### BUG-004: `checkOperator("||")` matches inside `checkOperator("|")`

**Severity:** 🟡 Medium  
**Location:** `src/compiler/parser/parser.ts` lines 1528-1530

The union type parsing checks `checkOperator("|") && !checkOperator("||")` which is fragile — it relies on the lexer always tokenizing `||` as a single token. If a `|` is at the end of a line followed by `|` on the next line, this could mismatch.

**Impact:** Potential type annotation parsing errors in edge cases.  
**Fix:** Use token value comparison instead of prefix checks.

### BUG-005: Source map inner-line mappings are imprecise

**Severity:** 🟢 Low  
**Location:** `src/compiler/generator/js-generator.ts` lines 102-111

Multi-line statements (functions, classes) map all inner lines back to the statement's `loc.line`, not to the actual source lines of inner statements. This means debugging steps into a function body will always jump to the function declaration line.

**Impact:** Inaccurate breakpoint placement in debuggers.  
**Fix:** Propagate `loc` from inner statements during code generation.

### BUG-006: REPL `runInContext` should be `runInNewContext`

**Severity:** 🟢 Low  
**Location:** `src/cli/commands/repl.ts` line 52

The REPL uses `runInContext` which shares the context object across evaluations (intentional for state persistence), but the context isn't a proper `vm.Context` created with `vm.createContext()`. This can cause subtle issues with global object references.

**Impact:** Potential context leaking or incorrect `this` references in REPL.  
**Fix:** Use `vm.createContext(sandbox)` and `vm.runInContext(js, context)`.

### BUG-007: `consumeIdentifier` allows limited keywords as identifiers ✅ FIXED

**Severity:** 🟢 Low  
**Location:** `src-no/compiler/parser/parser-base.no`

~~Only `print`, `from`, `async`, `of`, `get`, `set` are allowed as identifiers in certain contexts.~~

**Fix applied:** Added `consumePropertyName` method that accepts any keyword as a property name in member expressions (e.g., `stmt.type`, `node.class`). This allows keywords to appear after `.` in property access contexts.

### BUG-008: `import * as name` stores `"* as name"` as a raw string *(Open)*

**Severity:** 🟢 Low  
**Location:** `src/compiler/parser/parser.ts` line 425

Namespace imports store `defaultImport = "* as ${tok.value}"` as a concatenated string instead of having a proper AST representation (e.g., `namespaceImport: string`).

**Impact:** Makes AST manipulation, refactoring tools, and accurate LSP features harder.  
**Fix:** Add a `namespaceImport` field to `ImportDeclaration`.

### BUG-009: Keywords used as variable/parameter names silently destroy output ✅ FIXED

**Severity:** 🔴 Critical  
**Location:** Parser (both TS and self-hosted)

~~Using any Nodeon keyword as a variable name causes the parser to silently lose the entire enclosing function or class.~~

**Fix applied:** Added `CONTEXTUAL_KW` list and `isIdentifierLike()` helper. Keywords like `type`, `as`, `get`, `set`, `from`, `of`, `async`, `static`, `in` are now allowed as identifiers in expression/parameter/import contexts. Applied to both TS and .no parsers. All workarounds reverted.

### BUG-010: `!functionCall()` inside while/for loops breaks parser ✅ FIXED

**Severity:** 🔴 Critical  
**Location:** Self-hosted parser (expression parsing in loop contexts)

~~The pattern `if !someFunction(args) { ... }` inside a `while` or `for` loop body causes the parser to lose the enclosing function wrapper.~~

**Fix applied:** Extracted `parsePostfix()` method handling `.`, `?.`, `[]`, `()`, `++/--` from `parseExpression`. `parseUnary` now calls `parsePostfix` (not `parsePrimary`), so `!fn()` correctly parses as `!(fn())`. Also fixed `new X().method()` chaining by routing new-expression results through `parsePostfix`. Applied to both TS and .no parsers.

### BUG-011: `import { X as Y }` silently drops the import line ✅ FIXED

**Severity:** 🟡 Medium  
**Location:** Self-hosted parser (import parsing)

~~Import statements using the `as` alias are silently dropped because `as` is a Nodeon keyword.~~

**Fix applied:** `parseImportDeclaration` now handles `as` as a keyword token (not just Identifier) and accepts contextual keywords as alias names. Applied to both TS and .no parsers. Workarounds reverted.

### BUG-012: `&&` and `||` had same precedence ✅ FIXED

**Severity:** 🔴 High  
**Location:** `src-no/language/precedence.no`, `src/language/precedence.ts`

~~Both `&&` and `||` had precedence 3, causing missing parentheses in generated JS for mixed expressions like `a && b || c`.~~

**Fix applied:** `&&` = 4, `||` = 3, matching JavaScript semantics. All higher operators shifted accordingly.

---

## 5. Compiler Improvements

### 5.1 Error Messages (Priority: 🔴 Critical)

Current errors look like:
```
SyntaxError: Expected ')' at 15:42
```

Professional languages show:
```
error[E0308]: expected `)`, found `}`
  --> src/main.no:15:42
   |
15 |   fn calculate(a, b {
   |                      ^ expected `)` here
   |
help: you might have forgotten a closing parenthesis
```

**Action items:**
- Add error codes (E0001, E0002, etc.) for every error type
- Include source line context in all error messages
- Add "help" suggestions for common mistakes
- Implement "did you mean?" for misspelled identifiers/keywords
- Color-code error output (already partially done in CLI)

### 5.2 AST Visitor Pattern ✅ Done

~~Create a generic walker to eliminate duplicated switch statements.~~

**Implemented** in `src-no/compiler/ast/visitor.no` with `walkStatement` and `walkExpression`. Used by the self-hosted compiler. The TS version (`src/`) should still adopt this pattern.

### 5.3 Intermediate Representation

Add a simplified IR between AST and code generation:
- Enables optimization passes (dead code elimination, constant folding, inlining)
- Makes targeting other backends (WASM) feasible
- Simplifies the code generator

### 5.4 Incremental Compilation

Currently, every file is re-compiled from scratch (unless cache hits). For large projects:
- Track file dependencies with timestamps
- Only re-compile changed files and their dependents
- Keep ASTs in memory for LSP efficiency

---

## 6. Language Feature Gaps

### 6.1 Missing Features (Priority Order)

| Feature | Priority | Impact | Complexity |
|---------|----------|--------|------------|
| **Module system at runtime** | 🔴 High | Can't run multi-file programs with `nodeon run` | Medium |
| **Async/await in expressions** | 🔴 High | Can't use `await` in variable declarations like `x = await fetch(...)` | Low |
| **Decorators** | 🟡 Medium | Important for frameworks (similar to TS decorators) | Medium |
| **Tuple types at runtime** | 🟡 Medium | Type annotations exist but no runtime tuple support | Low |
| **String methods** | 🟡 Medium | No `.upper()`, `.lower()`, `.trim()` etc. (relies on JS) | Low |
| **Range as first-class value** | 🟡 Medium | `1..10` only works in `for` loops, not as `Range` object | Medium |
| **Map/filter/reduce sugar** | 🟡 Medium | No comprehensions or pipe-friendly collection ops | Medium |
| **Error types** | 🟡 Medium | No custom error class sugar | Low |
| **Null safety** | 🟡 Medium | Optional chaining exists but no compile-time null checks | High |
| **Algebraic data types** | 🟢 Low | Sum types would complement `match` beautifully | High |
| **Macros** | 🟢 Low | Compile-time code generation | Very High |
| **Async generators** | 🟢 Low | `async fn*` combination | Low |
| **Static class fields with types** | 🟢 Low | Currently no type annotations on class fields | Low |

### 6.2 Standard Library (Priority: 🔴 Critical)

Nodeon currently has **zero** standard library. For a language to be usable, it needs at minimum:

```
@nodeon/core          - print, assert, panic, type checking utilities
@nodeon/fs            - file system operations (wrapping Node's fs)
@nodeon/path          - path manipulation
@nodeon/http          - HTTP client and server
@nodeon/json          - JSON parsing/serialization (already works via JS)
@nodeon/collections   - enhanced Map, Set, List, Queue, Stack
@nodeon/string        - string utilities beyond JS built-ins
@nodeon/math          - math utilities
@nodeon/test          - testing framework (assert, describe, it)
@nodeon/fmt           - string formatting
```

**Recommended approach:** Start with thin wrappers around Node.js APIs that use Nodeon idioms, then gradually add Nodeon-specific abstractions.

### 6.3 Missing Syntax Sugar

These are small additions that would greatly improve DX:

1. **If-expressions:** `result = if x > 0 { "positive" } else { "negative" }`
2. **Guard clauses:** `fn process(x) { return if !x }` — early return
3. **String multiply:** `"ha" * 3` → `"hahaha"` (Python-style)
4. **Array slicing:** `arr[1..3]` → `arr.slice(1, 3)`
5. **Unless/until:** `unless condition { ... }` as alias for `if !condition`
6. **Named arguments:** `greet(name: "World", loud: true)`
7. **Default exports shorthand:** `export fn main() { ... }` already works, but `export default class` is verbose

---

## 7. Type System Evolution

### 7.1 Current State

The type checker (`type-checker.ts`, 377 lines) supports:
- Primitive types (string, number, boolean, void, null, undefined)
- Type annotations (parsed and erased from JS output)
- Type inference for literals, binary/unary ops, arrays, objects
- Type assignability checks
- Type narrowing via `typeof` guards
- Union types, intersection types, generics (parse-only)
- Function return type checking

### 7.2 What's Missing

1. **Generic type checking** — Generics are parsed but never checked. `fn identity<T>(x: T): T` doesn't verify that the return type matches.

2. **Control flow analysis** — No tracking of types through conditionals, loops, or assignments. After `if (typeof x === "string")`, the type of `x` isn't narrowed in the else branch.

3. **Exhaustiveness checking** — `match` and `switch` don't verify all cases are covered.

4. **Interface conformance** — Interfaces are parsed and erased but never checked against class implementations.

5. **Class member types** — No type checking for class fields, methods, or inheritance.

6. **Import type resolution** — Types from imported modules are always `any`.

7. **Recursive types** — No support for types that reference themselves.

8. **Discriminated unions** — Would pair naturally with `match`.

### 7.3 Recommended Evolution

**Phase 1 (Basic):** Enforce existing annotations, check function signatures, check class member access  
**Phase 2 (Flow):** Control flow narrowing, exhaustiveness in match/switch, null safety  
**Phase 3 (Advanced):** Full generics, discriminated unions, type inference across modules  
**Phase 4 (Innovation):** Effect system, ownership tracking, or other novel features

---

## 8. CLI & Tooling

### 8.1 Current CLI Commands

| Command | Status | Notes |
|---------|--------|-------|
| `nodeon build <file>` | ✅ Works | Multi-file dependency walking, caching, minification, source maps |
| `nodeon run <file>` | ✅ Works | Compiles + executes in VM sandbox; watch mode with `-w` |
| `nodeon check <file>` | ✅ Works | Type check without compiling |
| `nodeon fmt <file>` | ✅ Works | Code formatter |
| `nodeon repl` | ⚠️ Basic | No history, no tab completion, no import support |
| `nodeon init` | ✅ Works | Creates project scaffold with nodeon.json |
| `nodeon help` | ✅ Works | Displays help text |
| `nodeon version` | ✅ Works | Shows version |
| `nodeon-self` (self-hosted) | ✅ Works | `bin/nodeon-self.js` — runs the self-hosted bundle directly, no TS/ts-node needed |

### 8.2 Missing CLI Commands

| Command | Priority | Description |
|---------|----------|-------------|
| ~~`nodeon fmt`~~ | ✅ Done | ~~Code formatter~~ — implemented |
| `nodeon lint` | 🔴 High | Linter with configurable rules |
| ~~`nodeon check`~~ | ✅ Done | ~~Type check without compiling~~ — implemented |
| `nodeon test` | 🟡 Medium | Built-in test runner (no need for vitest/jest) |
| `nodeon doc` | 🟡 Medium | Documentation generator from source comments |
| `nodeon bundle` | 🟡 Medium | Bundle multiple .no files into a single JS file |
| `nodeon upgrade` | 🟢 Low | Self-update mechanism |
| `nodeon playground` | 🟢 Low | Local web-based playground |

### 8.3 `nodeon.json` Config Evolution

Current config is minimal:
```json
{
  "name": "my-project",
  "version": "0.1.0",
  "entry": "src/main.no",
  "outDir": "dist",
  "strict": false
}
```

Should expand to:
```json
{
  "name": "my-project",
  "version": "0.1.0",
  "entry": "src/main.no",
  "outDir": "dist",
  "target": "node18",
  "strict": true,
  "strictNullChecks": true,
  "sourceMap": true,
  "minify": false,
  "paths": { "@utils/*": ["src/utils/*"] },
  "dependencies": {},
  "devDependencies": {},
  "scripts": {
    "build": "nodeon build",
    "test": "nodeon test",
    "start": "nodeon run src/main.no"
  }
}
```

### 8.4 Watch Mode Improvements

Current watch only watches the entry file's directory. Should:
- Watch all dependency files recursively
- Support `.nodeonignore` for excluding files
- Show compilation time
- Support hot reload for web servers

---

## 9. LSP & Editor Experience

### 9.1 Current LSP Features

| Feature | Status | Quality |
|---------|--------|---------|
| Diagnostics (syntax errors) | ✅ | Real compiler errors shown inline |
| Diagnostics (semantic) | ✅ | Unused variables, redeclarations, undefined refs |
| Completions | ✅ | Keywords + document symbols |
| Hover | ✅ | Keyword docs + symbol info |
| Go-to-definition | ✅ | Functions, classes, variables |
| Semantic tokens | ✅ | AST-based, differentiates fn/class/param/property/etc. |
| Formatting | ⚠️ | Basic indentation formatting |
| Rename | ⚠️ | Document-scoped, no cross-file |
| References | ⚠️ | Document-scoped, no cross-file |
| Code actions | ⚠️ | Basic quick fixes |
| Signature help | ❌ | Not implemented |
| Document symbols | ❌ | Not implemented (separate from completions) |
| Workspace symbols | ❌ | Not implemented |
| Code lens | ❌ | Not implemented |
| Inlay hints | ❌ | Not implemented |
| Folding ranges | ❌ | Not implemented (TextMate markers exist) |
| Call hierarchy | ❌ | Not implemented |

### 9.2 LSP Improvements Needed

1. **Signature help** — Show parameter info while typing function calls
2. **Inlay hints** — Show inferred types inline (like Rust/TypeScript)
3. **Document symbols** — Outline view in VS Code
4. **Cross-file rename/references** — Currently document-scoped only
5. **Auto-imports** — Suggest imports for undefined identifiers
6. **Snippet completions** — `fn`, `for`, `if`, `class` snippets with tab stops
7. **Error recovery in LSP** — Better partial parsing so completions work mid-typing
8. **Workspace-wide analysis** — Track all `.no` files for cross-file diagnostics

### 9.3 VS Code Extension Improvements

1. **Debug adapter** — Enable step debugging of .no files
2. **Test runner integration** — Detect and run Nodeon tests from VS Code
3. **Task provider** — Auto-detect `nodeon.json` and provide build tasks
4. **Marketplace publishing** — Publish to VS Code Marketplace
5. **Syntax highlighting for embedded JS** — Handle backtick templates with JS expressions

---

## 10. Testing & Quality

### 10.1 Current Test Coverage

| Suite | Tests | Coverage Area |
|-------|-------|---------------|
| `lexer.test.ts` | 35 | Token types, edge cases, literals, hex escapes |
| `parser.test.ts` | 84 | All statement/expression types, error cases |
| `e2e.test.ts` | 220 | Full compile pipeline, output verification, named arguments, ADTs, pattern matching v2, go concurrency, comptime, IR pipeline, WASM backend |
| `bootstrap.test.ts` | 98 | Self-hosting: 32 compile + 33 self-compile + 32 fixpoint + 1 lexer functional |
| `type-checker.test.ts` | 81 | Type inference, assignability, narrowing, generics, interface conformance |
| `nova-signals.test.ts` | 21 | signal, computed, effect, untracked, batch, tracking, destroy |
| `nova-template.test.ts` | 32 | tokenizer, parser, rendering, interpolation, @if/@for/@slot, escaping |
| `nova-di.test.ts` | 21 | container, singleton/transient, constructor injection, hierarchy, circular detection |
| `nova-island-bundler.test.ts` | 13 | scanner, entry generation, manifest, bundling, esbuild integration |
| `regression.test.ts` | 26 | Tests for fixed bugs |
| `snapshot.test.ts` | 5 | Output snapshot verification |
| **Total** | **636** | |

### 10.2 Testing Gaps

1. ~~**No type checker tests**~~ — **✅ 81 tests** in `type-checker.test.ts`
2. **No LSP tests** — Language server has zero automated tests
3. **No formatter tests** — No tests for code formatting
4. **No source map tests** — No verification that source maps are correct
5. **No CLI integration tests** — Only a basic `--version` and `build` check in CI
6. **No fuzzing** — No fuzz testing for parser/lexer robustness
7. ~~**No regression tests**~~ — **✅ 25 tests** in `regression.test.ts`
8. ~~**No snapshot tests**~~ — **✅ 5 tests** in `snapshot.test.ts`
9. **No performance benchmarks** — No tracking of compilation speed
10. **No fixpoint test in CI** — Self-hosting fixpoint should be verified automatically

### 10.3 CI/CD Gaps

Current CI (`ci.yml`, 36 lines) only:
- Installs dependencies
- Runs tests
- Verifies CLI `--version`, `build`, and `run`

**Missing:**
- TypeScript type checking (`tsc --noEmit`)
- Linting (ESLint or Biome)
- Code coverage reporting
- Self-hosting bootstrap verification (`node scripts/build-no.js && node scripts/bundle-no.js`)
- Release automation
- VSIX packaging and publishing
- Performance regression testing
- Cross-platform testing (Windows, macOS)

### 10.4 Recommended Test Strategy

```
tests/
├── unit/
│   ├── lexer.test.ts          # Existing
│   ├── parser.test.ts         # Existing
│   ├── generator.test.ts      # NEW: JS output correctness
│   ├── type-checker.test.ts   # NEW: type checking verification
│   ├── source-map.test.ts     # NEW: mapping accuracy
│   └── resolver.test.ts       # NEW: import resolution
├── integration/
│   ├── e2e.test.ts            # Existing (rename)
│   ├── cli.test.ts            # NEW: CLI command testing
│   ├── lsp.test.ts            # NEW: LSP protocol testing
│   └── multi-file.test.ts     # NEW: multi-file compilation
├── bootstrap/
│   └── bootstrap.test.ts      # Existing
├── regression/
│   └── bugs.test.ts           # NEW: one test per fixed bug
└── benchmark/
    └── compile-speed.bench.ts  # NEW: performance tracking
```

---

## 11. Performance

### 11.1 Current Performance Profile

- **CLI startup (dev mode):** ~500-800ms (ts-node registration)
- **CLI startup (built):** ~50ms (prebuilt bundle)
- **Compilation speed:** Not measured; estimated ~1-5ms per file for typical sizes
- **LSP response time:** Not measured; anecdotally fast for single files

### 11.2 Performance Improvements

1. **Prebuilt bundle always** — The dev mode fallback through `ts-node` is very slow. Consider always requiring `npm run build:cli` first.

2. **Streaming compilation** — Currently loads entire file into memory. For very large files, a streaming lexer would help.

3. **Parallel multi-file compilation** — `build` command processes files sequentially. Use `worker_threads` for parallel compilation.

4. **Incremental LSP updates** — Currently re-parses the entire file on every change. Implement incremental parsing for large files.

5. **Lazy AST construction** — Don't construct full AST nodes until needed (useful for type-checking-only passes).

6. **Compilation cache improvements** — Current SHA1 cache doesn't invalidate on compiler changes. Add compiler version to cache key.

---

## 12. Ecosystem & Community

### 12.1 What's Needed for Adoption

1. **Website** — A modern landing page with:
   - Interactive playground (compile in browser via WASM or server)
   - Getting started guide
   - Language reference
   - API docs
   - Blog

2. **Package Registry** — Either:
   - Interop fully with npm (recommended — path of least resistance)
   - Build a Nodeon-specific registry on top of npm

3. **Library Ecosystem** — Bootstrap with:
   - Web framework (Express-like)
   - Testing framework
   - ORM/database utilities
   - HTTP client

4. **Learning Resources:**
   - "Nodeon by Example" (like Go by Example)
   - "Nodeon for TypeScript Developers"
   - "Nodeon for Python Developers"
   - Video tutorials

5. **Community Infrastructure:**
   - Discord server
   - GitHub Discussions enabled
   - Contributing guide (CONTRIBUTING.md)
   - Code of conduct
   - RFC process for language changes

### 12.2 Competitive Positioning

Nodeon's unique value proposition:

| vs TypeScript | vs Python | vs Go |
|---------------|-----------|-------|
| Cleaner syntax (no semicolons, `fn` keyword) | Full JS ecosystem compatibility | Higher-level abstractions |
| Simpler tooling (single binary) | Static types (optional) | Richer expression syntax |
| Faster compilation (no tsc) | Better performance (JS engine) | Simpler async (same model as JS) |
| `match` + pipe operator | `match` + classes + imports | Familiar C-like syntax |

**Key differentiator:** Python's simplicity + TypeScript's power + full Node.js compatibility

---

## 13. Best Practices to Adopt

### 13.1 Code Quality

- [ ] **Enable `strict: true` in tsconfig.json** — Currently `false`; this allows implicit `any` and other unsafe patterns throughout the compiler
- [ ] **Add ESLint or Biome** — No linter configured for the TypeScript source
- [ ] **Consistent error handling** — Some functions throw, some return null, some use Result types. Standardize on one pattern
- [ ] **JSDoc comments** — Core compiler functions lack documentation
- [ ] **Code coverage** — Add coverage reporting (c8 or istanbul via vitest)

### 13.2 Git & Release Practices

- [ ] **Semantic versioning** — Currently `0.1.0` with no release process
- [ ] **Changelog** — No CHANGELOG.md
- [ ] **Git tags for releases** — No versioned releases
- [ ] **Branch protection** — Enforce CI passing before merge
- [ ] **Conventional commits** — Standardize commit messages

### 13.3 Documentation

- [ ] **Language specification** — Formal grammar (BNF/EBNF), operator precedence table, complete syntax reference
- [ ] **API documentation** — Document the `compile()`, `compileToAST()`, `compileWithSourceMap()` APIs
- [ ] **Contributing guide** — How to set up dev environment, run tests, submit PRs
- [ ] **Architecture decision records (ADRs)** — Document why key decisions were made

### 13.4 Security

- [ ] **Sandbox hardening** — `nodeon run` uses `vm.runInNewContext` which is not a security boundary. Document this or use a proper sandbox.
- [ ] **Dependency audit** — Run `npm audit` in CI
- [ ] **No eval** — Ensure the compiler never uses `eval` or `Function` constructor in generated output (currently clean)

---

## 14. Roadmap Completo: Todo lo Pendiente

> **Estado a marzo 2026:** Compilador self-hosting con fixpoint verificado (636 tests, 32 módulos .no). Compilador TS deprecado. Sistema de tipos con genéricos + conformance de interfaces. Nova framework completo (12 módulos migrados a .no). Innovaciones: if-expressions, array slicing, named arguments, ADTs, pattern matching v2, go concurrency, comptime, IR layer, WASM backend.
>
> Este roadmap agrupa **todo lo pendiente** organizado por área y prioridad. Items marcados ✅ = completados. Items sin marcar = pendientes.

---

### 14.1 Bugs Abiertos

| ID | Severidad | Descripción | Archivo |
|----|-----------|-------------|---------|
| BUG-003 | 🟡 Medio | `recover()` puede saltar sentencias válidas. No hay AST parcial / error nodes para el LSP | `parser.ts` |
| BUG-004 | 🟡 Medio | `checkOperator("||")` hace match parcial con `"|"`. Frágil para union types | `parser.ts:1528` |
| BUG-005 | 🟢 Bajo | Source maps: líneas internas de funciones mapean a la línea de declaración, no a su línea real | `js-generator.ts` |
| BUG-006 | 🟢 Bajo | REPL usa `runInContext` sin `vm.createContext()`. Posible leak de contexto | `repl.ts:52` |
| BUG-008 | 🟢 Bajo | `import * as name` almacena string crudo en vez de AST propio (`namespaceImport` field) | `parser.ts:425` |

**Patrones .no conocidos que causan OOM en el compilador self-hosted:**
- `(expr).method()` encadenamiento sobre expresiones agrupadas → usar variables intermedias
- `{ ...obj }` object spread → usar `Object.assign()`
- `(() => {...})()` IIFEs → usar funciones con nombre
- `async (args) => {}` async arrows → extraer como `async fn name(args) {}`
- `import.meta.url` no soportado por el parser

---

### 14.2 Compilador — Mejoras Pendientes

#### 14.2.1 Parser

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Error nodes / AST parcial | 🔴 Alta | Insertar `ErrorNode` en el AST cuando el parser encuentra un error, para que el LSP ofrezca completions/hover en código con errores |
| `import.meta` support | 🟡 Media | El parser no reconoce `import.meta.url` ni `import.meta.resolve()`. Necesario para ESM nativo |
| Decorators execution | 🟡 Media | Los decorators se parsean (`@log`, `@Injectable()`) pero no se ejecutan en el código generado. Solo se almacenan en el AST |
| `async` arrow functions | 🟡 Media | `async (x) => {}` no se soporta como expresión. Requiere lookahead para distinguir de `async` como identificador |
| Partial application | 🟢 Baja | Sintaxis tipo `add(1, _)` para aplicación parcial que genere arrow: `(x) => add(1, x)` |
| Pipeline operator | 🟢 Baja | `x |> fn1 |> fn2` como sugar para `fn2(fn1(x))` |
| `do` expressions | 🟢 Baja | `const x = do { let a = 1; a + 2 }` — bloque como expresión |

#### 14.2.2 Generador de Código (JS)

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Source maps inner-line | 🟡 Media | Propagar `loc` de sentencias internas para breakpoints precisos (BUG-005) |
| Tree shaking básico | 🟡 Media | Eliminar exports no usados en modo bundle |
| `import.meta` passthrough | 🟡 Media | Emitir `import.meta.url` tal cual en output ESM |
| Output ESM/CJS configurable | 🟡 Media | Flag `--format esm|cjs` para elegir formato del output |
| Minificación mejorada | 🟢 Baja | Mangling de variables locales, dead code stripping, constant inlining |
| Pretty-print mode | 🟢 Baja | Output con indentación y comments preservados |

#### 14.2.3 IR Layer (Intermediate Representation)

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Más AST nodes → IR | 🟡 Media | `lowerToIR()` solo soporta funciones, variables, expresiones binarias, if-statements. Faltan: for/while loops, classes, try/catch, match, destructuring, imports/exports |
| Inlining pass | 🟡 Media | Inline funciones pequeñas (≤3 instrucciones) en sus call sites |
| Copy propagation | 🟡 Media | Eliminar asignaciones redundantes: `_t0 = x; y = _t0` → `y = x` |
| Escape analysis | 🟢 Baja | Determinar si objetos/closures escapan su scope para optimizar allocations |
| Loop optimizations | 🟢 Baja | Loop-invariant code motion, strength reduction |
| SSA form completo | 🟢 Baja | Full SSA con φ-nodes para mejor análisis |

#### 14.2.4 WebAssembly Backend

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Strings en WASM | 🔴 Alta | Solo soporta `i32`/`f64`. Necesita: linear memory, string encoding/decoding, GC integration |
| Arrays/Objects | 🔴 Alta | Sin soporte para tipos compuestos. Requiere memory layout + allocation strategy |
| Control flow | 🟡 Media | Solo soporta `return`. Faltan: `if/else` → `br_if`, `for/while` → `loop`/`br`, `match` → `br_table` |
| Function imports/exports | 🟡 Media | Import de funciones JS host y export completo del módulo |
| Memory management | 🟡 Media | Allocator básico (bump allocator o arena) para heap en linear memory |
| WASI target | 🟢 Baja | Compilar a WASI para ejecución standalone fuera del browser |

#### 14.2.5 Errores del Compilador

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| "Did you mean?" | 🟡 Media | Sugerir identificadores similares (Levenshtein distance) cuando un nombre no se encuentra |
| Error recovery mejorada | 🟡 Media | Insertar tokens faltantes automáticamente para reportar más errores a la vez |
| Warnings | 🟡 Media | Añadir warnings: unused variables, unreachable code after return, deprecated features |
| Error limits | 🟢 Baja | Limitar a N errores (ej. 20) para evitar cascadas |
| Colored output en API | 🟢 Baja | `compile()` retorna plain text. Añadir opción `color: boolean` |

### 14.3 Sistema de Tipos — Mejoras Pendientes

El type checker (`type-checker.ts`, 593 líneas) tiene: primitivos, inference, narrowing con `typeof`, genéricos, interface conformance. **Falta mucho para ser útil en producción.**

#### Prioridad 🔴 Alta

| Item | Descripción | Complejidad |
|------|-------------|-------------|
| Control flow narrowing | Después de `if typeof x == "string"`, narrowing en ambas ramas. Después de `if x != null`, eliminar null/undefined. Después de `instanceof`, narrowing a la clase | Alta |
| Exhaustiveness checking | `match`/`switch` sobre union types debe verificar que todos los casos estén cubiertos. Error si falta un case | Media |
| Cross-file type resolution | Importar tipos de otros archivos `.no`. Actualmente todo import es `any`. Requiere: parsear archivos importados, construir type environment global | Alta |
| Null safety (`T?`) | `T?` como sugar para `T | null | undefined`. `strictNullChecks` mode. Error al acceder a `.property` sin null check previo | Alta |

#### Prioridad 🟡 Media

| Item | Descripción | Complejidad |
|------|-------------|-------------|
| Class member types | Type checking para campos, métodos, herencia. Verificar que `super()` se llama en constructores. Checking de visibilidad (private `#fields`) | Media |
| Recursive types | Tipos que se referencian a sí mismos: `type List = { value: T, next: List | null }` | Media |
| Discriminated unions | `type Result<T, E> = { ok: true, value: T } | { ok: false, error: E }`. Auto-narrowing por campo discriminante en match/if | Media |
| Template literal types | `type EventName = "on${string}"`. Checking de template strings contra patterns | Alta |
| Mapped types | `type Readonly<T> = { readonly [K in keyof T]: T[K] }` | Muy alta |
| Conditional types | `type IsString<T> = T extends string ? true : false` | Muy alta |
| Type inference en closures | Inferir tipos de parámetros de callbacks desde el contexto: `[1,2].map((x) => x + 1)` → `x: number` | Media |

#### Prioridad 🟢 Baja

| Item | Descripción | Complejidad |
|------|-------------|-------------|
| `satisfies` operator | `const x = { a: 1 } satisfies Record<string, number>` — verificar sin ampliar | Baja |
| `readonly` arrays/props | `readonly number[]`, `readonly` en properties de objetos e interfaces | Baja |
| `keyof` / `typeof` type operators | `type Keys = keyof MyInterface`. `typeof variable` como type annotation | Media |
| Overload signatures | Múltiples firmas para la misma función con diferentes tipos de parámetros | Media |
| Type predicates | `fn isString(x: any): x is string` — narrow en el call site | Media |
| `infer` keyword | Pattern matching en conditional types | Muy alta |

---

### 14.4 CLI & Tooling — Pendiente

#### 14.4.1 Comandos CLI Nuevos

| Comando | Prioridad | Descripción |
|---------|-----------|-------------|
| `nodeon lint` | 🔴 Alta | Linter con reglas configurables. Mínimo: unused vars, unreachable code, shadowed variables, naming conventions, no-unused-imports. Config en `nodeon.json` |
| `nodeon test` | 🔴 Alta | Test runner nativo. `describe`/`it`/`expect` API. Soporte para `--watch`, `--coverage`, `--filter`. Sin dependencia de vitest/jest |
| `nodeon bundle` | 🟡 Media | Bundler: múltiples `.no` → un solo `.js`. Tree shaking, code splitting, dynamic imports |
| `nodeon doc` | 🟡 Media | Generador de documentación desde `/** */` comments. Output HTML/Markdown |
| `nodeon bench` | 🟡 Media | Benchmarking: `bench("name", () => { ... })`. Output con ops/sec, comparaciones |
| `nodeon upgrade` | 🟢 Baja | Auto-actualización del compilador |
| `nodeon playground` | 🟢 Baja | Playground web local: editor + preview + output. Usa el compilador WASM en el browser |
| `nodeon publish` | 🟢 Baja | Publicar paquete a npm (wrapper sobre `npm publish` con build previo) |

#### 14.4.2 REPL Mejoras

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Historial persistente | 🔴 Alta | Guardar historial en `~/.nodeon_history`. Navegar con ↑↓ |
| Tab completion | 🔴 Alta | Completar keywords, variables en scope, métodos de objetos |
| Multi-line input | 🟡 Media | Detectar statements incompletos (brace abierto) y pedir continuación |
| Import support | 🟡 Media | `import { readFile } from 'fs'` en el REPL. Requiere resolver modules |
| `.help` / `.clear` / `.exit` | 🟡 Media | Comandos especiales del REPL |
| Syntax highlighting | 🟢 Baja | Colorear input en el REPL |
| `vm.createContext()` fix | 🟢 Baja | BUG-006: Usar context adecuado |

#### 14.4.3 Build System

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Incremental compilation | 🔴 Alta | Trackear dependencias entre archivos. Solo recompilar archivos cambiados + sus dependientes. Cache con hash de contenido + versión del compilador |
| Parallel compilation | 🟡 Media | Usar `worker_threads` para compilar múltiples archivos en paralelo |
| Watch mode mejorado | 🟡 Media | Vigilar todas las dependencias recursivamente, soportar `.nodeonignore`, mostrar tiempo de compilación |
| Hot reload | 🟡 Media | Para servidores web: recargar módulos sin reiniciar el proceso |
| Build profiles | 🟢 Baja | `nodeon build --profile dev|prod|test`. Cada perfil con settings distintos |
| Output directory structure | 🟢 Baja | Preservar estructura de directorios del source en el output |

#### 14.4.4 Configuración (`nodeon.json`)

Actualmente solo: `name`, `version`, `entry`, `outDir`, `strict`. **Debería expandirse a:**

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "entry": "src/main.no",
  "outDir": "dist",
  "target": "node20",
  "format": "esm",
  "strict": true,
  "strictNullChecks": true,
  "sourceMap": true,
  "minify": false,
  "paths": { "@utils/*": ["src/utils/*"] },
  "include": ["src/**/*.no"],
  "exclude": ["**/*.test.no"],
  "lint": {
    "rules": { "no-unused-vars": "warn", "no-shadow": "error" }
  },
  "test": {
    "include": ["tests/**/*.test.no"],
    "coverage": true
  },
  "dependencies": {},
  "devDependencies": {},
  "scripts": {
    "build": "nodeon build",
    "test": "nodeon test",
    "dev": "nodeon run src/main.no -w"
  }
}
```

### 14.5 LSP & Editor — Pendiente

#### 14.5.1 LSP Features Faltantes

| Feature | Prioridad | Estado Actual | Trabajo Necesario |
|---------|-----------|---------------|-------------------|
| Inlay hints | 🔴 Alta | No implementado | Mostrar tipos inferidos inline (como Rust-analyzer): `let x/*: number*/ = 42`. Requiere type checker integrado |
| Signature help | 🔴 Alta | Registrado pero básico | Parsear firma de la función bajo cursor, mostrar parámetros con tipos, highlight del parámetro activo |
| Document symbols | 🟡 Media | Registrado pero incompleto | Retornar árbol jerárquico de funciones, clases, variables top-level para el Outline view |
| Auto-imports | 🟡 Media | No implementado | Cuando un identificador no está definido, sugerir imports de otros archivos del proyecto |
| Workspace symbols | 🟡 Media | No implementado | `Ctrl+T` para buscar símbolos en todo el proyecto |
| Cross-file rename | 🟡 Media | Solo document-scoped | Renombrar un símbolo en todos los archivos que lo importan/usan |
| Cross-file references | 🟡 Media | Solo document-scoped | Find all references across workspace |
| Code lens | 🟢 Baja | No implementado | Mostrar "N references" sobre funciones/clases. "Run test" sobre test functions |
| Folding ranges | 🟢 Baja | No implementado | Colapsar funciones, clases, bloques if/for |
| Call hierarchy | 🟢 Baja | No implementado | "Show incoming/outgoing calls" para navegación de código |
| Snippet completions | 🟢 Baja | No implementado | `fn` → inserta template de función con tab stops. `for` → inserta for loop template |
| Organize imports | 🟢 Baja | No implementado | Ordenar y agrupar imports, eliminar unused imports |

#### 14.5.2 LSP Performance

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Incremental parsing | 🔴 Alta | Re-parsea el archivo completo en cada keystroke. Para archivos grandes será lento. Implementar incremental o cache por regiones |
| Workspace indexing | 🟡 Media | Indexar todos los archivos `.no` del workspace al inicio. Mantener índice actualizado con file watchers |
| Throttle/debounce | 🟡 Media | Debounce de 150-300ms para diagnósticos |
| Background type checking | 🟢 Baja | Mover type checking a un worker thread |

#### 14.5.3 VS Code Extension

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| **Publicar en Marketplace** | 🔴 Alta | La extensión existe como `.vsix` local pero no está publicada. Crear publisher, subir, configurar CI para auto-publish |
| Debug Adapter (DAP) | 🟡 Media | Step debugging de archivos `.no` usando source maps. Launch config para `nodeon run` con breakpoints |
| Test runner integration | 🟡 Media | Detectar test files, mostrar botón Run junto a `describe`/`it`, reportar resultados en Test Explorer |
| Task provider | 🟡 Media | Auto-detectar `nodeon.json` y ofrecer build tasks |
| Embedded JS highlighting | 🟢 Baja | Syntax highlighting para código JS dentro de template literals |
| Icon theme mejorado | 🟢 Baja | Iconos personalizados para `.no` files en el explorer |
| Settings UI | 🟢 Baja | Configuración de la extensión: path al compilador, strict mode, format on save |

---

### 14.6 Testing & Calidad — Pendiente

#### 14.6.1 Test Suites Faltantes

| Suite | Prioridad | Tests Actuales | Lo que Falta |
|-------|-----------|----------------|--------------|
| LSP tests | 🔴 Alta | 0 | El language server (1713 líneas, `server.ts`) tiene CERO tests. Testear: diagnostics, completions, hover, go-to-def, rename, formatting, semantic tokens |
| Formatter tests | 🔴 Alta | 0 | `nodeon fmt` no tiene tests. Verificar indentación, spacing, brace placement, preservación de comments |
| Source map tests | 🟡 Media | 0 | Verificar line/column mapping accuracy, VLQ encoding, multi-file |
| CLI integration tests | 🟡 Media | ~3 en CI | Solo verifica `--version`, `build`, `run`. Falta: `check`, `fmt`, `init`, `repl`, error cases, flags |
| IR pipeline tests | 🟡 Media | 8 | Solo cubre funciones y aritmética básica. Faltan: control flow, calls complejos, optimization edge cases |
| WASM backend tests | 🟡 Media | 5 | Solo aritmética i32/f64. Faltan: function calls, locals, control flow, edge cases |
| Nova router/renderer/server tests | 🟡 Media | 0 | Solo signals (21), DI (21), template (32), island-bundler (13) tienen tests. Router, renderer, server, builder, cli, compiler-bridge, island no tienen tests |
| Fuzzing | 🟢 Baja | 0 | Fuzz testing del lexer y parser con inputs aleatorios |
| Performance benchmarks | 🟢 Baja | 0 | Track compilation speed. Detectar regresiones |

#### 14.6.2 CI/CD Mejoras

| Item | Prioridad | Estado | Lo que Falta |
|------|-----------|--------|--------------|
| Code coverage | 🔴 Alta | ❌ | Añadir `vitest --coverage` con c8/istanbul. Reportar en CI. Target: >80% |
| TypeScript strict check | 🟡 Media | ❌ | `tsc --noEmit` en CI. Actualmente `strict: false` en tsconfig |
| Linting en CI | 🟡 Media | ❌ | ESLint o Biome para el source TypeScript |
| Cross-platform CI | 🟡 Media | Solo Ubuntu | Añadir Windows y macOS a la matrix |
| Release automation | 🟡 Media | ❌ | GitHub Actions: tag → build → npm publish → GitHub Release con changelog |
| VSIX publish en CI | 🟢 Baja | ❌ | Auto-publicar extensión VS Code en cada release |
| Dependency audit | 🟢 Baja | ❌ | `npm audit` automático |
| Performance regression | 🟢 Baja | ❌ | Benchmark en CI, fallar si speed baja >10% |

---

### 14.7 Lenguaje — Features Pendientes

#### 14.7.1 Syntax Sugar Faltante

| Feature | Prioridad | Ejemplo | Compilación |
|---------|-----------|---------|-------------|
| Guard clauses | 🟡 Media | `fn process(x) { return if !x }` | `if (!x) return;` |
| String multiply | 🟡 Media | `"ha" * 3` | `"ha".repeat(3)` |
| `unless` / `until` | 🟢 Baja | `unless condition { ... }` | `if (!condition) { ... }` |
| Chained comparisons | 🟢 Baja | `0 < x < 10` | `0 < x && x < 10` |
| Null-coalescing assignment | 🟡 Media | `x ??= defaultValue` | `x = x ?? defaultValue` |

#### 14.7.2 Features del Lenguaje Faltantes

| Feature | Prioridad | Descripción | Complejidad |
|---------|-----------|-------------|-------------|
| Module system at runtime | 🔴 Alta | `nodeon run` no puede ejecutar programas multi-archivo con `import`. El sandbox VM no soporta ESM imports | Media |
| Decorators (ejecución) | 🟡 Media | Se parsean pero no se emiten. `@log fn hello() {}` debería generar `hello = log(hello)` | Media |
| Range como first-class value | 🟡 Media | `1..10` solo funciona en `for`. Debería poder usarse como: `const r = 1..10; r.map(fn)`. Requiere `Range` class en stdlib | Media |
| Pipe operator | 🟡 Media | `data |> parse |> validate |> save` como sugar para composición | Baja |
| Map/filter/reduce sugar | 🟡 Media | Comprehensions: `[x * 2 for x in arr if x > 0]` | Media |
| Async generators | 🟡 Media | `async fn* stream()` combinación de async + generator | Baja |
| `with` statement (resource mgmt) | 🟡 Media | `with file = open("x.txt") { ... }` auto-close al salir del scope | Media |
| Error types sugar | 🟢 Baja | `error NotFound(message: string)` shorthand para error classes | Baja |
| Macros | 🟢 Baja | Compile-time code generation más allá de `comptime`. Quasi-quoting, AST manipulation | Muy alta |
| Standalone binaries | 🟢 Baja | Bundle a ejecutable único via Node SEA (Single Executable Applications) | Media |
| Effect system | 🟢 Baja | Track side effects en el tipo: `fn readFile(): IO<string>`. Experimental | Muy alta |
| Ownership / borrow checking | 🟢 Baja | Rust-style ownership para prevenir data races en `go` concurrency. Experimental | Muy alta |

---

### 14.8 Standard Library — Plan Completo

Nodeon tiene **cero** standard library. `print` → `console.log` es la única builtin. Para ser usable:

#### Tier 1 — Esencial (🔴 Alta)

| Módulo | Contenido | Notas |
|--------|-----------|-------|
| `@nodeon/core` | `print`, `println`, `assert`, `panic`, `todo`, `unreachable`, `dbg`, `typeOf`, `isString`, `isNumber`, `isArray`, `isObject`, `isFunction`, `deepEqual`, `clone` | Wrappers idiomáticos sobre JS builtins |
| `@nodeon/fs` | `readFile`, `writeFile`, `readDir`, `exists`, `mkdir`, `rm`, `copy`, `stat`, `watch` | Wrapper sobre Node `fs/promises` con API limpia |
| `@nodeon/path` | `join`, `resolve`, `dirname`, `basename`, `extname`, `relative`, `isAbsolute` | Re-export de Node `path` con tipos |
| `@nodeon/test` | `describe`, `it`, `expect`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `mock`, `spy` | Test framework nativo sin deps externas |

#### Tier 2 — Importante (🟡 Media)

| Módulo | Contenido | Notas |
|--------|-----------|-------|
| `@nodeon/http` | `fetch`, `serve`, `Request`, `Response`, `Router` | Client: wrapper de `fetch`. Server: wrapper de `http.createServer` |
| `@nodeon/json` | `parse`, `stringify`, `isValid`, `schema` | Wrapper con error handling mejorado |
| `@nodeon/collections` | `List`, `OrderedMap`, `OrderedSet`, `Queue`, `Stack`, `Deque`, `DefaultMap`, `MultiMap` | Estructuras de datos inmutables y mutables |
| `@nodeon/string` | `capitalize`, `camelCase`, `snakeCase`, `kebabCase`, `truncate`, `padCenter`, `words`, `lines`, `dedent` | Utilidades de string |
| `@nodeon/fmt` | `format`, `printf`, `template` | String formatting tipo Python f-strings |
| `@nodeon/math` | `clamp`, `lerp`, `randomInt`, `randomFloat`, `round`, `sum`, `average`, `median` | Utilidades matemáticas |

#### Tier 3 — Nice to Have (🟢 Baja)

| Módulo | Contenido | Notas |
|--------|-----------|-------|
| `@nodeon/async` | `sleep`, `timeout`, `retry`, `parallel`, `sequential`, `debounce`, `throttle`, `channel` | Async utilities + CSP channels para `go` |
| `@nodeon/crypto` | `hash`, `hmac`, `encrypt`, `decrypt`, `randomBytes`, `uuid` | Wrapper sobre Node `crypto` |
| `@nodeon/env` | `get`, `require`, `set`, `load` (dotenv-style) | Manejo de environment variables |
| `@nodeon/log` | `info`, `warn`, `error`, `debug`, `trace`. Levels, formatters, transports | Logging framework |
| `@nodeon/cli` | `arg`, `flag`, `command`, `prompt`, `confirm`, `spinner`, `progress`, `table` | CLI framework |
| `@nodeon/date` | `now`, `parse`, `format`, `diff`, `add`, `subtract`, `isAfter`, `isBefore` | Date/time utilities |
| `@nodeon/stream` | `readable`, `writable`, `transform`, `pipeline` | Stream utilities |
| `@nodeon/net` | `tcp.connect`, `tcp.listen`, `udp`, `dns.resolve` | Networking bajo nivel |
| `@nodeon/process` | `exec`, `spawn`, `fork`, `pid`, `argv`, `env`, `exit` | Process management |
| `@nodeon/regex` | `match`, `matchAll`, `replace`, `split`, `test`, named groups, verbose mode | Regex con API más limpia |

**Implementación recomendada:** Escribir cada módulo en Nodeon (`.no`), compilar a JS. Publicar como paquete npm `@nodeon/*`. Tier 1 se distribuye con el compilador.

---

### 14.9 Nova Framework — Pendiente

#### 14.9.1 Features Core Pendientes

| Feature | Prioridad | Descripción |
|---------|-----------|-------------|
| CSS extraction / scoped styles | 🔴 Alta | `style()` method en pages genera CSS, pero no se extrae a archivos separados. Falta: scoping con hash de clase, injection, CSS file output en build |
| Component composition | 🟡 Media | Permitir `<Counter />` dentro de templates que renderice otro componente. Actualmente solo HTML plano |
| Layout nesting | 🟡 Media | Layouts que heredan de otros layouts. `extends: "base"` en page metadata |
| Data loading (SSR) | 🟡 Media | `load()` method con caching y revalidation |
| API middleware | 🟡 Media | Middleware chain para API routes: auth, cors, rate limiting, logging |
| Hot Module Replacement | 🟢 Baja | HMR real (no full page reload). Requiere module graph tracking + WebSocket |
| Incremental Static Regeneration | 🟢 Baja | Rebuild solo las páginas cuyos datos cambiaron |
| Edge rendering | 🟢 Baja | Deploy a edge functions (Cloudflare Workers, Vercel Edge) |

#### 14.9.2 Testing del Framework

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Router tests | 🔴 Alta | `buildRoutes()` y `matchRoute()` no tienen tests. Testear: static routes, dynamic `[param]`, catch-all, API routes, priority ordering |
| Renderer tests | 🔴 Alta | `renderPage()`, `wrapHtmlShell()`, `injectStyle()` sin tests |
| Island tests | 🟡 Media | `island()`, `renderIsland()`, `generateHydrationScript()` sin tests |
| Server tests | 🟡 Media | Dev server sin tests. Testear: static file serving, route matching, live reload, error pages |
| Builder tests | 🟡 Media | `buildSite()` sin tests |
| E2E framework tests | 🟢 Baja | End-to-end: init project → dev server → build → verify output HTML |

---

### 14.10 Documentación — Pendiente

| Documento | Prioridad | Estado | Descripción |
|-----------|-----------|--------|-------------|
| **Language Reference** | 🔴 Alta | ❌ No existe | Gramática formal (BNF/EBNF), tabla de precedencia de operadores, referencia completa de sintaxis, semántica de cada statement/expression |
| **Getting Started Guide** | 🔴 Alta | ❌ No existe | Instalación, primer programa, compilar, ejecutar, estructura de proyecto |
| **"Nodeon by Example"** | 🔴 Alta | ❌ No existe | Tutorial progresivo estilo Go by Example: hello world → variables → functions → classes → pattern matching → signals → web app |
| **API Reference** | 🟡 Media | ❌ No existe | Documentar `compile()`, `compileToAST()`, `compileWithSourceMap()`, `compileWithIR()`, `compileToWasm()`, `compileToWat()` APIs |
| **Migration Guide (from TS)** | 🟡 Media | ❌ No existe | Guía para migrar proyectos TypeScript a Nodeon. Equivalencias de sintaxis, gotchas, interop |
| **Nova Framework Docs** | 🟡 Media | ⚠️ Parcial (`framework-architecture.md`) | Tutorial completo: pages, routing, templates, signals, DI, islands, deployment |
| **Contributing Guide** | 🟡 Media | ❌ No existe | Setup de desarrollo, cómo correr tests, architecture overview, PR guidelines. `CONTRIBUTING.md` |
| **CHANGELOG.md** | 🟡 Media | ❌ No existe | Debería listar cambios por versión |
| **Architecture Decision Records** | 🟢 Baja | ❌ No existe | ADRs: por qué Pratt parsing, por qué self-hosting, por qué no semicolons, por qué `fn` en vez de `function`, etc. |
| **nodeon-design.md** actualizado | 🟢 Baja | ⚠️ Desactualizado | El documento de diseño original está desactualizado. Reescribir con el estado actual |
| **Playground web** | 🟢 Baja | ❌ No existe | Editor web interactivo para probar Nodeon sin instalar. Compilar en browser con WASM backend |
| **Website** | 🟢 Baja | ❌ No existe | Landing page: features, playground embed, docs, blog, community links |

---

### 14.11 Ecosystem & Community — Pendiente

#### 14.11.1 Infraestructura de Comunidad

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| npm package publicado | 🔴 Alta | `npm install -g nodeon` debería funcionar. Actualmente solo es un repo local |
| VS Code extension en Marketplace | 🔴 Alta | Ya existe `.vsix`. Publicar con auto-update via CI |
| Discord / GitHub Discussions | 🟡 Media | Espacio de comunidad para preguntas, showcase, RFCs |
| `CONTRIBUTING.md` | 🟡 Media | Guía de contribución con setup, coding style, test requirements, PR process |
| Code of Conduct | 🟡 Media | `CODE_OF_CONDUCT.md` — estándar (Contributor Covenant) |
| RFC process | 🟢 Baja | Para cambios al lenguaje: propuesta → discusión → implementación |
| Blog | 🟢 Baja | Posts sobre decisiones de diseño, releases, tutoriales |
| Benchmark comparisons | 🟢 Baja | Comparar compilation speed vs TypeScript, bundle size vs TS output |

#### 14.11.2 Interop con el Ecosistema Existente

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| npm interop | 🔴 Alta | `import express from 'express'` debe funcionar. Resolver `node_modules`, leer `package.json` exports |
| `.d.no` type definitions | 🟡 Media | Equivalente a `.d.ts`. Permitir declarar tipos de módulos npm externos |
| TypeScript interop | 🟡 Media | Importar archivos `.ts` desde `.no` (compilar TS on-the-fly o leer `.d.ts`) |
| Node.js builtins types | 🟡 Media | Type definitions para `fs`, `path`, `http`, `crypto`, etc. |
| ESLint plugin | 🟢 Baja | Plugin para lint de archivos `.no` con ESLint rules |
| Prettier plugin | 🟢 Baja | Plugin para formatear archivos `.no` con Prettier |

---

### 14.12 Seguridad — Pendiente

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| Sandbox hardening | 🟡 Media | `nodeon run` usa `vm.runInNewContext` que NO es security boundary. Documentar o usar `isolated-vm` / worker threads |
| `comptime` sandboxing | 🟡 Media | `comptime` ejecuta código arbitrario vía `new Function()` durante compilación. Potencial vector de ataque en CI/CD |
| No eval en output | ✅ | El compilador no genera `eval`/`Function` en el output. Mantener así |
| Dependency audit en CI | 🟢 Baja | `npm audit` automático. Actualmente 0 vulnerabilidades (pocas deps) |
| WASM sandbox | 🟢 Baja | El WASM output se ejecuta en sandbox por diseño. Documentar security model |

---

### 14.13 Performance — Pendiente

| Item | Prioridad | Estado | Descripción |
|------|-----------|--------|-------------|
| Benchmarks | 🔴 Alta | ❌ | Crear `bench/compile-speed.bench.ts` con: time per file, lines/sec, memory usage, startup time |
| Startup time (dev mode) | 🟡 Media | ~500-800ms | `ts-node` registration es lento. Ya mitigado con self-hosted bundle (~50ms). Eliminar fallback path eventualmente |
| Large file handling | 🟡 Media | No testeado | ¿Qué pasa con archivos de 10k+ líneas? Streaming lexer, lazy AST, incremental reparsing |
| Memory usage | 🟡 Media | No medido | Self-hosted compiler puede OOM con patrones complejos. Profiling de heap necesario |
| LSP responsiveness | 🟡 Media | No medido | Response time para completions, hover, diagnostics en archivos grandes. Target: <100ms |
| Compilation cache | 🟢 Baja | SHA1 básico | No invalida con cambios del compilador. Añadir versión del compilador al cache key |
| Parallel compilation | 🟢 Baja | Sequential | `worker_threads` para multi-file builds |

---

### 14.14 Código Interno — Deuda Técnica

| Item | Prioridad | Descripción |
|------|-----------|-------------|
| `tsconfig.json strict: true` | 🔴 Alta | Actualmente `false`. Hay muchos `any` implícitos en el source TS. Activar gradualmente |
| LSP `server.ts` monolito | 🟡 Media | 1713 líneas en un solo archivo. Refactorizar en: `diagnostics.ts`, `completions.ts`, `hover.ts`, `definitions.ts`, `semantic-tokens.ts`, `formatting.ts`, `rename.ts`, `references.ts` |
| TS parser es monolito | 🟡 Media | `parser.ts` tiene 1699 líneas. El `.no` ya está split en 5 archivos. Aplicar misma refactorización al TS |
| Type checker duplica lógica del parser | 🟡 Media | El type checker y el LSP ambos caminan el AST con su propio scope tracking. Compartir una base de scope/symbol resolution |
| IR no se usa en pipeline principal | 🟡 Media | `compileWithIR()` es opt-in. Debería poder activarse con `--optimize` flag y eventualmente ser el pipeline default |
| Error handling inconsistente | 🟡 Media | Algunas funciones throw, otras retornan null, otras usan diagnostics array. Estandarizar en `Result<T, Error>` pattern |
| Tests sin organización | 🟢 Baja | Todos los tests están en `tests/` flat. Organizar en `tests/unit/`, `tests/integration/`, `tests/benchmark/` |
| JSDoc faltante | 🟢 Baja | Funciones core del compilador sin documentación |
| Remove `tmp-*.js` files | 🟢 Baja | Hay archivos temporales de debugging en root: `tmp-debug-bang.js`, `tmp-quick-fixpoint.js`. Limpiar |
| `.nodeon-cache/` en gitignore | 🟢 Baja | Verificar que la cache de compilación no se commitea |

---

## 15. Roadmap Estratégico: Milestones

### v0.2 — "Usable" (1-3 meses)

**Objetivo:** Que un desarrollador pueda escribir un proyecto real en Nodeon.

- [ ] Standard library Tier 1 (`@nodeon/core`, `@nodeon/fs`, `@nodeon/path`, `@nodeon/test`)
- [ ] `nodeon test` — test runner nativo
- [ ] npm interop (`import` desde `node_modules`)
- [ ] Module runtime para `nodeon run` (multi-file)
- [ ] Publicar en npm (`npm install -g nodeon`)
- [ ] Publicar VS Code extension en Marketplace
- [ ] Getting Started Guide + Language Reference básica
- [ ] Code coverage en CI (target >80%)
- [ ] LSP: inlay hints + signature help
- [ ] Fix BUG-003 (error nodes en AST parcial)

### v0.3 — "Reliable" (3-6 meses)

**Objetivo:** Type system útil + tooling completo.

- [ ] Control flow narrowing + exhaustiveness checking
- [ ] Cross-file type resolution
- [ ] Null safety (`T?` + `strictNullChecks`)
- [ ] `nodeon lint` con reglas básicas
- [ ] `nodeon bundle` (tree shaking básico)
- [ ] Incremental compilation
- [ ] REPL: historial + tab completion
- [ ] Decorators execution
- [ ] Formatter tests + LSP tests
- [ ] CI: cross-platform (Windows, macOS, Linux)
- [ ] CHANGELOG.md + semantic versioning + release automation
- [ ] CONTRIBUTING.md
- [ ] Nova: CSS extraction + component composition

### v0.4 — "Productive" (6-12 meses)

**Objetivo:** DX comparable a lenguajes establecidos.

- [ ] Standard library Tier 2 (http, collections, string, fmt, math, json)
- [ ] Class member types + recursive types + discriminated unions
- [ ] Pipe operator + comprehensions
- [ ] LSP: auto-imports, workspace symbols, cross-file rename/references
- [ ] Debug Adapter (DAP) para VS Code
- [ ] `nodeon doc` generador de documentación
- [ ] IR: loops, classes, try/catch + inlining + copy propagation
- [ ] WASM: strings + arrays + control flow
- [ ] Performance benchmarks en CI
- [ ] Nova: layout nesting, data loading (SSR), API middleware
- [ ] "Nodeon by Example" tutorial completo
- [ ] Migration Guide from TypeScript

### v0.5 — "Ecosystem" (12-18 meses)

**Objetivo:** Comunidad activa + paquetes reales.

- [ ] Standard library Tier 3 (async, crypto, env, log, cli, date)
- [ ] `.d.no` type definitions para npm packages
- [ ] Node.js builtins types
- [ ] Mapped types + conditional types
- [ ] Macros (compile-time AST manipulation)
- [ ] `with` statement (resource management)
- [ ] WASI target para WASM
- [ ] Standalone binaries (Node SEA)
- [ ] Website con playground interactivo
- [ ] Discord server + RFC process
- [ ] 3+ proyectos open-source reales en Nodeon
- [ ] Conference talks / blog posts

### v1.0 — "Production Ready" (18-24 meses)

**Objetivo:** Lenguaje listo para producción.

- [ ] Language specification formal (BNF/EBNF)
- [ ] Full type system (comparable a TypeScript strict mode)
- [ ] IR como pipeline principal con optimizaciones avanzadas
- [ ] WASM backend production-ready
- [ ] 95%+ code coverage
- [ ] Security audit
- [ ] Governance model (core team, release schedule)
- [ ] 50+ community packages
- [ ] Benchmark: compilation speed más rápido que tsc
- [ ] Nova framework v1.0 con SSR completo + edge deployment

---

### Métricas de Éxito

| Métrica | v0.2 | v0.5 | v1.0 |
|---------|------|------|------|
| Tests | 700+ | 1000+ | 1500+ |
| Code coverage | 80% | 90% | 95% |
| GitHub Stars | 100 | 1,000 | 5,000 |
| npm weekly downloads | 50 | 1,000 | 10,000 |
| VS Code installs | 100 | 1,000 | 5,000 |
| Community packages | 0 | 10 | 50 |
| Compiler speed (files/sec) | 100 | 500 | 1,000 |
| Bundle size (compiler) | 150kb | 200kb | 250kb |

---

## Resumen Ejecutivo

Nodeon tiene una **base extraordinariamente sólida**: compilador self-hosting con fixpoint, 636 tests, 32 módulos .no, Nova framework funcional, innovaciones únicas (ADTs, pattern matching, comptime, go concurrency, WASM backend, IR layer).

**Los 5 gaps más críticos que impiden uso en producción son:**

1. **Standard Library** — cero stdlib; sin ella Nodeon es solo sintaxis sobre JavaScript
2. **npm interop** — no puede importar de `node_modules` en runtime
3. **Type system depth** — sin control flow narrowing, null safety, cross-file types
4. **Documentación** — sin language reference, sin tutorial, sin getting started
5. **Distribución** — no publicado en npm ni VS Code Marketplace

**Lo que ya está resuelto y es impresionante:**
- ✅ Self-hosting con fixpoint verificado (32 módulos, 141.2kb bundle)
- ✅ 636 tests con 11 suites
- ✅ Nova framework completo (12 módulos en .no, 87 tests)
- ✅ Structured error messages con códigos (E0100+)
- ✅ IR layer + WASM backend + comptime
- ✅ LSP + VS Code extension funcionales
- ✅ Innovaciones: ADTs, pattern matching v2, named args, if-expressions, array slicing, go concurrency

El camino de "proyecto interesante" a "lenguaje profesional" es sobre **fiabilidad, documentación y ecosistema**. El camino de "lenguaje profesional" a "nuevo estándar" es sobre **comunidad, valor único y probar que funciona en proyectos reales**.

Nodeon está bien posicionado para ambos.
