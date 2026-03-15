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
- **489 passing tests** across lexer, parser, e2e, bootstrap (compile + self-compile + fixpoint), type-checker, regression, and snapshot suites
- **Nova framework prototype** (`packages/nova/`) — file-based routing, static renderer, dev server, island hydration architecture
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
| Tests | ✅ Good | 504 tests (lexer 35, parser 84, e2e 175, bootstrap 98, type-checker 81, regression 26, snapshot 5) |
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
| `e2e.test.ts` | 175 | Full compile pipeline, output verification |
| `bootstrap.test.ts` | 98 | Self-hosting: 32 compile + 33 self-compile + 32 fixpoint + 1 lexer functional |
| `type-checker.test.ts` | 81 | Type inference, assignability, narrowing, generics, interface conformance |
| `regression.test.ts` | 26 | Tests for fixed bugs |
| `snapshot.test.ts` | 5 | Output snapshot verification |
| **Total** | **504** | |

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

## 14. Roadmap: Path to Professional Language

> **Status as of March 2026:** Self-hosting achieved with verified fixpoint (489 tests, 32 modules). BUG-001/002/009/010/011 fixed, error messages implemented, self-hosted compiler is now primary CLI with CLI bundle, CI updated with build+fixpoint+dual CLI verification, `\x` hex escapes added, Nova framework prototype built (file-based router, static renderer, dev server, island hydration).
> Items marked ✅ are complete. Items marked 🔧 have workarounds but need proper fixes.

### Phase 1: Compiler Robustness (Priority: 🔴 Critical)

**Goal:** Fix silent parser failures and make the compiler reliable enough that it never silently produces broken output.

- [x] ~~**BUG-009: Keywords as variables**~~ ✅ Added contextual keywords + `isIdentifierLike()` helper
- [x] ~~**BUG-010: `!fn()` in loops**~~ ✅ Extracted `parsePostfix()`, fixed unary→postfix chain
- [x] ~~**BUG-011: `import { X as Y }`**~~ ✅ Handle `as` as keyword in import specifiers
- [x] ~~**BUG-001: let TDZ in switch/match**~~ ✅ Each switch case wrapped in `{ }` block for scope isolation
- [x] ~~**BUG-002: Range `..` in expressions**~~ ✅ Generator errors on `..` outside `for` loops (both TS and .no)
- [x] ~~**Error recovery**~~ ✅ Brace-depth tracking in `recover()`, parser errors surfaced in `compile()` diagnostics
- [x] ~~**Error messages**~~ ✅ `NodeonError` with codes (E0100+), source line context + caret, help suggestions. Parser wired to use structured errors.
- [x] ~~**Fixpoint test in CI**~~ ✅ 32 fixpoint tests in `bootstrap.test.ts` verify TS output === self-hosted output
- [x] ~~Fix `&&`/`||` precedence~~ ✅ (BUG-012)
- [x] ~~Add `consumePropertyName` for keyword property access~~ ✅ (BUG-007)
- [x] ~~`nodeon fmt` command~~ ✅
- [x] ~~`nodeon check` command~~ ✅

### Phase 2: Type System (Priority: 🟡 High)

**Goal:** Make the type system useful enough that developers *want* to use types.

- [ ] **Generic type checking** — Verify type parameters (`fn identity<T>(x: T): T` checks return matches)
- [ ] **Interface conformance** — Check class implementations match interface declarations
- [ ] **Control flow narrowing** — After `if typeof x == "string"`, narrow `x` to `string` in both branches
- [ ] **Exhaustiveness checking** — `match`/`switch` must cover all cases of a union type
- [ ] **Cross-file type resolution** — Import types from other `.no` files (currently all imports are `any`)
- [ ] **Null safety** — `T?` syntax, compile-time null checks, strictNullChecks mode
- [ ] **Class member types** — Type checking for fields, methods, inheritance
- [ ] **Recursive types** — Support types referencing themselves
- [ ] **Discriminated unions** — `type Result = { ok: true, value: T } | { ok: false, error: E }`
- [ ] **LSP inlay hints** — Show inferred types inline (like Rust/TS)

### Phase 3: Ecosystem & Standard Library (Priority: 🟡 Medium)

**Goal:** Make Nodeon usable for real projects with packages and a stdlib.

- [ ] **Standard library** — `@nodeon/core` (assert, panic, type utils), `@nodeon/fs`, `@nodeon/path`, `@nodeon/http`, `@nodeon/test`, `@nodeon/collections`, `@nodeon/fmt`
- [ ] **npm interop** — `nodeon install` wrapping npm, resolve `node_modules`
- [ ] **Built-in test runner** — `nodeon test` with assertions, describe/it, coverage
- [ ] **REPL improvements** — History persistence, tab completion, multi-line, imports
- [ ] **Linter** — `nodeon lint` with configurable rules (unused vars, unreachable code, naming)
- [ ] **Documentation generator** — `nodeon doc` from `/** */` comments
- [ ] **Language reference** — Formal grammar (BNF/EBNF), complete syntax reference
- [ ] **"Nodeon by Example"** — Tutorial series (like Go by Example)

### Phase 4: Tooling & DX (Priority: 🟢 Normal)

**Goal:** Developer experience rivaling established languages.

- [ ] **LSP: signature help** — Show parameter info while typing function calls
- [ ] **LSP: auto-imports** — Suggest imports for undefined identifiers
- [ ] **LSP: workspace symbols** — Cross-file symbol search
- [ ] **LSP: cross-file rename/references** — Currently document-scoped only
- [ ] **Debug adapter (DAP)** — Step debugging `.no` files in VS Code via source maps
- [ ] **Performance benchmarks** — Track compilation speed, add `compile-speed.bench.ts`
- [ ] **Incremental compilation** — Track file dependencies, only recompile changed files
- [ ] **Parallel compilation** — `worker_threads` for multi-file builds
- [ ] **Watch mode improvements** — Watch all dependencies, `.nodeonignore`, hot reload
- [ ] **Publish VS Code extension** — VS Code Marketplace
- [x] ~~**CI hardening**~~ ✅ Build + fixpoint verification + self-hosted CLI verify + TS CLI fallback

