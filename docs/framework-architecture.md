# Nodeon Framework — Architecture Design

**Codename:** Nova  
**Concept:** Angular's structured architecture × Astro's island hydration  
**Language:** Written entirely in Nodeon (.no)  
**Target:** Full-stack web framework — static-first, selectively interactive

---

## 1. Vision

Nova is a full-stack web framework for Nodeon that combines:

- **From Astro:** Zero JS by default, island architecture, partial hydration, file-based routing, content-first, server-side rendering (SSR)
- **From Angular:** Component-based architecture, dependency injection, services, signals/reactivity, decorators, strong typing, structured project conventions

The result: **a framework that ships zero JavaScript by default, but lets you opt into rich interactivity per-component using Angular-style patterns — all written in Nodeon.**

### Why This Combination?

| Feature | Angular alone | Astro alone | Nova (hybrid) |
|---------|--------------|-------------|---------------|
| Default JS payload | Heavy (~100kb+) | Zero | Zero |
| Interactivity | Full SPA | Per-island | Per-island |
| Architecture | Very structured | Flexible/loose | Structured |
| DI / Services | ✅ Built-in | ❌ None | ✅ Built-in |
| SSR | ✅ (complex) | ✅ (native) | ✅ (native) |
| File-based routing | ❌ | ✅ | ✅ |
| Type safety | ✅ (TypeScript) | ⚠️ (optional) | ✅ (Nodeon types) |
| Learning curve | Steep | Low | Medium |

---

## 2. Core Concepts

### 2.1 Components (`.no` files)

Every UI element is a Nodeon component. Components are **server-rendered by default** — no JavaScript sent to the client unless explicitly opted in.

```
// components/Header.no

@component
export class Header {
  @input title: string = "My Site"
  @input nav: string[] = []

  template() {
    <header class="site-header">
      <h1>{this.title}</h1>
      <nav>
        for link in this.nav {
          <a href="/{link}">{link}</a>
        }
      </nav>
    </header>
  }

  style() {
    `.site-header { display: flex; justify-content: space-between; }`
  }
}
```

### 2.2 Islands (Interactive Components)

Components that need client-side JavaScript use the `@island` decorator. Only these components ship JS to the browser.

```
// islands/Counter.no

@island
export class Counter {
  @signal count: number = 0

  fn increment() {
    this.count = this.count + 1
  }

  template() {
    <div class="counter">
      <span>{this.count}</span>
      <button @click={this.increment}>+1</button>
    </div>
  }
}
```

**Hydration strategies** (like Astro):
- `@island` — hydrate on page load (default)
- `@island(visible)` — hydrate when visible (IntersectionObserver)
- `@island(idle)` — hydrate on browser idle (requestIdleCallback)
- `@island(media: "(max-width: 768px)")` — hydrate on media query match
- `@island(none)` — server-render only, no client JS even if interactive

### 2.3 Pages (File-Based Routing)

```
src/
├── pages/
│   ├── index.no          →  /
│   ├── about.no          →  /about
│   ├── blog/
│   │   ├── index.no      →  /blog
│   │   └── [slug].no     →  /blog/:slug  (dynamic route)
│   └── api/
│       └── posts.no      →  /api/posts   (API route)
```

Pages are components with a `page()` method:

```
// pages/index.no

import { Header } from "../components/Header.no"
import { Counter } from "../islands/Counter.no"
import { PostService } from "../services/PostService.no"

@page
export class HomePage {
  @inject posts: PostService

  async fn load() {
    return {
      recentPosts: await this.posts.getRecent(5)
    }
  }

  template(data) {
    <html>
      <head><title>Home</title></head>
      <body>
        <Header title="Nova App" nav={["about", "blog"]} />
        <main>
          <h2>Recent Posts</h2>
          for post in data.recentPosts {
            <article>
              <h3><a href="/blog/{post.slug}">{post.title}</a></h3>
              <p>{post.excerpt}</p>
            </article>
          }
          <Counter />  // Island — ships JS for interactivity
        </main>
      </body>
    </html>
  }
}
```

### 2.4 Services & Dependency Injection

Angular-style services with DI:

```
// services/PostService.no

@service
export class PostService {
  @inject http: HttpClient
  @inject cache: CacheService

  async fn getRecent(limit: number) {
    const cached = this.cache.get("recent-posts")
    if cached { return cached }

    const posts = await this.http.get("/api/posts?limit={limit}")
    this.cache.set("recent-posts", posts, 60)
    return posts
  }

  async fn getBySlug(slug: string) {
    return await this.http.get("/api/posts/{slug}")
  }
}
```

### 2.5 Signals (Fine-Grained Reactivity)

Islands use signals for reactive state — no virtual DOM, direct DOM updates:

