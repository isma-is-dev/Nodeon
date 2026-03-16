# Nodeon Platform — Full-Stack Architecture Design

**Version:** 0.1  
**Date:** March 2026  
**Status:** RFC (Request for Comments)

---

## Table of Contents

1. [Platform Vision](#1-platform-vision)
2. [Pre-Design Analysis](#2-pre-design-analysis)
3. [Complete Architecture](#3-complete-architecture)
4. [The Language — Web-Native Extensions](#4-the-language--web-native-extensions)
5. [The Compiler — Multi-Target Pipeline](#5-the-compiler--multi-target-pipeline)
6. [The Runtime](#6-the-runtime)
7. [The Framework — Nova](#7-the-framework--nova)
8. [The CLI — `nodeon`](#8-the-cli--nodeon)
9. [Generators — Code Scaffolding](#9-generators--code-scaffolding)
10. [Database Layer](#10-database-layer)
11. [Infrastructure](#11-infrastructure)
12. [Developer Experience](#12-developer-experience)
13. [Build & Deploy](#13-build--deploy)
14. [Monorepo Structure](#14-monorepo-structure)
15. [Roadmap by Phases](#15-roadmap-by-phases)
16. [Technical Risks](#16-technical-risks)
17. [Critical Decisions](#17-critical-decisions)

---

## 1. Platform Vision

### What Nodeon Platform Is

A **vertically integrated development platform** where one language — Nodeon — is the single tool for building full-stack web applications. No JavaScript. No TypeScript. No configuration patchwork. One language, one CLI, one architecture.

```
+-------------------------------------------------------------+
|                   NODEON PLATFORM                            |
|                                                             |
|   Language --> Compiler --> Runtime --> Framework --> CLI     |
|      |            |           |          |          |       |
|   .no files    JS/WASM     Node.js     Nova      nodeon    |
|                            Browser                          |
|                            Edge                             |
|                                                             |
|   Everything written in Nodeon. Everything coherent.        |
+-------------------------------------------------------------+
```

### Comparable Platforms

| Platform | Language | Framework | CLI | Coherence |
|----------|----------|-----------|-----|-----------|
| Ruby + Rails | Ruby | Rails | rails | Very high |
| Elixir + Phoenix | Elixir | Phoenix | mix | Very high |
| Go + stdlib | Go | net/http | go | High |
| TS + Next.js | TypeScript | Next.js | npx/next | Medium (fragmented) |
| **Nodeon + Nova** | **Nodeon** | **Nova** | **nodeon** | **Very high** |

### The Core Problem We Solve

The JavaScript ecosystem suffers from **fragmentation fatigue**:

- 5+ build tools (Webpack, Vite, esbuild, Rollup, Turbopack)
- 3+ type systems (TypeScript, Flow, JSDoc)
- 10+ frameworks (React, Vue, Angular, Svelte, Solid, Qwik, Astro, Next, Nuxt, Remix)
- 4+ test runners (Jest, Vitest, Mocha, Playwright)
- 3+ package managers (npm, yarn, pnpm)

**Nodeon Platform provides one answer per concern:**

| Concern | JS Ecosystem | Nodeon Platform |
|---------|-------------|-----------------|
| Language | JS/TS/JSX/TSX | `.no` |
| Types | TypeScript (separate toolchain) | Built into the language |
| Build | Vite/Webpack/esbuild config | `nodeon build` (zero config) |
| Test | Jest/Vitest setup | `nodeon test` (built-in) |
| Lint | ESLint + config | `nodeon lint` (built-in) |
| Format | Prettier + config | `nodeon fmt` (built-in) |
| Frontend | React/Vue/Svelte | Nova components |
| Backend | Express/Fastify/Hono | Nova API routes |
| DB | Prisma/Drizzle/TypeORM | Nova DB (built-in ORM) |
| Deploy | Platform-specific config | `nodeon deploy` |

---

## 2. Pre-Design Analysis

### 2.1 What Problem Does the Language Solve?

**Primary:** Reduce cognitive overhead and configuration complexity of building web applications on the JavaScript runtime.

**Secondary:** Provide a language simpler than TypeScript but retaining its power — "Python's readability meets TypeScript's safety on Node.js."

### 2.2 What Parts of JS Ecosystem Do We Simplify?

1. **Configuration elimination** — No tsconfig, eslintrc, vite.config, jest.config. One `nodeon.json`.
2. **Toolchain unification** — Compiler, bundler, formatter, linter, test runner, REPL in one binary.
3. **Full-stack type sharing** — Frontend and backend share types via `packages/shared/` with zero config.
4. **Build simplicity** — `nodeon build` handles everything. No plugin ecosystem needed.

### 2.3 What Must Be Language-Level vs. Framework-Level?

**Language-level (compiler handles it):**

| Feature | Rationale |
|---------|-----------|
| `fn`, `class`, `match`, `for..in` | Core syntax |
| Type annotations + erasure | Must be part of compilation |
| `import`/`export` | Module system |
| `async`/`await` | Concurrency primitive |
| `go` statement | Lightweight concurrency |
| `comptime` | Compile-time evaluation |
| ADTs (`type Shape = Circle(r) \| Rect(w, h)`) | Core data modeling |
| Pattern matching (`match` + destructure) | Core control flow |
| Decorators (`@service`, `@island`) | Metaprogramming — compiled away |
| String interpolation `"Hello {name}"` | Core syntax |
| Named arguments `fn(name: "x")` | Core syntax |

**Framework-level (Nova provides it):**

| Feature | Rationale |
|---------|-----------|
| Routing (file-based + decorator) | Convention over configuration |
| Template engine | UI rendering |
| Signals/reactivity | State management strategy |
| DI container | Architecture pattern |
| ORM / database | External dependency |
| Auth, validation, middleware | Application-level concerns |
| Island hydration | Rendering strategy |
| SSR/SSG | Deployment strategy |

**Why this split?** The language must never depend on the framework. You can write a CLI tool, a library, or a game in Nodeon without Nova. But Nova deeply leverages language features (decorators, ADTs, match, signals) to feel native.

### 2.4 How to Avoid Excessive Complexity?

1. **Convention over configuration** — Strong defaults, escape hatches only when needed
2. **Single config file** — `nodeon.json` for everything
3. **No plugin system initially** — Batteries included, add plugins later
4. **Layered architecture** — Language > Standard Library > Framework > Application. Each layer optional.
5. **Progressive disclosure** — Simple things are simple. Complex things are possible.

### 2.5 How to Version the Framework?

- **Language + compiler:** Semantic versioning. Breaking changes only in major versions.
- **Framework (Nova):** Separate versioning from the language. Nova 1.x works with Nodeon 0.3+.
- **Standard library:** Versioned with the compiler. `@nodeon/core` 0.2 ships with `nodeon` 0.2.
- **Codemods:** Every major version ships with `nodeon migrate` that auto-transforms code.

### 2.6 How to Avoid Lock-in?

1. **Compiles to standard JavaScript** — Output is readable JS that works without Nodeon
2. **npm interop** — Import any npm package. Publish Nodeon packages to npm.
3. **No proprietary runtime** — Runs on Node.js, Deno, Bun, browsers
4. **Eject capability** — `nodeon eject` outputs the generated JS project structure
5. **Standard protocols** — LSP for editors, DAP for debugging, OpenTelemetry for observability

---

## 3. Complete Architecture

```
+--------------------------------------------------------------+
|                    APPLICATION LAYER                          |
|                                                              |
|  pages/  components/  islands/  services/  models/  tests/   |
|                    (all .no files)                            |
+-------------------------------+------------------------------+
                                |
+-------------------------------v------------------------------+
|                    FRAMEWORK LAYER (Nova)                     |
|                                                              |
|  Router | Templates | Signals | DI | ORM | Auth | Middleware |
|  SSR    | Islands   | Forms   | Validation | Jobs | Queues   |
+-------------------------------+------------------------------+
                                |
+-------------------------------v------------------------------+
|                    STANDARD LIBRARY                           |
|                                                              |
|  @nodeon/core | @nodeon/fs | @nodeon/http | @nodeon/test     |
|  @nodeon/db   | @nodeon/crypto | @nodeon/log | @nodeon/env   |
+-------------------------------+------------------------------+
                                |
+-------------------------------v------------------------------+
|                    COMPILER + TOOLCHAIN                       |
|                                                              |
|  Lexer > Parser > TypeChecker > IR > Generator > Bundler     |
|  Formatter | Linter | Test Runner | REPL | LSP | DAP        |
+-------------------------------+------------------------------+
                                |
+-------------------------------v------------------------------+
|                    RUNTIME TARGETS                            |
|                                                              |
|  Node.js (server)  |  Browser (client)  |  Edge (workers)    |
|  WASM (portable)   |  Standalone (SEA)                       |
+--------------------------------------------------------------+
```

---

## 4. The Language — Web-Native Extensions

### 4.1 Design Principle: Decorators as the Bridge

**Rule:** If it changes compilation semantics -> **decorator**.
If it is purely runtime behavior -> **framework API**.

Decorators are already parsed by Nodeon. The framework's compiler plugin reads them from the AST and generates additional code.

```
// Language-level: always available
fn greet(name: string) = "Hello {name}"

type Result = Ok(value: any) | Err(error: string)

match result {
  case Ok(v) { print(v) }
  case Err(e) { print("Error: {e}") }
}

// Framework-level: decorators compiled by Nova
@page("/dashboard")
export class Dashboard {
  @inject db: Database

  async fn load() {
    return { users: await this.db.user.findMany() }
  }

  template(data) {
    <h1>Dashboard</h1>
    <UserTable users={data.users} />
  }
}
```

### 4.2 Validation via ADTs + Decorators

```
@validate
type CreateUser = {
  name: string @minLength(1) @maxLength(100)
  email: string @email
  age: number @min(0) @max(150)
}
```

The compiler generates a `validateCreateUser(data)` function automatically.

### 4.3 Database Entities

```
@entity("users")
export class User {
  @id @auto id: number
  @column name: string
  @column email: string @unique
  @column @nullable bio: string
  @hasMany posts: Post[]
  @timestamps createdAt: Date
  @timestamps updatedAt: Date
}
```

Compiles to: migration SQL + type definition + query builder methods.

### 4.4 API Endpoints

```
@api("/users")
export class UserAPI {
  @inject db: Database

  @get("/")
  async fn list() {
    return await this.db.user.findMany()
  }

  @post("/")
  async fn create(@body data: CreateUser) {
    return await this.db.user.create(data)
  }

  @get("/:id")
  async fn getById(@param id: number) {
    return await this.db.user.findOne(id)
  }

  @put("/:id")
  async fn update(@param id: number, @body data: UpdateUser) {
    return await this.db.user.update(id, data)
  }

  @delete("/:id")
  async fn remove(@param id: number) {
    return await this.db.user.delete(id)
  }
}
```

### 4.5 What the Language Does NOT Add

We explicitly avoid:

- **HTML/JSX in the core parser** — Templates live in `template()` methods, parsed by Nova
- **SQL syntax** — Database access is via query builder API
- **CSS syntax** — Styles are strings in `style()` methods
- **Routing DSL** — Routes are decorators + file conventions

**Rationale:** Core compiler stays lean. Framework concerns are post-compilation AST transforms.

---

## 5. The Compiler — Multi-Target Pipeline

### 5.1 Current Pipeline (working)

```
.no source -> Lexer -> Parser -> AST -> TypeChecker -> JS Generator -> .js
                                    |-> IR -> IR Optimizations -> IR Emit -> .js
                                    |-> WASM Generator -> .wasm
```

### 5.2 Extended Pipeline for the Platform

```
.no source
     |
     v
   Lexer (tokens)
     |
     v
   Parser (AST)
     |
     +---> Type Checker (diagnostics, type info)
     |
     +---> Decorator Resolver (reads @page, @api, @entity, etc.)
     |         |
     |         +-- Template Parser (HTML-like in template() methods)
     |         +-- Validation Generator (from @validate types)
     |         +-- Entity Generator (from @entity classes)
     |         +-- Route Collector (from @route, @api, file conventions)
     |
     +---> IR Layer (optimizations: fold, DCE, inline, copy-prop)
     |
     v
   Code Generator
     |
     +---> JS (ESM or CJS, configurable)
     +---> JS + Source Maps
     +---> WASM (numeric, experimental)
     +---> Declaration files (.d.no for library authors)
     |
     v
   Bundler (esbuild-powered)
     |
     +---> Server bundle (Node.js)
     +---> Client bundles (per-island, tree-shaken)
     +---> Static HTML (pre-rendered pages)
```

### 5.3 Compilation Modes

| Mode | Command | Output | Use Case |
|------|---------|--------|----------|
| **single** | `nodeon build file.no` | `file.js` | Scripts, libraries |
| **project** | `nodeon build` | `dist/` | Applications (reads `nodeon.json`) |
| **watch** | `nodeon build -w` | Incremental `dist/` | Development |
| **bundle** | `nodeon bundle` | Single `.js` | Distribution |
| **check** | `nodeon check` | Diagnostics only | CI, pre-commit |

### 5.4 Compilation Speed Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| Single file | <5ms | Already achieved |
| 100-file project | <500ms | Incremental + parallel (worker_threads) |
| 1000-file project | <3s | Incremental + cache + parallel |
| Watch rebuild | <50ms | Only recompile changed + dependents |

### 5.5 Bundling Strategy

**No new bundler.** Use esbuild (already a dev dependency) as the bundling engine:

1. Nodeon compiler transforms `.no` -> `.js` into a temp directory
2. esbuild bundles the `.js` files with tree shaking, code splitting, minification
3. Nova's build step adds: island extraction, CSS extraction, HTML pre-rendering

This avoids building a bundler from scratch while maintaining full control of the compilation step.

### 5.6 Decorator Compilation Model

Decorators are **compile-time only**. They never appear in output JS. The compiler:

1. Reads decorators from the AST
2. Passes them to registered **compiler plugins**
3. Each plugin can inject code, generate files, or modify the AST
4. The final JS output contains no decorator runtime

```
// Input (.no)
@api("/users")
export class UserAPI {
  @get("/")
  async fn list() { ... }
}

// Output (.js) — no decorator runtime, just plain code
export class UserAPI {
  async list() { ... }
}
// Generated by Nova compiler plugin:
export const __nova_routes = [
  { method: "GET", path: "/users/", handler: "UserAPI.list" }
]
```

### 5.7 Compiler Plugin Architecture

The compiler exposes hooks that Nova (and future plugins) can use:

```
// Compiler plugin interface
interface CompilerPlugin {
  name: string
  // Called after parsing, before code generation
  transformAST(ast: Program, file: string): Program
  // Called after code generation, can emit additional files
  afterEmit(files: Map<string, string>): Map<string, string>
  // Called once after all files are processed
  finalize(context: BuildContext): void
}
```

Nova registers itself as a compiler plugin that:
- Extracts route metadata from `@page`, `@api`, `@route` decorators
- Compiles `template()` methods into render functions
- Generates the route manifest
- Extracts CSS from `style()` methods
- Builds island client bundles

---

## 6. The Runtime

### 6.1 Runtime Targets

Nodeon compiles to JavaScript, so it runs anywhere JS runs. But the platform optimizes for three targets:

#### 6.1.1 Node.js (Primary — Server)

| Aspect | Details |
|--------|---------|
| **Version** | Node.js 20+ (LTS) |
| **Module format** | ESM (default), CJS (opt-in for compatibility) |
| **Use cases** | API servers, SSR, CLI tools, scripts, jobs |
| **Advantages** | Mature ecosystem, npm access, excellent I/O |
| **Limitations** | Cold start for serverless, memory per-process |

**This is the default runtime.** `nodeon run` and `nodeon dev` use Node.js.

#### 6.1.2 Browser (Client)

| Aspect | Details |
|--------|---------|
| **Target** | ES2022+ (modern browsers) |
| **Module format** | ESM via `<script type="module">` |
| **Use cases** | Island hydration, client-side interactivity |
| **Advantages** | Zero-JS default (Nova), only islands ship JS |
| **Limitations** | No Node.js APIs (fs, path, etc.) |

Nova's island architecture ensures **minimal JS reaches the browser**. Only `@island` components are bundled for the client.

#### 6.1.3 Edge (Workers)

| Aspect | Details |
|--------|---------|
| **Platforms** | Cloudflare Workers, Vercel Edge, Deno Deploy |
| **Module format** | ESM |
| **Use cases** | SSR at the edge, API routes, middleware |
| **Advantages** | Low latency, global distribution |
| **Limitations** | No Node.js builtins (fs, child_process), limited memory |

**Edge support is opt-in:** `nodeon build --target edge` strips Node.js-specific imports and uses Web Standard APIs (fetch, Request, Response, crypto.subtle).

### 6.2 Runtime Library

The compiled JS needs a minimal runtime for Nodeon-specific features:

```
// nodeon-runtime.js (~2kb, tree-shakeable)

// ADT tag checking
export fn __tag(obj, tag) = obj && obj.tag === tag

// Pattern match helpers
export fn __matchVariant(obj, tag, fields) { ... }

// Go statement (already compiles to queueMicrotask)
// No runtime needed

// Range iterator
export class Range {
  constructor(start, end) { ... }
  [Symbol.iterator]() { ... }
  map(fn) { ... }
  filter(fn) { ... }
  toArray() { ... }
}

// Signal runtime (for islands in browser)
export fn signal(value) { ... }
export fn computed(fn) { ... }
export fn effect(fn) { ... }
```

**Design principle:** The runtime is <5kb minified. Most features compile away entirely. The runtime only exists for features that need shared helper functions.

### 6.3 Module Resolution

```
// Resolution order for: import { X } from "module"

1. Relative path:  ./module.no  -> compile and import
2. Package path:   packages/module/src/index.no  -> workspace package
3. @nodeon/ path:  @nodeon/core  -> standard library
4. npm path:       node_modules/module  -> npm package (JS interop)
5. Node built-in:  "fs", "path"  -> passthrough
```

**Key rule:** `.no` imports are compiled on-the-fly. npm imports are used as-is (JS interop).

---

## 7. The Framework — Nova

### 7.1 Philosophy

Nova is NOT a React clone, NOT an Angular clone, NOT an Astro clone. It is a **Nodeon-native framework** that takes the best architectural ideas and implements them idiomatically for Nodeon:

| Inspiration | What We Take | What We Change |
|-------------|-------------|----------------|
| **Angular** | DI, services, decorators, structure | No modules/NgModules, no RxJS, no zone.js |
| **Astro** | Zero-JS default, islands, file routing | Stronger conventions, built-in DI, signals |
| **Rails** | Convention over config, generators, CLI | Compiles to JS instead of interpreted |
| **Phoenix** | LiveView-like SSR, channels | JavaScript runtime instead of BEAM |
| **SvelteKit** | File routing, load functions, SSR | Decorator-based instead of file conventions |

### 7.2 Nova Core Modules

Nova ships as a single package `@nodeon/nova` with these built-in modules:

#### 7.2.1 Router

```
// File-based routing (automatic)
src/pages/
  index.no          ->  /
  about.no          ->  /about
  blog/
    index.no        ->  /blog
    [slug].no       ->  /blog/:slug
  api/
    users.no        ->  /api/users
    users/[id].no   ->  /api/users/:id

// Decorator-based routing (explicit)
@route("/admin/users")
export class AdminUsers {
  @get("/")
  async fn list() { ... }

  @get("/:id")
  async fn show(@param id: number) { ... }
}
```

Both approaches coexist. File-based for pages, decorator-based for API modules.

#### 7.2.2 Components (Server — Zero JS)

```
// components/Card.no
@component
export class Card {
  @input title: string
  @input subtitle: string = ""

  template() {
    <div class="card">
      <h3>{this.title}</h3>
      if this.subtitle != "" {
        <p class="subtitle">{this.subtitle}</p>
      }
      <slot />
    </div>
  }

  style() {
    `.card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; }`
  }
}
```

Server components render to HTML at build/request time. **Zero JavaScript sent to the client.**

#### 7.2.3 Islands (Client — Interactive)

```
// islands/SearchBar.no
@island(idle)
export class SearchBar {
  @signal query: string = ""
  @signal results: SearchResult[] = []
  @inject search: SearchService

  @computed
  fn hasResults() = this.results.length > 0

  async fn onSearch() {
    if this.query.length > 2 {
      this.results = await this.search.find(this.query)
    }
  }

  template() {
    <div class="search">
      <input
        type="text"
        value={this.query}
        @input={fn(e) { this.query = e.target.value }}
        @keyup.debounce(300)={this.onSearch}
      />
      if this.hasResults {
        <ul class="results">
          for result in this.results {
            <li><a href={result.url}>{result.title}</a></li>
          }
        </ul>
      }
    </div>
  }
}
```

Islands hydrate on the client with the specified strategy (load, idle, visible, media, none).

#### 7.2.4 Pages

```
// pages/blog/[slug].no
@page(layout: MainLayout)
export class BlogPost {
  @inject posts: PostService
  @inject auth: AuthService

  async fn load(params) {
    const post = await this.posts.getBySlug(params.slug)
    if !post { throw NotFound("Post not found") }
    return {
      post: post,
      isAuthor: this.auth.currentUser?.id == post.authorId
    }
  }

  fn meta(data) {
    return {
      title: data.post.title,
      description: data.post.excerpt,
      og: { image: data.post.coverImage }
    }
  }

  template(data) {
    <article class="blog-post">
      <h1>{data.post.title}</h1>
      <time>{data.post.publishedAt}</time>
      <div class="content">{data.post.htmlContent}</div>
      if data.isAuthor {
        <EditButton postId={data.post.id} />
      }
    </article>
  }
}
```

#### 7.2.5 Services & Dependency Injection

```
// services/PostService.no
@service
export class PostService {
  @inject db: Database
  @inject cache: CacheService
  @inject log: Logger

  async fn getBySlug(slug: string): Post | null {
    const cached = await this.cache.get("post:{slug}")
    if cached { return cached }

    this.log.debug("Cache miss for post: {slug}")
    const post = await this.db.post.findOne({ where: { slug: slug } })

    if post {
      await this.cache.set("post:{slug}", post, ttl: 300)
    }
    return post
  }

  async fn create(data: CreatePost): Post {
    const post = await this.db.post.create(data)
    await this.cache.invalidate("posts:*")
    this.log.info("Post created: {post.id}")
    return post
  }
}
```

DI container is request-scoped by default. Services are singletons unless annotated `@transient`.

#### 7.2.6 Middleware

```
// middleware/auth.no
@middleware
export class AuthMiddleware {
  @inject auth: AuthService
  @inject log: Logger

  async fn handle(req: Request, next: fn(): Response): Response {
    const token = req.headers.get("Authorization")
    if !token {
      return Response.json({ error: "Unauthorized" }, status: 401)
    }

    const user = await this.auth.verify(token)
    if !user {
      this.log.warn("Invalid token attempt from {req.ip}")
      return Response.json({ error: "Invalid token" }, status: 401)
    }

    req.user = user
    return await next()
  }
}

// Apply to specific routes:
@api("/admin", middleware: [AuthMiddleware])
export class AdminAPI { ... }
```

#### 7.2.7 Signals & Reactivity

Already implemented in `packages/nova/src/signals.no`. Used in islands for fine-grained DOM updates:

```
// Core API (already exists)
const count = signal(0)
const doubled = computed(fn() { count() * 2 })
const stop = effect(fn() { print("Count is: {count()}") })

// In islands, @signal decorator creates signals automatically:
@island
export class Counter {
  @signal count: number = 0       // -> this.count = signal(0)
  @computed fn doubled() = this.count * 2  // -> computed(() => this.count() * 2)
}
```

#### 7.2.8 Forms & Validation

```
// Validation types (shared between frontend and backend)
@validate
type LoginForm = {
  email: string @email @required
  password: string @minLength(8) @required
}

// In an island
@island
export class LoginForm {
  @signal form: LoginForm = { email: "", password: "" }
  @signal errors: ValidationErrors = {}

  async fn submit() {
    const result = validate(this.form)
    match result {
      case Ok(data) {
        await fetch("/api/auth/login", method: "POST", body: data)
      }
      case Err(errors) {
        this.errors = errors
      }
    }
  }

  template() {
    <form @submit.prevent={this.submit}>
      <input type="email" value={this.form.email}
        @input={fn(e) { this.form.email = e.target.value }} />
      if this.errors.email {
        <span class="error">{this.errors.email}</span>
      }
      <input type="password" value={this.form.password}
        @input={fn(e) { this.form.password = e.target.value }} />
      <button type="submit">Login</button>
    </form>
  }
}
```

#### 7.2.9 Authentication

```
// Built-in auth module
// config/auth.no
export const authConfig = {
  providers: [
    EmailPassword(),
    OAuth("github", clientId: env("GITHUB_CLIENT_ID"), clientSecret: env("GITHUB_SECRET")),
    OAuth("google", clientId: env("GOOGLE_CLIENT_ID"), clientSecret: env("GOOGLE_SECRET"))
  ],
  session: {
    strategy: "jwt",
    secret: env("SESSION_SECRET"),
    maxAge: 60 * 60 * 24 * 7  // 7 days
  },
  pages: {
    login: "/auth/login",
    register: "/auth/register",
    callback: "/auth/callback"
  }
}
```

#### 7.2.10 Jobs & Queues

```
@job(schedule: "0 */6 * * *")  // Every 6 hours
export class CleanupExpiredSessions {
  @inject db: Database
  @inject log: Logger

  async fn execute() {
    const deleted = await this.db.session.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    })
    this.log.info("Cleaned {deleted} expired sessions")
  }
}

@job  // Manual dispatch only
export class SendWelcomeEmail {
  @inject mailer: MailService

  async fn execute(payload: { userId: number, email: string }) {
    await this.mailer.send(
      to: payload.email,
      template: "welcome",
      data: { userId: payload.userId }
    )
  }
}

// Dispatch from anywhere:
await dispatch(SendWelcomeEmail, { userId: user.id, email: user.email })
```

### 7.3 Nova Rendering Modes

| Mode | When | Output | JS Shipped |
|------|------|--------|-----------|
| **Static (SSG)** | Build time | HTML files | Only islands |
| **Server (SSR)** | Request time | HTML stream | Only islands |
| **Hybrid** | Mixed | Static for known pages, SSR for dynamic | Only islands |
| **Client (SPA)** | Client-only | Shell HTML + JS bundle | Full app |

**Default is Hybrid.** Pages with no dynamic `load()` are pre-rendered at build time. Pages with `load()` are SSR'd per request.

---

## 8. The CLI — `nodeon`

### 8.1 Design Principle

The CLI is the **single entry point** for everything. Like `rails`, `mix`, or `go` — one command, many subcommands. No external tools needed.

```
nodeon <command> [options]
```

### 8.2 Complete Command Reference

#### Project Lifecycle

| Command | Description | Example |
|---------|-------------|---------|
| `nodeon new <name>` | Create a new project (monorepo) | `nodeon new my-app` |
| `nodeon init` | Initialize Nodeon in existing directory | `nodeon init` |
| `nodeon dev` | Start dev server (frontend + backend + db) | `nodeon dev` |
| `nodeon build` | Production build | `nodeon build` |
| `nodeon start` | Start production server | `nodeon start` |
| `nodeon deploy` | Deploy to configured target | `nodeon deploy` |

#### Code Generation

| Command | Description | Example |
|---------|-------------|---------|
| `nodeon generate entity <name>` | Model + migration + service + API + tests | `nodeon generate entity user` |
| `nodeon generate page <path>` | Page component with load function | `nodeon generate page blog/[slug]` |
| `nodeon generate component <name>` | Server component | `nodeon generate component Header` |
| `nodeon generate island <name>` | Interactive island component | `nodeon generate island SearchBar` |
| `nodeon generate service <name>` | Injectable service | `nodeon generate service Auth` |
| `nodeon generate middleware <name>` | Request middleware | `nodeon generate middleware RateLimit` |
| `nodeon generate migration <name>` | Database migration | `nodeon generate migration add-user-avatar` |
| `nodeon generate job <name>` | Background job | `nodeon generate job CleanupSessions` |
| `nodeon generate module <name>` | Full module (entity + service + API + page + tests) | `nodeon generate module blog` |
| `nodeon generate test <target>` | Test file for existing file | `nodeon generate test services/Auth` |

Shorthand: `nodeon g entity user` (alias `g` for `generate`)

#### Compilation & Tooling

| Command | Description | Example |
|---------|-------------|---------|
| `nodeon build <file>` | Compile single file | `nodeon build src/main.no` |
| `nodeon run <file>` | Compile and execute | `nodeon run script.no` |
| `nodeon check` | Type check entire project | `nodeon check` |
| `nodeon fmt` | Format all .no files | `nodeon fmt` |
| `nodeon fmt <file>` | Format specific file | `nodeon fmt src/main.no` |
| `nodeon lint` | Lint all .no files | `nodeon lint` |
| `nodeon lint --fix` | Auto-fix lint issues | `nodeon lint --fix` |
| `nodeon test` | Run all tests | `nodeon test` |
| `nodeon test --watch` | Run tests in watch mode | `nodeon test --watch` |
| `nodeon test --coverage` | Run with coverage | `nodeon test --coverage` |
| `nodeon repl` | Interactive REPL | `nodeon repl` |
| `nodeon bundle` | Bundle for distribution | `nodeon bundle` |

#### Database

| Command | Description | Example |
|---------|-------------|---------|
| `nodeon db migrate` | Run pending migrations | `nodeon db migrate` |
| `nodeon db rollback` | Rollback last migration | `nodeon db rollback` |
| `nodeon db seed` | Run seed data | `nodeon db seed` |
| `nodeon db reset` | Drop + recreate + migrate + seed | `nodeon db reset` |
| `nodeon db status` | Show migration status | `nodeon db status` |
| `nodeon db studio` | Open database GUI (web) | `nodeon db studio` |

#### Utility

| Command | Description | Example |
|---------|-------------|---------|
| `nodeon version` | Show version | `nodeon version` |
| `nodeon help` | Show help | `nodeon help` |
| `nodeon upgrade` | Self-update | `nodeon upgrade` |
| `nodeon eject` | Export as plain JS project | `nodeon eject` |
| `nodeon migrate` | Run codemods for version upgrade | `nodeon migrate` |
| `nodeon doctor` | Check environment health | `nodeon doctor` |

### 8.3 `nodeon new` — Project Creation Flow

```
$ nodeon new my-app

  Nodeon v0.3.0 — Create New Project

  Project name: my-app
  
  ? What kind of project?
    > Full-stack web app (Nova)
      API only (backend)
      Library (npm package)
      CLI tool
  
  ? Database?
    > PostgreSQL
      SQLite
      None
  
  ? Include authentication?
    > Yes (email + password)
      Yes (OAuth providers)
      No
  
  Creating project...

  +-- my-app/
      +-- apps/
      |   +-- web/          (Nova frontend + SSR)
      |   +-- api/          (API backend)
      +-- packages/
      |   +-- shared/       (shared types + validation)
      |   +-- db/           (database models + migrations)
      |   +-- ui/           (shared components)
      +-- infra/
      |   +-- docker/       (docker-compose + Dockerfiles)
      +-- nodeon.json       (root config)
      +-- .env              (environment variables)
      +-- .env.example
      +-- README.md

  Done! Next steps:
    cd my-app
    nodeon dev
```

### 8.4 `nodeon dev` — Development Flow

`nodeon dev` starts the **entire stack** in one command:

```
$ nodeon dev

  Nodeon Dev Server

  [db]   PostgreSQL ready on localhost:5432
  [api]  API server on http://localhost:3001
  [web]  Web server on http://localhost:3000
  [hmr]  Hot reload active (watching 47 files)
  
  Press 'r' to restart | 'c' to clear | 'q' to quit
```

Under the hood:
1. Starts PostgreSQL via Docker (if configured)
2. Compiles all `.no` files incrementally
3. Starts the API server with auto-restart on changes
4. Starts the web dev server with HMR
5. Watches all `.no` files across the monorepo
6. Shows unified logs from all processes

### 8.5 CLI Implementation

The CLI is written in Nodeon (`.no`), compiled to JS, bundled to a single CJS file. This is already the pattern used for the compiler CLI (`bin/nodeon-self.js`).

New commands are added as modules in `src-no/cli/commands/`:

```
src/cli/
  index.no              # Entry point, command router
  commands/
    new.no              # nodeon new
    dev.no              # nodeon dev
    build.no            # nodeon build
    generate.no         # nodeon generate (dispatches to generators)
    test.no             # nodeon test
    lint.no             # nodeon lint
    db.no               # nodeon db (dispatches to db subcommands)
    deploy.no           # nodeon deploy
    doctor.no           # nodeon doctor
  generators/
    entity.no           # generate entity
    page.no             # generate page
    component.no        # generate component
    island.no           # generate island
    service.no          # generate service
    module.no           # generate module (orchestrates multiple generators)
  utils/
    prompt.no           # Interactive prompts
    template.no         # File template engine
    spinner.no          # Progress indicators
    colors.no           # Terminal colors (already exists)
```

---

## 9. Generators — Code Scaffolding

### 9.1 Design Principle

Generators produce **complete, working code** — not stubs. Every generated file should compile and pass its generated tests immediately.

### 9.2 `nodeon generate entity user`

This is the most powerful generator. It creates everything needed for a data entity:

**Files created:**

```
packages/db/src/models/user.no           # Entity definition
packages/db/src/migrations/001_create_users.no  # Migration
packages/shared/src/types/user.no        # Shared types (CreateUser, UpdateUser)
packages/shared/src/validators/user.no   # Validation rules
apps/api/src/services/user-service.no    # Business logic service
apps/api/src/routes/users.no             # API endpoints (CRUD)
apps/web/src/pages/users/index.no        # List page
apps/web/src/pages/users/[id].no         # Detail page
tests/api/services/user-service.test.no  # Service tests
tests/api/routes/users.test.no           # API route tests
```

**Example generated entity:**

```
// packages/db/src/models/user.no
@entity("users")
export class User {
  @id @auto id: number
  @column name: string
  @column email: string @unique
  @column @nullable avatarUrl: string
  @timestamps createdAt: Date
  @timestamps updatedAt: Date
}
```

**Example generated migration:**

```
// packages/db/src/migrations/001_create_users.no
import { Migration } from "@nodeon/db"

export class CreateUsers extends Migration {
  async fn up(db: Database) {
    await db.createTable("users", fn(t) {
      t.id()
      t.string("name")
      t.string("email").unique()
      t.string("avatar_url").nullable()
      t.timestamps()
    })
    await db.createIndex("users", "email")
  }

  async fn down(db: Database) {
    await db.dropTable("users")
  }
}
```

**Example generated shared types:**

```
// packages/shared/src/types/user.no
export type User = {
  id: number
  name: string
  email: string
  avatarUrl: string | null
  createdAt: Date
  updatedAt: Date
}

@validate
export type CreateUser = {
  name: string @minLength(1) @maxLength(255)
  email: string @email
  avatarUrl: string | null
}

@validate
export type UpdateUser = {
  name: string @minLength(1) @maxLength(255)
  email: string @email
  avatarUrl: string | null
}
```

**Example generated service:**

```
// apps/api/src/services/user-service.no
import { User, CreateUser, UpdateUser } from "@shared/types/user"

@service
export class UserService {
  @inject db: Database
  @inject log: Logger

  async fn findAll(): User[] {
    return await this.db.user.findMany()
  }

  async fn findById(id: number): User | null {
    return await this.db.user.findOne(id)
  }

  async fn create(data: CreateUser): User {
    this.log.info("Creating user: {data.email}")
    return await this.db.user.create(data)
  }

  async fn update(id: number, data: UpdateUser): User {
    return await this.db.user.update(id, data)
  }

  async fn delete(id: number): boolean {
    return await this.db.user.delete(id)
  }
}
```

**Example generated API routes:**

```
// apps/api/src/routes/users.no
import { UserService } from "../services/user-service"
import { CreateUser, UpdateUser } from "@shared/types/user"

@api("/api/users")
export class UsersAPI {
  @inject users: UserService

  @get("/")
  async fn list() {
    return await this.users.findAll()
  }

  @get("/:id")
  async fn show(@param id: number) {
    const user = await this.users.findById(id)
    if !user { throw NotFound("User not found") }
    return user
  }

  @post("/")
  async fn create(@body data: CreateUser) {
    return await this.users.create(data)
  }

  @put("/:id")
  async fn update(@param id: number, @body data: UpdateUser) {
    return await this.users.update(id, data)
  }

  @delete("/:id")
  async fn remove(@param id: number) {
    await this.users.delete(id)
    return { ok: true }
  }
}
```

**Example generated test:**

```
// tests/api/services/user-service.test.no
import { describe, it, expect, beforeEach } from "@nodeon/test"
import { UserService } from "../../apps/api/src/services/user-service"

describe("UserService", fn() {
  let service: UserService

  beforeEach(fn() {
    service = createTestService(UserService)
  })

  describe("findAll", fn() {
    it("returns all users", async fn() {
      const users = await service.findAll()
      expect(users).toBeArray()
    })
  })

  describe("create", fn() {
    it("creates a user with valid data", async fn() {
      const user = await service.create({
        name: "John Doe",
        email: "john@example.com",
        avatarUrl: null
      })
      expect(user.id).toBeDefined()
      expect(user.name).toBe("John Doe")
      expect(user.email).toBe("john@example.com")
    })
  })

  describe("findById", fn() {
    it("returns null for non-existent user", async fn() {
      const user = await service.findById(999)
      expect(user).toBeNull()
    })
  })
})
```

### 9.3 `nodeon generate module blog`

The **module generator** is the highest-level generator. It orchestrates multiple generators to create a complete feature module:

```
$ nodeon generate module blog

  Generating module: blog

  [1/6] Entity: Post
    + packages/db/src/models/post.no
    + packages/db/src/migrations/002_create_posts.no
  [2/6] Shared types
    + packages/shared/src/types/post.no
    + packages/shared/src/validators/post.no
  [3/6] Service
    + apps/api/src/services/post-service.no
  [4/6] API routes
    + apps/api/src/routes/posts.no
  [5/6] Pages
    + apps/web/src/pages/blog/index.no
    + apps/web/src/pages/blog/[slug].no
  [6/6] Tests
    + tests/api/services/post-service.test.no
    + tests/api/routes/posts.test.no
    + tests/web/pages/blog.test.no

  Done! Generated 11 files for module 'blog'.
  Run 'nodeon db migrate' to create the database table.
```

### 9.4 Generator Template System

Generators use Nodeon template files stored in the CLI package:

```
src/cli/generators/templates/
  entity.no.tmpl
  migration.no.tmpl
  service.no.tmpl
  api-route.no.tmpl
  page-list.no.tmpl
  page-detail.no.tmpl
  component.no.tmpl
  island.no.tmpl
  test-service.no.tmpl
  test-route.no.tmpl
```

Templates use simple `{variable}` interpolation (Nodeon's native string interpolation):

```
// entity.no.tmpl
@entity("{tableName}")
export class {ClassName} {
  @id @auto id: number
{columns}
  @timestamps createdAt: Date
  @timestamps updatedAt: Date
}
```

### 9.5 Custom Generators

Users can create project-specific generators in `tools/generators/`:

```
// tools/generators/email-template.no
import { Generator } from "@nodeon/cli"

export class EmailTemplateGenerator extends Generator {
  fn name() = "email-template"
  fn description() = "Generate an email template"

  fn generate(args: { name: string }) {
    this.createFile("src/emails/{args.name}.no", fn() {
      return this.template("email.no.tmpl", { name: args.name })
    })
  }
}

// Usage: nodeon generate email-template welcome
```

---

## 10. Database Layer

### 10.1 Design Principle

The database layer is **not an ORM**. It is a **type-safe query builder** with migration support. Inspired by:

- **Prisma:** Type-safe queries, schema-driven
- **Drizzle:** SQL-like query builder, no magic
- **Rails ActiveRecord:** Migrations, conventions

But implemented as a Nodeon-native library.

### 10.2 Configuration

```
// nodeon.json (database section)
{
  "db": {
    "driver": "postgresql",
    "url": "${DATABASE_URL}",
    "pool": { "min": 2, "max": 10 },
    "migrations": "packages/db/src/migrations",
    "models": "packages/db/src/models",
    "seeds": "packages/db/src/seeds"
  }
}
```

### 10.3 Entity Definition

```
// packages/db/src/models/post.no
@entity("posts")
export class Post {
  @id @auto id: number
  @column title: string
  @column slug: string @unique
  @column content: string
  @column @nullable excerpt: string
  @column published: boolean = false
  @column @nullable publishedAt: Date

  @belongsTo author: User
  @hasMany comments: Comment[]
  @manyToMany tags: Tag[]

  @timestamps createdAt: Date
  @timestamps updatedAt: Date

  @index(["slug"])
  @index(["authorId", "published"])
}
```

The compiler reads `@entity` decorators and generates:
1. A typed query interface (all methods are type-checked)
2. Migration files when models change (`nodeon db diff`)
3. Relation resolution (joins)

### 10.4 Query Builder API

```
// Simple queries
const users = await db.user.findMany()
const user = await db.user.findOne(1)
const user = await db.user.findFirst({ where: { email: "john@example.com" } })

// Filtered queries
const posts = await db.post.findMany({
  where: {
    published: true,
    author: { name: { contains: "John" } }
  },
  orderBy: { publishedAt: "desc" },
  limit: 10,
  offset: 0
})

// With relations
const post = await db.post.findOne(1, {
  include: { author: true, tags: true, comments: { limit: 5 } }
})

// Aggregations
const count = await db.user.count()
const stats = await db.post.aggregate({
  count: true,
  avg: { views: true },
  max: { publishedAt: true }
})

// Mutations
const user = await db.user.create({
  name: "Jane",
  email: "jane@example.com"
})

const updated = await db.user.update(1, { name: "Jane Doe" })
const deleted = await db.user.delete(1)

// Transactions
await db.transaction(async fn(tx) {
  const user = await tx.user.create({ name: "New User", email: "new@example.com" })
  await tx.post.create({ title: "First Post", authorId: user.id })
})

// Raw SQL (escape hatch)
const results = await db.raw("SELECT * FROM users WHERE age > $1", [18])
```

### 10.5 Migrations

```
// Generated by: nodeon generate migration add-post-views
// packages/db/src/migrations/003_add_post_views.no

import { Migration } from "@nodeon/db"

export class AddPostViews extends Migration {
  async fn up(db: Database) {
    await db.alterTable("posts", fn(t) {
      t.integer("views").default(0)
    })
  }

  async fn down(db: Database) {
    await db.alterTable("posts", fn(t) {
      t.dropColumn("views")
    })
  }
}
```

### 10.6 Seeds

```
// packages/db/src/seeds/users.no
import { Seed } from "@nodeon/db"

export class UserSeed extends Seed {
  async fn run(db: Database) {
    await db.user.createMany([
      { name: "Admin", email: "admin@example.com" },
      { name: "Demo User", email: "demo@example.com" }
    ])
  }
}
```

### 10.7 Database Drivers

```
// Built-in drivers (via npm interop)
@nodeon/db-postgresql    # pg driver (default)
@nodeon/db-sqlite        # better-sqlite3 driver
@nodeon/db-mysql         # mysql2 driver

// Future
@nodeon/db-turso         # Turso/libSQL
@nodeon/db-d1            # Cloudflare D1
```

Each driver implements the `DatabaseDriver` interface. The query builder generates SQL dialect-specific queries.

### 10.8 Auto-Diff Migrations

```
$ nodeon db diff

  Comparing models to database schema...

  Changes detected:
    + posts.views (integer, default: 0)
    - posts.legacy_field (dropped)
    ~ users.name (varchar(100) -> varchar(255))

  ? Generate migration 'auto_20260316'? (Y/n)

  Created: packages/db/src/migrations/004_auto_20260316.no
  Review the migration before running 'nodeon db migrate'.
```

This compares the `@entity` definitions against the current database schema and generates a migration automatically — similar to Prisma's `prisma migrate dev`.

---

## 11. Infrastructure

### 11.1 Docker Integration

Every `nodeon new` project includes Docker configuration out of the box:

```
infra/
  docker/
    docker-compose.yml      # Dev environment (db + optional services)
    docker-compose.prod.yml # Production (app + db + reverse proxy)
    Dockerfile              # Multi-stage build for the app
    .dockerignore
```

**docker-compose.yml (dev):**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    profiles:
      - cache

volumes:
  pgdata:
```

**Dockerfile (multi-stage):**

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY nodeon.json package.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN npm install -g nodeon && nodeon build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
```

### 11.2 Environment Variables

```
# .env.example (generated, committed to git)
NODE_ENV=development
PORT=3000
API_PORT=3001

# Database
DATABASE_URL=postgresql://nodeon:nodeon@localhost:5432/myapp
DB_NAME=myapp
DB_USER=nodeon
DB_PASSWORD=nodeon

# Auth
SESSION_SECRET=change-me-in-production
JWT_SECRET=change-me-in-production

# External services (optional)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# SMTP_HOST=
# SMTP_PORT=
# REDIS_URL=redis://localhost:6379
```

The `env()` function in Nodeon reads from `.env` files with type validation:

```
// In code
const port = env("PORT", default: 3000)            // number
const dbUrl = env("DATABASE_URL")                    // required, throws if missing
const redisUrl = env("REDIS_URL", default: null)     // optional
```

### 11.3 Environment Profiles

```
.env                  # Shared defaults (committed)
.env.local            # Local overrides (gitignored)
.env.development      # Dev-specific (committed)
.env.production       # Prod-specific (committed, no secrets)
.env.test             # Test-specific (committed)
```

`nodeon dev` loads `.env` + `.env.development` + `.env.local`
`nodeon build` loads `.env` + `.env.production`
`nodeon test` loads `.env` + `.env.test`

### 11.4 Deploy Targets

```
// nodeon.json (deploy section)
{
  "deploy": {
    "target": "docker",
    "registry": "ghcr.io/myorg/myapp",
    "platform": "linux/amd64"
  }
}
```

Supported targets:

| Target | Command | What It Does |
|--------|---------|-------------|
| **docker** | `nodeon deploy` | Build image, push to registry |
| **node** | `nodeon deploy` | Build + copy to server via SSH |
| **vercel** | `nodeon deploy` | Build + deploy via Vercel CLI |
| **netlify** | `nodeon deploy` | Build + deploy via Netlify CLI |
| **cloudflare** | `nodeon deploy` | Build edge bundle + deploy to CF Workers |
| **fly** | `nodeon deploy` | Build image + deploy to Fly.io |

---

## 12. Developer Experience

### 12.1 `nodeon doctor`

Health check for the development environment:

```
$ nodeon doctor

  Nodeon Doctor v0.3.0

  [OK]  Nodeon compiler v0.3.0
  [OK]  Node.js v20.11.0
  [OK]  npm v10.2.0
  [OK]  Docker v24.0.7
  [OK]  PostgreSQL (via Docker) v16.1
  [OK]  nodeon.json found
  [OK]  .env file found
  [WARN] .env.local not found (optional)
  [OK]  All dependencies installed
  [OK]  Database connection successful
  [OK]  15 migrations applied (0 pending)

  Everything looks good!
```

### 12.2 Error Messages

Nodeon already has structured error messages with codes (E0100+). The platform extends this to framework-level errors:

```
error[N0001]: missing load() return type
  --> apps/web/src/pages/blog/[slug].no:12:3
   |
12 |   async fn load(params) {
   |   ^^^^^^^^^^^^^^^^^^^^^^^^
   |
help: pages with dynamic parameters must return data from load().
      Add a return statement with the data your template needs.

error[N0002]: island references service without @inject
  --> apps/web/src/islands/SearchBar.no:5:3
   |
 5 |   search: SearchService
   |   ^^^^^^^^^^^^^^^^^^^^^ missing @inject decorator
   |
help: add @inject before the field declaration:
      @inject search: SearchService
```

### 12.3 Hot Reload Architecture

```
File change detected (.no)
     |
     v
Compiler (incremental, <50ms)
     |
     +---> Server code changed?
     |       -> Restart API process (graceful)
     |       -> Replay pending requests
     |
     +---> Page/component changed?
     |       -> Re-render affected pages
     |       -> Send HMR update via WebSocket
     |       -> Browser applies DOM patch (no full reload)
     |
     +---> Island changed?
     |       -> Rebuild island bundle
     |       -> Hot-swap island module in browser
     |
     +---> Shared type changed?
             -> Recompile dependents in both apps/web and apps/api
             -> Restart API + HMR web
```

### 12.4 Testing Experience

```
$ nodeon test

  PASS  tests/api/services/user-service.test.no (12 tests, 45ms)
  PASS  tests/api/routes/users.test.no (8 tests, 120ms)
  FAIL  tests/web/pages/blog.test.no (5 tests, 1 failed)

  FAILED: BlogPost > renders post content
    Expected: <h1>Hello World</h1>
    Received: <h1>undefined</h1>

    at tests/web/pages/blog.test.no:23:5

  Tests: 24 passed, 1 failed (25 total)
  Time:  0.32s
```

The built-in test runner (`nodeon test`) provides:

- **`describe`/`it`/`expect` API** — Familiar to any JS developer
- **Auto-discovery** — Finds all `*.test.no` files
- **Watch mode** — Re-runs affected tests on file change
- **Coverage** — Built-in code coverage reporting
- **Snapshot testing** — `expect(output).toMatchSnapshot()`
- **Mocking** — `mock(ServiceClass)` returns a type-safe mock
- **Test database** — Auto-provisions a test database, runs migrations, resets between tests
- **Parallel execution** — Tests run in parallel by default (isolated contexts)

### 12.5 Debugging

Source maps enable standard Node.js debugging:

```
// VS Code launch.json (auto-generated by extension)
{
  "type": "node",
  "request": "launch",
  "name": "Nodeon Dev",
  "program": "${workspaceFolder}/dist/server/index.js",
  "sourceMaps": true,
  "sourceMapPathOverrides": {
    "*": "${workspaceFolder}/*"
  }
}
```

Future: Nodeon DAP (Debug Adapter Protocol) for direct `.no` file debugging without compiled JS.

### 12.6 LSP Integration for the Platform

The existing Nodeon LSP extends with Nova-specific features:

| Feature | Description |
|---------|-------------|
| **Template completions** | Autocomplete HTML tags, component names, attributes in `template()` |
| **Route go-to-definition** | Ctrl+click on `/api/users` jumps to the API class |
| **Entity field completions** | `db.user.` shows all entity fields |
| **Decorator validation** | Red underline on `@island` in wrong context |
| **Import path resolution** | `@shared/types/user` resolves across monorepo |
| **Type hover in templates** | Hover over `{data.post.title}` shows `string` |

---

## 13. Build & Deploy

### 13.1 `nodeon build`

```
$ nodeon build

  Nodeon Build v0.3.0

  [1/5] Compiling .no files (127 files).............. 0.8s
  [2/5] Type checking................................. 1.2s
  [3/5] Building server bundle....................... 0.3s
  [4/5] Building client bundles (4 islands).......... 0.5s
  [5/5] Pre-rendering static pages (12 pages)........ 0.9s

  Build complete in 3.7s

  dist/
    server/
      index.js          (48kb)
      routes.js         (12kb)
    client/
      islands/
        Counter.js      (2.1kb)
        SearchBar.js    (3.4kb)
        LoginForm.js    (4.2kb)
        EditButton.js   (1.8kb)
      styles/
        global.css      (8.2kb)
    static/
      index.html
      about.html
      blog/index.html
      ... (12 pages)

  Total: 48kb server + 11.5kb client JS + 8.2kb CSS
```

### 13.2 Build Pipeline Detail

```
Phase 1: Compile
  - Walk dependency graph from entry points
  - Compile each .no file to .js (incremental, cached)
  - Type check all files
  - Report errors (stop on error)

Phase 2: Analyze
  - Collect route metadata (file-based + decorator-based)
  - Identify islands and their hydration strategies
  - Resolve DI dependencies
  - Extract CSS from style() methods

Phase 3: Bundle
  - Server bundle: all server code into single entry (esbuild)
  - Client bundles: one per island, tree-shaken (esbuild)
  - CSS bundle: concatenate + minify extracted styles

Phase 4: Pre-render
  - For each pre-renderable page:
    - Instantiate DI container
    - Call load() if present (with mock/real data)
    - Render template to HTML
    - Inject island hydration scripts
    - Write HTML file

Phase 5: Emit
  - Write dist/ directory
  - Generate source maps
  - Generate route manifest (for server)
  - Generate island manifest (for hydration)
```

### 13.3 `nodeon deploy`

```
$ nodeon deploy

  Nodeon Deploy v0.3.0

  Target: Docker (ghcr.io/myorg/myapp)
  
  [1/4] Building production bundle................... 3.7s
  [2/4] Building Docker image....................... 12.1s
  [3/4] Pushing image............................... 8.3s
  [4/4] Running migrations on production............ 2.1s

  Deployed! https://myapp.example.com
```

### 13.4 Deploy Adapters

Each deploy target has an adapter that handles the specifics:

```
// Adapter interface
interface DeployAdapter {
  name: string
  fn prebuild(config: DeployConfig): void
  fn build(config: DeployConfig): void
  fn deploy(config: DeployConfig): DeployResult
  fn rollback(config: DeployConfig): void
}
```

Adapters are npm packages: `@nodeon/deploy-docker`, `@nodeon/deploy-vercel`, etc.

### 13.5 Zero-Downtime Deploy

For Docker/server deployments:

1. Build new image
2. Start new container alongside old one
3. Run database migrations
4. Health check new container
5. Switch traffic (reverse proxy reload)
6. Stop old container
7. If health check fails: rollback migration, keep old container

```
$ nodeon deploy --strategy blue-green
$ nodeon deploy --strategy rolling
$ nodeon deploy --rollback
```

---

## 14. Monorepo Structure

### 14.1 Generated Project Structure

When you run `nodeon new my-app` (full-stack), this is the complete structure:

```
my-app/
|
+-- nodeon.json                 # Root project config (replaces package.json for Nodeon)
+-- package.json                # npm interop (auto-generated, minimal)
+-- .env                        # Environment variables (gitignored)
+-- .env.example                # Template (committed)
+-- .gitignore
+-- README.md
|
+-- apps/
|   +-- web/                    # Frontend + SSR application
|   |   +-- nodeon.json         # App-level config
|   |   +-- src/
|   |   |   +-- pages/          # File-based routes
|   |   |   |   +-- index.no            # /
|   |   |   |   +-- about.no            # /about
|   |   |   |   +-- auth/
|   |   |   |   |   +-- login.no        # /auth/login
|   |   |   |   |   +-- register.no     # /auth/register
|   |   |   |   +-- dashboard/
|   |   |   |       +-- index.no        # /dashboard
|   |   |   |       +-- settings.no     # /dashboard/settings
|   |   |   +-- components/     # Server components (zero JS)
|   |   |   |   +-- Header.no
|   |   |   |   +-- Footer.no
|   |   |   |   +-- Nav.no
|   |   |   +-- islands/        # Interactive components (ship JS)
|   |   |   |   +-- LoginForm.no
|   |   |   |   +-- UserMenu.no
|   |   |   +-- layouts/        # Page layouts
|   |   |   |   +-- Main.no
|   |   |   |   +-- Auth.no
|   |   |   +-- styles/         # Global styles
|   |   |       +-- global.css
|   |   +-- public/             # Static assets (copied as-is)
|   |       +-- favicon.ico
|   |       +-- images/
|   |
|   +-- api/                    # Backend API application
|       +-- nodeon.json         # App-level config
|       +-- src/
|           +-- main.no         # API entry point
|           +-- routes/         # API route classes
|           |   +-- users.no
|           |   +-- auth.no
|           +-- services/       # Business logic
|           |   +-- user-service.no
|           |   +-- auth-service.no
|           +-- middleware/      # Request middleware
|           |   +-- auth.no
|           |   +-- cors.no
|           |   +-- rate-limit.no
|           +-- jobs/           # Background jobs
|           |   +-- cleanup-sessions.no
|           +-- config/         # Configuration
|               +-- auth.no
|               +-- app.no
|
+-- packages/
|   +-- shared/                 # Shared types + validation (used by web + api)
|   |   +-- nodeon.json
|   |   +-- src/
|   |       +-- types/          # Shared type definitions
|   |       |   +-- user.no
|   |       |   +-- auth.no
|   |       +-- validators/     # Shared validation rules
|   |       |   +-- user.no
|   |       +-- constants/      # Shared constants
|   |       |   +-- roles.no
|   |       +-- index.no        # Barrel export
|   |
|   +-- db/                     # Database layer
|   |   +-- nodeon.json
|   |   +-- src/
|   |       +-- models/         # Entity definitions
|   |       |   +-- user.no
|   |       |   +-- session.no
|   |       +-- migrations/     # Database migrations
|   |       |   +-- 001_create_users.no
|   |       |   +-- 002_create_sessions.no
|   |       +-- seeds/          # Seed data
|   |       |   +-- users.no
|   |       +-- index.no        # Database client export
|   |
|   +-- ui/                     # Shared UI components
|       +-- nodeon.json
|       +-- src/
|           +-- Button.no
|           +-- Input.no
|           +-- Modal.no
|           +-- index.no
|
+-- tests/
|   +-- api/
|   |   +-- services/
|   |   |   +-- user-service.test.no
|   |   |   +-- auth-service.test.no
|   |   +-- routes/
|   |       +-- users.test.no
|   |       +-- auth.test.no
|   +-- web/
|   |   +-- pages/
|   |       +-- index.test.no
|   +-- shared/
|   |   +-- validators/
|   |       +-- user.test.no
|   +-- e2e/
|       +-- auth-flow.test.no
|       +-- user-crud.test.no
|
+-- infra/
|   +-- docker/
|   |   +-- docker-compose.yml
|   |   +-- docker-compose.prod.yml
|   |   +-- Dockerfile
|   |   +-- .dockerignore
|   +-- scripts/
|       +-- setup.no            # First-time setup script
|       +-- reset-db.no         # Reset development database
|
+-- tools/
    +-- generators/             # Custom project generators (optional)
    +-- scripts/                # Custom dev scripts (optional)
```

### 14.2 Root `nodeon.json`

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "type": "workspace",

  "workspace": {
    "apps": ["apps/*"],
    "packages": ["packages/*"]
  },

  "compiler": {
    "strict": true,
    "strictNullChecks": true,
    "sourceMap": true,
    "target": "node20"
  },

  "paths": {
    "@shared/*": ["packages/shared/src/*"],
    "@db/*": ["packages/db/src/*"],
    "@ui/*": ["packages/ui/src/*"]
  },

  "db": {
    "driver": "postgresql",
    "url": "${DATABASE_URL}",
    "migrations": "packages/db/src/migrations",
    "models": "packages/db/src/models",
    "seeds": "packages/db/src/seeds"
  },

  "dev": {
    "web": { "port": 3000 },
    "api": { "port": 3001 },
    "db":  { "docker": true }
  },

  "deploy": {
    "target": "docker",
    "registry": "ghcr.io/myorg/my-app"
  },

  "test": {
    "include": ["tests/**/*.test.no"],
    "coverage": true,
    "coverageThreshold": { "lines": 80 }
  },

  "lint": {
    "rules": {
      "no-unused-vars": "warn",
      "no-unused-imports": "error",
      "no-shadow": "warn",
      "naming-convention": "warn"
    }
  }
}
```

### 14.3 Dependency Flow

```
                    +-- packages/shared --+
                    |   (types, validators)|
                    +----------+----------+
                               |
              +----------------+----------------+
              |                                 |
     +--------v--------+            +-----------v-----------+
     |   apps/web      |            |      apps/api         |
     |  (frontend+SSR) |            |     (backend API)     |
     +--------+--------+            +-----------+-----------+
              |                                 |
              +----------------+----------------+
                               |
                    +----------v----------+
                    |    packages/db      |
                    |  (models, migrations)|
                    +---------------------+
                               |
                    +----------v----------+
                    |    packages/ui      |
                    | (shared components) |
                    +---------------------+
```

**Key rules:**
- `packages/shared` depends on nothing (pure types + validation)
- `packages/db` depends on `packages/shared` (uses shared types)
- `packages/ui` depends on nothing (pure UI components)
- `apps/api` depends on `packages/shared` + `packages/db`
- `apps/web` depends on `packages/shared` + `packages/ui` + (optionally `packages/db` for SSR)
- No circular dependencies between apps
- No app depends on another app

### 14.4 Package Naming Convention

| Location | Import Path | Description |
|----------|-------------|-------------|
| `packages/shared/src/types/user.no` | `@shared/types/user` | Shared types |
| `packages/db/src/models/user.no` | `@db/models/user` | Database models |
| `packages/ui/src/Button.no` | `@ui/Button` | UI components |
| `apps/api/src/services/user-service.no` | `../services/user-service` | Relative within app |
| `node_modules/express` | `express` | npm packages |
| `@nodeon/core` | `@nodeon/core` | Standard library |

---

## 15. Roadmap by Phases

### Phase 0 — Foundation (Current State, Done)

What already exists in the Nodeon repository:

- [x] Self-hosting compiler with verified fixpoint (32 .no modules, 141.2kb)
- [x] 636 tests (lexer, parser, e2e, bootstrap, type-checker, nova, regression, snapshot)
- [x] Nova framework core (signals, DI, template engine, island bundler, router, renderer, server)
- [x] LSP with diagnostics, completions, hover, go-to-definition, semantic tokens, formatting, rename
- [x] VS Code extension with TextMate grammar
- [x] Structured error messages with codes (E0100+)
- [x] Source maps (V3 spec)
- [x] CLI: build, run, check, fmt, repl, init, watch
- [x] IR layer + WASM backend (experimental)
- [x] Language innovations: ADTs, pattern matching v2, named args, if-expressions, go concurrency, comptime

### Phase 1 — Language Completeness (v0.2, ~2 months)

**Goal:** Make Nodeon usable for real projects — you can write a full app without hitting language gaps.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| Standard library Tier 1 | 🔴 | 3 weeks | `@nodeon/core`, `@nodeon/fs`, `@nodeon/path`, `@nodeon/test` |
| npm interop | 🔴 | 2 weeks | `import express from 'express'` resolves `node_modules` |
| Module runtime | 🔴 | 1 week | `nodeon run` supports multi-file programs with imports |
| `nodeon test` | 🔴 | 2 weeks | Built-in test runner (describe/it/expect, watch, coverage) |
| Decorator execution | 🟡 | 1 week | `@log fn hello()` generates `hello = log(hello)` in output |
| Publish to npm | 🔴 | 3 days | `npm install -g nodeon` works |
| Publish VS Code extension | 🔴 | 2 days | VS Code Marketplace |
| Getting Started Guide | 🔴 | 1 week | Install, first program, compile, run |
| Fix remaining bugs | 🟡 | 1 week | BUG-003 (error nodes), BUG-004, BUG-005, BUG-006, BUG-008 |

**Exit criteria:** A developer can `npm install -g nodeon`, create a project, write multi-file code, run tests, and get IDE support.

### Phase 2 — Framework Core (v0.3, ~3 months)

**Goal:** Nova becomes a usable web framework. You can build a real web app.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| Compiler plugin API | 🔴 | 2 weeks | `CompilerPlugin` interface for Nova to hook into compilation |
| Template compilation (Nova) | 🔴 | 3 weeks | `template()` methods compiled to render functions |
| `@page` + `@api` decorators | 🔴 | 2 weeks | Routes from decorators + file conventions |
| `@island` hydration pipeline | 🔴 | 3 weeks | Client bundle generation, hydration runtime |
| `@service` + `@inject` DI | 🟡 | 1 week | Already exists; wire into request lifecycle |
| `nodeon new` (project generator) | 🔴 | 2 weeks | Full monorepo scaffolding |
| `nodeon dev` (dev server) | 🔴 | 2 weeks | Start all services, watch, HMR |
| `nodeon generate entity` | 🟡 | 2 weeks | Model + migration + service + API + tests |
| CSS extraction | 🟡 | 1 week | `style()` methods extracted to CSS files |
| Standard library Tier 2 | 🟡 | 2 weeks | `@nodeon/http`, `@nodeon/json`, `@nodeon/string` |
| Database layer (`@nodeon/db`) | 🔴 | 3 weeks | Query builder, migrations, seeds, PostgreSQL driver |
| Type system: null safety | 🟡 | 2 weeks | `T?` type, strictNullChecks |
| Language Reference docs | 🟡 | 2 weeks | Complete syntax reference |

**Exit criteria:** `nodeon new my-app && cd my-app && nodeon dev` starts a working full-stack app with database, API, and frontend.

### Phase 3 — Production Readiness (v0.4, ~3 months)

**Goal:** Nova apps can be deployed to production. Type system is useful.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| `nodeon build` (production) | 🔴 | 2 weeks | Server bundle + client islands + static pages |
| `nodeon deploy` | 🔴 | 2 weeks | Docker adapter (default) |
| Authentication module | 🔴 | 2 weeks | JWT, sessions, OAuth providers |
| Middleware pipeline | 🟡 | 1 week | Auth, CORS, rate limiting |
| Type system: control flow | 🟡 | 3 weeks | Narrowing, exhaustiveness in match/switch |
| Cross-file type resolution | 🟡 | 3 weeks | Import types from other .no files |
| `nodeon lint` | 🟡 | 2 weeks | Configurable rules |
| Incremental compilation | 🟡 | 2 weeks | Only recompile changed files |
| Jobs & queues | 🟢 | 2 weeks | @job decorator, cron, manual dispatch |
| Forms & validation | 🟡 | 2 weeks | @validate types, client+server |
| Deploy adapters (Vercel, Fly) | 🟢 | 2 weeks | Additional deploy targets |
| CONTRIBUTING.md | 🟡 | 3 days | Setup guide, PR process |
| "Nodeon by Example" tutorial | 🟡 | 2 weeks | Progressive learning resource |

**Exit criteria:** A real web application (blog, dashboard, SaaS) can be built and deployed to production using only Nodeon + Nova.

### Phase 4 — Ecosystem (v0.5, ~4 months)

**Goal:** Community can build and share packages. Advanced language features.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| `.d.no` type definitions | 🔴 | 2 weeks | Declare types for npm packages |
| Node.js builtins types | 🟡 | 2 weeks | Type defs for fs, path, http, crypto |
| Standard library Tier 3 | 🟡 | 3 weeks | async, crypto, env, log, cli, date |
| Pipe operator | 🟡 | 1 week | `data \|> parse \|> validate \|> save` |
| LSP: auto-imports, workspace symbols | 🟡 | 2 weeks | Cross-file features |
| Debug Adapter (DAP) | 🟡 | 3 weeks | Step debugging in VS Code |
| `nodeon doc` | 🟡 | 2 weeks | Documentation generator |
| Website + playground | 🟡 | 3 weeks | Landing page, interactive editor |
| `nodeon db studio` | 🟢 | 2 weeks | Web-based database GUI |
| Edge deploy (Cloudflare) | 🟢 | 2 weeks | Edge adapter |
| Performance benchmarks | 🟢 | 1 week | CI benchmarks, comparison vs tsc |

**Exit criteria:** 10+ community packages on npm, 1000+ GitHub stars, 3+ real projects built with Nodeon.

### Phase 5 — Maturity (v1.0, ~6 months)

**Goal:** Production-ready language with stable APIs.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| Language specification (BNF/EBNF) | 🔴 | 3 weeks | Formal grammar |
| Full type system (TS parity) | 🔴 | 2 months | Mapped types, conditional types, type predicates |
| IR as default pipeline | 🟡 | 1 month | All AST nodes lowered to IR, optimization passes |
| WASM backend: strings + arrays | 🟡 | 1 month | Practical WASM output |
| Security audit | 🔴 | 2 weeks | Sandbox, comptime, output review |
| 95% code coverage | 🟡 | ongoing | Comprehensive test suite |
| Governance model | 🟡 | 1 week | Core team, RFC process, release schedule |
| Standalone binaries (Node SEA) | 🟢 | 2 weeks | Bundle app into single executable |

**Exit criteria:** Language specification published, v1.0 release, stable API guarantees, governance established.

---

## 16. Technical Risks

### 16.1 High Risk

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Compiler OOM patterns** | Developers hit parser hangs with certain code patterns (.no self-hosted compiler has known OOM triggers: object spread, IIFE, grouped expression chaining) | High | Systematic parser hardening. Each OOM pattern gets a regression test. Consider rewriting parser hot paths in a more memory-efficient style. Track heap usage in CI. |
| **npm interop complexity** | Node module resolution is extremely complex (CJS vs ESM, package.json exports, conditional exports, subpath patterns). Incomplete implementation = broken imports. | High | Start with the 90% case: ESM imports, package.json main/module field, node_modules lookup. Add edge cases incrementally. Test against top 100 npm packages. |
| **Type system scope creep** | TypeScript's type system took 10+ years and 100+ engineers. Attempting parity is unrealistic. | High | Explicitly define "Nodeon types are simpler than TypeScript." Prioritize: inference, null safety, basic generics. Say no to mapped types, conditional types, template literal types until v1.0+. |
| **One-person bottleneck** | Single developer = single point of failure. Burnout, context loss, or absence stalls everything. | Medium | Comprehensive documentation. Contributing guide. Automated CI/CD so contributors can self-serve. Prioritize features that attract contributors (stdlib, docs, website). |

### 16.2 Medium Risk

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Framework vs. language coupling** | If Nova needs a language feature that breaks the compiler, it blocks both. | Medium | Strict separation: Nova uses only stable language features + the plugin API. Never modify the core parser for framework needs. |
| **Performance at scale** | 1000+ file projects may be slow without incremental compilation and parallel builds. | Medium | Design incremental compilation from the start (Phase 3). Use esbuild for bundling (already fast). Cache aggressively. |
| **Template syntax conflicts** | JSX-like templates in `template()` methods may conflict with Nodeon's string interpolation or parser. | Medium | Templates are parsed by Nova's template parser (separate from the core Nodeon parser). The core parser sees `template()` as a regular method with a string/template literal body. |
| **Breaking changes in early versions** | Early adopters get frustrated if APIs change frequently. | Medium | Semantic versioning strictly. Provide `nodeon migrate` codemods for every breaking change. Keep v0.x cycle short. |

### 16.3 Low Risk

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Database driver maintenance** | PostgreSQL/MySQL/SQLite drivers need ongoing maintenance. | Low | Wrap existing npm drivers (pg, better-sqlite3, mysql2). Let the npm ecosystem handle driver updates. |
| **Deploy adapter maintenance** | Cloud platforms change their APIs. | Low | Adapters are thin wrappers around existing CLIs (vercel, wrangler, flyctl). |
| **Competition from Bun/Deno** | Alternative JS runtimes may reduce interest in a new language. | Low | Nodeon's value is the language + framework coherence, not the runtime. Support Bun/Deno as deploy targets. |

---

## 17. Critical Decisions

### Decision 1: Templates — String-Based vs. JSX-Like

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **A) String-based** (current Nova template engine) | Already implemented. No parser changes. Simple. | Less ergonomic. No auto-completion in templates. Escaping issues. |
| **B) JSX-like in template()** (proposed in framework-architecture.md) | Best DX. IDE support (syntax highlighting, completions). Type checking in templates. | Requires a separate template parser. Two parsing phases. Complexity. |
| **C) Separate .nohtml files** | Clean separation of concerns. Easy to syntax-highlight. | Two file types per component. More files to manage. |

**Recommendation: B (JSX-like)** — But implemented as a **Nova compiler plugin** that post-processes the AST. The core Nodeon parser sees template method bodies as blocks of code. Nova's plugin parses the HTML-like content within those blocks.

### Decision 2: Database — Build Our Own vs. Wrap Prisma

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **A) Build query builder from scratch** | Full control. Nodeon-native. No external dependency. | Massive effort. SQL dialect support. Migration engine. |
| **B) Wrap Prisma** | Battle-tested. Rich features. Type generation. | Heavy dependency (Rust binary). Prisma schema != Nodeon entities. Config duplication. |
| **C) Wrap Drizzle** | Lightweight. SQL-like API. TypeScript-native. | Still a dependency. API must be adapted for Nodeon. |
| **D) Thin wrapper over pg/sqlite drivers** | Minimal abstraction. Full SQL control. | No migrations, no type safety, no relations. |

**Recommendation: A (build from scratch)** — But start minimal:
1. Phase 1: Raw query helper + manual migrations (thin wrapper over pg)
2. Phase 2: Type-safe query builder (generated from @entity decorators)
3. Phase 3: Relation resolution, aggregations, auto-diff migrations
4. Phase 4+: Advanced features (connection pooling, read replicas)

This gives us immediate value without blocking on a complex ORM, and the result is 100% Nodeon-native.

### Decision 3: Monorepo Tool — npm Workspaces vs. Custom

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **A) npm workspaces** (current) | Already works. Standard. Zero config. | Limited task orchestration. No caching. Slow. |
| **B) Turborepo/Nx** | Fast builds. Caching. Task graph. | External dependency. Configuration. Not Nodeon-native. |
| **C) Custom workspace manager** | Nodeon-native. Full control. `nodeon.json` drives everything. | Must build task runner, caching, dependency graph. |

**Recommendation: A now, migrate to C later.** Use npm workspaces for Phase 1-2 (it works, zero effort). Build a Nodeon-native workspace manager for Phase 3+ that reads `nodeon.json` workspace config and provides:
- Parallel task execution
- Content-hash caching
- Dependency-aware builds
- `nodeon run-many "test"` / `nodeon run-many "build"`

### Decision 4: Standard Library — Pure Nodeon vs. npm Wrappers

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **A) Pure Nodeon** | No dependencies. Full control. Self-contained. | Must reimplement everything. Bugs. Maintenance. |
| **B) Thin wrappers over Node.js builtins** | Proven, battle-tested code underneath. Fast to build. | Tied to Node.js. Not portable to browser/edge. |
| **C) Thin wrappers over npm packages** | Richest features. Community maintained. | Dependencies. Version management. Supply chain risk. |

**Recommendation: B for Tier 1 (core, fs, path), A for Tier 2+ (collections, string, fmt).** Node.js builtins are stable and available everywhere Node runs. For higher-level utilities (collections, string formatting), pure Nodeon implementations are better — they also serve as proof that the language works for real library code.

### Decision 5: Authentication — Built-in vs. Plugin

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **A) Built-in (Rails-style)** | Works out of the box. Strong conventions. | Maintenance burden. Hard to customize. |
| **B) Plugin/adapter (Next-Auth style)** | Flexible. Community can contribute providers. | More setup. Less opinionated. |
| **C) BYOA (Bring Your Own Auth)** | Maximum flexibility. No framework opinion. | Every project reinvents auth. Bad DX. |

**Recommendation: A with escape hatches.** Authentication is too important to leave as "configure it yourself." Nova ships with a built-in auth module that covers email/password + JWT sessions. OAuth providers are adapters. The `config/auth.no` file provides customization. Users who need something completely different can disable the built-in and use any npm auth library.

### Decision 6: What NOT to Build

Equally important — things we explicitly will NOT build, and why:

| Thing | Why Not | Alternative |
|-------|---------|-------------|
| **Custom JS engine** | Astronomical effort. V8/SpiderMonkey are billion-dollar projects. | Compile to JS, run on Node.js/Bun/Deno |
| **Custom package registry** | Ecosystem fragmentation. Nobody wants another registry. | Publish to npm as `@nodeon/*` packages |
| **Custom CSS preprocessor** | Solved problem. Not our core value. | Support plain CSS, PostCSS, Tailwind via npm |
| **Custom bundler** | esbuild is fast enough. Building a bundler is years of work. | Use esbuild as bundling engine |
| **Visual editor / no-code tool** | Different product. Distracts from language quality. | Focus on text-based DX |
| **Mobile framework** | Different paradigm (React Native, Flutter dominate). | Maybe v2.0 — capacitor/tauri wrapper |
| **Native compilation (LLVM)** | Enormous effort with unclear value when JS runs everywhere. | WASM backend for performance-critical code |

---

## Summary

The Nodeon Platform is a **vertically integrated development stack** designed around one principle: **the developer writes only Nodeon**.

| Layer | Solution | Status |
|-------|----------|--------|
| **Language** | Nodeon (.no) | 85% complete |
| **Compiler** | Self-hosted, fixpoint verified | Working |
| **Type System** | Inference, generics, interface conformance | Basic — needs null safety, control flow |
| **Standard Library** | `@nodeon/*` | Not started |
| **Framework** | Nova (Angular x Astro) | Core modules working (signals, DI, template, router) |
| **CLI** | `nodeon` | build, run, check, fmt, repl, init — needs new, dev, generate, test, deploy |
| **Database** | `@nodeon/db` | Not started |
| **Infrastructure** | Docker, env, deploy | Not started |
| **Editor** | VS Code extension + LSP | Working |

**The critical path is:**

```
Phase 1 (stdlib + npm interop + test runner)
    |
    v
Phase 2 (Nova framework core + project generator + dev server + database)
    |
    v
Phase 3 (production build + deploy + auth + advanced types)
    |
    v
Phase 4 (ecosystem + docs + website + community)
    |
    v
Phase 5 (v1.0 — language spec + stability guarantees)
```

Estimated timeline to Phase 3 (usable platform): **~8 months**.
Estimated timeline to v1.0 (production ready): **~18 months**.

The foundation is exceptionally strong. The path forward is about **building up, not building out** — layering stdlib, framework, and tooling on top of a compiler that already works.