### Phase 4b: Nova Framework (Priority: 🟡 High)

**Goal:** Full-stack web framework combining Angular's structure with Astro's island architecture.

- [x] ~~**File-based router**~~ ✅ Scan `pages/`, dynamic `[param]` routes, API routes, sorted matching
- [x] ~~**Static renderer**~~ ✅ Class-based pages with `template()`, `load()`, `style()` methods
- [x] ~~**Dev server**~~ ✅ HTTP server with routing, live reload injection, error/404 pages
- [x] ~~**Static site builder**~~ ✅ `nova build` renders pages to `dist/`
- [x] ~~**Island architecture**~~ ✅ `island()` decorator, `<nova-island>` hydration markers, 5 strategies (load/visible/idle/media/none)
- [x] ~~**CLI**~~ ✅ `nova dev`, `nova build`, `nova init`
- [x] ~~**Compiler bridge**~~ ✅ Compile `.no` pages on-the-fly, ESM→CJS transform
- [ ] **Template engine** — Parse HTML-like syntax inside `template()` methods
- [ ] **Signals + reactivity** — `@signal` decorator, fine-grained DOM updates
- [ ] **Dependency injection** — `@service`, `@inject` decorators, DI container
- [ ] **CSS extraction** — Scoped styles from `style()` methods
- [ ] **Island client bundles** — Generate per-island JS bundles with esbuild

### Phase 5: Language Innovation (Priority: 🟢 Aspirational)

**Goal:** Features that differentiate Nodeon from everything else.

- [ ] **If-expressions** — `result = if x > 0 { "positive" } else { "negative" }`
- [ ] **Array slicing** — `arr[1..3]` → `arr.slice(1, 3)`
- [ ] **Named arguments** — `greet(name: "World", loud: true)`
- [ ] **Algebraic data types** — Sum types + discriminated unions with exhaustive `match`
- [ ] **Concurrency primitives** — Goroutine-style or actor model (compiles to workers/async)
- [ ] **Pattern matching v2** — Destructuring patterns, nested matching, guards with bindings
- [ ] **Compile-time evaluation / macros** — Code generation at compile time
- [ ] **WebAssembly backend** — Compile `.no` to WASM
- [ ] **Standalone binaries** — Bundle to single executable (via Node SEA or similar)
- [ ] **IR layer** — Intermediate representation for optimization passes and multi-backend support

---

## 15. Roadmap: Path to New Standard

Becoming a "new standard" is ambitious but achievable if Nodeon finds a niche and expands from there. Here's a realistic strategy:

### Stage 1: Find the Niche (6-12 months)

**Target:** Backend Node.js developers frustrated with TypeScript's complexity.

- Nodeon should be **the simplest way to write typed Node.js code**
- Focus on: clean syntax, fast compilation, great error messages, zero-config
- Ship: stable compiler, VS Code extension on marketplace, npm interop, basic stdlib
- Marketing: "TypeScript's syntax is too complex. Python's ecosystem is different. Nodeon is the middle ground."

### Stage 2: Prove It Works (12-18 months)

**Target:** Ship at least 3 real-world open-source projects built with Nodeon.

- Build a web framework in Nodeon (Express-like)
- Build a CLI tool in Nodeon
- Build a REST API in Nodeon
- Benchmark compilation speed vs TypeScript
- Document migration guide from TypeScript

### Stage 3: Build Community (18-24 months)

**Target:** 1,000+ GitHub stars, 100+ Discord members, 10+ community packages.

- Conference talks / blog posts / YouTube tutorials
- "Nodeon Challenge" — build X in Nodeon, share your experience
- Sponsor development of key ecosystem packages
- Accept RFCs from community for language evolution

### Stage 4: Standardize (24-36 months)

**Target:** Language specification, governance model, multiple implementations.

- Write formal language specification
- Establish governance (core team, RFC process, release schedule)
- Explore alternative implementations (Go-based compiler, Rust-based compiler)
- Apply for inclusion in language benchmarks and surveys

### Key Success Metrics

| Metric | Target (12mo) | Target (24mo) |
|--------|---------------|---------------|
| GitHub Stars | 500 | 5,000 |
| npm weekly downloads | 100 | 10,000 |
| VS Code extension installs | 200 | 5,000 |
| Community packages | 5 | 50 |
| Test coverage | 80% | 95% |
| Compiler speed (files/sec) | 100 | 1,000 |

---

## Summary

Nodeon has a **remarkably strong foundation** for its stage. The self-hosting achievement proves the language is expressive enough to build real software. The compiler is clean, well-structured, and already feature-rich.

**The three highest-impact next steps are:**

1. ~~**Error messages**~~ ✅ Done — Structured errors with codes (E0100+), source context, caret, help suggestions.
2. **Standard library** — Without a stdlib, Nodeon is a syntax skin over JavaScript. With one, it becomes a language.
3. **Type system depth** — Type annotations now enforce correctness with generics, interface conformance (`implements`), and type param substitution. Next: control flow analysis, exhaustiveness checking.

**Additionally:** The Nova web framework prototype is functional (file-based routing, static rendering, dev server, island hydration). Next framework steps: template engine, signals/reactivity, dependency injection.

The path from "interesting project" to "professional language" is about **reliability, documentation, and ecosystem**. The path from "professional language" to "new standard" is about **community, unique value, and proving it works on real projects**.

Nodeon is well-positioned for both.