```
@island
export class TodoApp {
  @signal todos: string[] = []
  @signal input: string = ""

  @computed
  fn remaining() {
    return this.todos.length
  }

  fn addTodo() {
    if this.input.trim() != "" {
      this.todos = [...this.todos, this.input]
      this.input = ""
    }
  }

  template() {
    <div>
      <input value={this.input} @input={fn(e) { this.input = e.target.value }} />
      <button @click={this.addTodo}>Add ({this.remaining})</button>
      <ul>
        for todo in this.todos {
          <li>{todo}</li>
        }
      </ul>
    </div>
  }
}
```

### 2.6 Layouts

Shared layouts wrap pages:

```
// layouts/Main.no

@layout
export class MainLayout {
  @input title: string = "Nova App"

  template(slot) {
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>{this.title}</title>
        <link rel="stylesheet" href="/styles/global.css" />
      </head>
      <body>
        <Header title={this.title} />
        <main>{slot}</main>
        <Footer />
      </body>
    </html>
  }
}

// pages/about.no
@page(layout: MainLayout)
export class AboutPage {
  template() {
    <section>
      <h1>About Us</h1>
      <p>Built with Nova framework.</p>
    </section>
  }
}
```

---

## 3. Architecture

### 3.1 Compilation Pipeline

```
.no source files
       │
       ▼
  Nova Compiler (extends Nodeon compiler)
       │
       ├── Template Parser ─── parses HTML-like template() bodies
       ├── Signal Transformer ── converts @signal to reactive wrappers
       ├── DI Resolver ──────── resolves @inject dependencies
       └── Island Extractor ─── identifies @island components
       │
       ▼
  ┌──────────────────────────────────┐
  │  Server Bundle (.js)             │  ← SSR renderer, routes, services
  │  Client Bundles (per-island .js) │  ← Only for @island components
  │  Static HTML                     │  ← Pre-rendered pages
  │  CSS                             │  ← Extracted from style() methods
  └──────────────────────────────────┘
```

### 3.2 Runtime Architecture

```
Browser Request
       │
       ▼
  Nova Server (Node.js)
       │
       ├── Router (file-based)
       │     │
       │     ▼
       ├── Page load() → fetch data
       │     │
       │     ▼
       ├── SSR Renderer
       │     ├── Render @component as HTML (no JS)
       │     ├── Render @island as HTML + hydration script tag
       │     └── Inject island JS bundles (lazy, per strategy)
       │
       ▼
  HTML Response
       │
       ▼
  Browser
       ├── Display HTML immediately (zero JS for static content)
       └── Hydrate islands when conditions met (load/visible/idle/media)
```

### 3.3 DI Container

```
  ┌─────────────────────────────────────────┐
  │  DI Container (per-request scope)       │
  │                                         │
  │  @service HttpClient ─── singleton      │
  │  @service CacheService ── singleton     │
  │  @service PostService ─── per-request   │
  │  @service AuthService ─── per-request   │
  │                                         │
  │  Resolution: constructor injection      │
  │  Lifecycle: singleton | per-request     │
  └─────────────────────────────────────────┘
```

---

## 4. Project Structure

```
my-nova-app/
├── nova.json              # Project config (like angular.json meets astro.config)
├── src/
│   ├── pages/             # File-based routes
│   │   ├── index.no
│   │   ├── about.no
│   │   └── blog/
│   │       ├── index.no
│   │       └── [slug].no
│   ├── components/        # Server components (zero JS)
│   │   ├── Header.no
│   │   └── Footer.no
│   ├── islands/           # Interactive components (ship JS)
│   │   ├── Counter.no
│   │   └── SearchBar.no
│   ├── layouts/           # Page layouts
│   │   └── Main.no
│   ├── services/          # Business logic (DI)
│   │   ├── PostService.no
│   │   └── AuthService.no
│   ├── middleware/         # Request middleware
│   │   └── auth.no
│   └── styles/            # Global styles
│       └── global.css
├── public/                # Static assets (copied as-is)
│   ├── favicon.ico
│   └── images/
└── dist/                  # Build output
    ├── server/            # Server bundle
    ├── client/            # Client island bundles
    └── static/            # Pre-rendered HTML + assets
```

### 4.1 `nova.json`

```json
{
  "name": "my-nova-app",
  "version": "0.1.0",
  "output": "dist",
  "server": {
    "port": 3000,
    "host": "localhost"
  },
  "build": {
    "mode": "hybrid",
    "prerender": ["/", "/about"],
    "minify": true,
    "sourceMap": true
  },
  "islands": {
    "defaultStrategy": "load",
    "inlineThreshold": 4096
  }
}
```

Build modes:
- **`static`** — Pre-render all pages at build time (like Astro static)
- **`server`** — SSR all pages at request time
- **`hybrid`** — Pre-render specified pages, SSR the rest (default)

---

## 5. Template Syntax

Nova templates are embedded in `template()` methods using JSX-like syntax that compiles to Nodeon render calls:

### 5.1 Expressions
```
<p>{user.name}</p>                    // Variable interpolation
<p>{items.length} items</p>           // Expression
<p class={isActive ? "on" : "off"}>   // Conditional attribute
```

### 5.2 Control Flow
```
// Conditionals
if user {
  <p>Welcome, {user.name}</p>
} else {
  <p>Please sign in</p>
}

// Loops
for item in items {
  <li key={item.id}>{item.name}</li>
}

// Match
match status {
  case "loading" { <Spinner /> }
  case "error" { <ErrorMsg message={error} /> }
  default { <Content data={data} /> }
}
```

### 5.3 Events (islands only)
```
<button @click={this.handleClick}>Click</button>
<input @input={fn(e) { this.value = e.target.value }} />
<form @submit.prevent={this.handleSubmit}>...</form>
```

### 5.4 Component Composition
```
<Header title="My App" />                    // Props
<Layout><slot content here /></Layout>       // Slots
<Card>
  <:header>Card Title</:header>              // Named slots
  <:body>Card content</:body>
</Card>
```

---

## 6. Implementation Phases

### Phase 0: Foundation (Current)
- [x] Self-hosting Nodeon compiler
- [x] Verified fixpoint
- [ ] Error messages with codes + context
- [ ] Standard library basics (@nodeon/core, @nodeon/fs, @nodeon/http)

### Phase 1: Template Engine
- [ ] Template parser — parse HTML-like syntax inside `template()` methods
- [ ] Template → render function compilation
- [ ] Static HTML output from components
- [ ] CSS extraction from `style()` methods
- [ ] File-based routing (read pages/ directory)

### Phase 2: SSR + Dev Server
- [ ] Node.js HTTP server with routing
- [ ] Server-side rendering pipeline
- [ ] Development server with file watching + hot reload
- [ ] `nova dev` command
- [ ] `nova build` command

### Phase 3: Island Architecture
- [ ] `@island` decorator — mark components for client hydration
- [ ] Client bundle generation (one per island)
- [ ] Hydration runtime (attach event listeners, reactive state)
- [ ] Hydration strategies (load, visible, idle, media)
- [ ] Partial hydration — only ship JS for islands

### Phase 4: Signals + Reactivity
- [ ] `@signal` decorator — fine-grained reactive state
- [ ] `@computed` decorator — derived reactive values
- [ ] DOM diffing / targeted updates (no virtual DOM)
- [ ] Event binding compilation (@click, @input, etc.)

### Phase 5: Dependency Injection
- [ ] `@service` decorator — register injectable services
- [ ] `@inject` decorator — constructor injection
- [ ] DI container with lifecycle management (singleton, per-request)
- [ ] Built-in services: HttpClient, CacheService, Logger

### Phase 6: Production Features
- [ ] Static site generation (pre-render pages)
- [ ] Hybrid mode (SSR + pre-rendered)
- [ ] Asset optimization (CSS minification, image optimization)
- [ ] API routes (pages/api/*.no)
- [ ] Middleware pipeline
- [ ] `nova deploy` — deploy to Vercel/Netlify/Cloudflare

---

## 7. Key Differentiators

1. **Nodeon-native** — The first framework written in and for Nodeon. No TypeScript config, no build tool fatigue.

2. **Zero-JS by default** — Like Astro, pages ship zero JavaScript unless an island explicitly opts in. Unlike Angular, which ships 100kb+ minimum.

3. **Structured like Angular** — DI, services, decorators, strong conventions. Unlike Astro, which is "bring your own structure."

4. **Single-language full-stack** — Server logic, templates, client interactivity, and services all in Nodeon. No switching between TS/JS/JSX/HTML.

5. **Compiled away** — Decorators like `@component`, `@island`, `@signal` are compile-time constructs. No runtime decorator overhead.

6. **Progressive interactivity** — Start fully static. Add islands one by one as needed. No refactoring required.

---

## 8. Technical Prerequisites

Before Nova can be built, Nodeon needs:

1. **Decorator support** — `@component`, `@island`, `@service`, `@inject`, `@signal` (parser + generator)
2. **Template syntax** — JSX-like HTML in `template()` methods (new parser phase)
3. **Multi-file bundling** — Bundle server + per-island client bundles (esbuild integration)
4. **Standard library** — `@nodeon/http` for server, `@nodeon/fs` for file routing
5. **Module resolution** — Proper import resolution across .no files
6. **Error messages** — Framework errors need to be clear and actionable

---

## 9. Naming & Branding

**Framework name:** Nova  
**Tag line:** "Zero-JS by default. Full power when you need it."  
**CLI command:** `nova` (or `nodeon nova` initially)  
**Package:** `@nodeon/nova`  
**File convention:** `.no` files (same as Nodeon — the framework is just Nodeon)

---

*This document will evolve as implementation progresses. Next step: Phase 1 — Template Engine.*
