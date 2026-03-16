# Nodeon Platform — Architecture vs. Implementation Audit

**Date:** March 16, 2026  
**Scope:** Full audit of `docs/platform-architecture.md` (17 sections) against actual codebase  
**Tests:** 594 passing | **Build:** 40 .no files, 0 failures | **Bundle:** compiler 172.9kb, CLI 279.8kb

---

## Quick Status by Section

| # | Section | Status | Notes |
|---|---------|--------|-------|
| 1 | Platform Vision | ✅ Done | Architecture doc complete |
| 2 | Pre-Design Analysis | ✅ Done | Language/framework split, versioning, anti-lock-in |
| 3 | Architecture | ✅ Done | 5-layer stack documented and partially implemented |
| 4 | Language Extensions | ⚠️ Partial | Decorators parsed but NOT executed. @page/@api/@entity/@validate not wired |
| 5 | Compiler Pipeline | ⚠️ Partial | Core pipeline done. CompilerPlugin interface NOT built |
| 6 | Runtime | ⚠️ Partial | Node.js works. Browser (islands) works. Edge NOT done. Runtime lib NOT built |
| 7 | Framework (Nova) | ⚠️ Partial | 8/10 modules exist. Missing: @component decorator, template compilation |
| 8 | CLI | ⚠️ Partial | 14 commands exist. Missing: doctor, eject, db, start, bundle, upgrade, migrate |
| 9 | Generators | ⚠️ Partial | Basic `generate` exists. Full entity/module generators NOT built |
| 10 | Database | ⚠️ Partial | `packages/db` has schema+query-builder+migrations. NOT wired to CLI |
| 11 | Infrastructure | ✅ Done | Docker/Vercel/Fly adapters in deploy.no |
| 12 | Developer Experience | ⚠️ Partial | Structured errors done. doctor/HMR/framework error codes missing |
| 13 | Build & Deploy | ⚠️ Partial | build-prod.no covers 4/5 phases. Phase 2 (analyze) missing |
| 14 | Monorepo | ⚠️ Partial | `nodeon new` generates simple structure, NOT full monorepo |
| 15 | Roadmap | ✅ Done | Phase 3 code items complete |
| 16 | Technical Risks | ✅ Done | Documented |
| 17 | Critical Decisions | ✅ Done | 6 decisions with tradeoffs |

---

## §4 Language Extensions — What's Missing

**Decorators are parsed** into the AST but **never executed** in generated code.

| Decorator | Described In | Status |
|-----------|-------------|--------|
| `@page("/path")` | §4.4, §7.2.4 | ❌ Not implemented — route metadata not extracted |
| `@api("/path")` | §4.4, §7.2.1 | ❌ Not implemented — no route collector |
| `@entity("table")` | §4.3, §10.3 | ❌ Not implemented — no migration/query generation |
| `@validate` | §4.2 | ❌ Not implemented — no auto-generated validator functions |
| `@service` | §7.2.5 | ❌ Not implemented — DI container exists but @service not wired |
| `@inject` | §7.2.5 | ❌ Not implemented — DI exists but @inject not wired |
| `@island(strategy)` | §7.2.3 | ⚠️ Partial — island() function works, @island decorator not compiled |
| `@component` | §7.2.2 | ❌ Not implemented |
| `@middleware` | §7.2.6 | ❌ Not implemented |
| `@job(schedule)` | §7.2.10 | ❌ Not implemented — jobs.js exists but @job not compiled |

**Action needed:** Build CompilerPlugin interface (§5.7) + Nova decorator resolver.

---

## §5 Compiler Pipeline — What's Missing

| Item | Described In | Status |
|------|-------------|--------|
| Lexer → Parser → TypeChecker → Generator | §5.1 | ✅ Done |
| IR layer + optimizations | §5.1 | ✅ Done (fold, DCE) |
| WASM generator | §5.1 | ✅ Done (experimental, i32/f64 only) |
| CompilerPlugin interface | §5.7 | ❌ Not built |
| Decorator Resolver | §5.2 | ❌ Not built |
| Template Parser (HTML in template()) | §5.2 | ❌ Not built (Nova template engine exists but not compile-time) |
| Validation Generator | §5.2 | ❌ Not built |
| Entity Generator | §5.2 | ❌ Not built |
| Route Collector | §5.2 | ❌ Not built |
| Declaration files (.d.no) | §5.2 | ❌ Not built |
| 5 compilation modes | §5.3 | ⚠️ 3/5: single ✅, project ✅, check ✅, watch ⚠️, bundle ❌ |
| esbuild bundling | §5.5 | ✅ Done (island-bundler.js, build-prod.no) |

---

## §7 Framework (Nova) — Module Status

| Module | Described In | File(s) | Status |
|--------|-------------|---------|--------|
| Router | §7.2.1 | router.no/.js | ✅ buildRoutes, matchRoute |
| Components | §7.2.2 | — | ❌ No @component decorator or zero-JS server components |
| Islands | §7.2.3 | island.no/.js, island-bundler.no/.js | ✅ island(), renderIsland, bundleIslands |
| Pages | §7.2.4 | renderer.no/.js | ⚠️ renderPage works, @page decorator not compiled |
| DI/Services | §7.2.5 | di.no/.js | ✅ Container, Injectable, Inject, InjectionToken |
| Middleware | §7.2.6 | middleware.js | ✅ createPipeline, cors, rateLimit, jsonBody, logger, securityHeaders |
| Signals | §7.2.7 | signals.no/.js | ✅ signal, computed, effect, batch (21 tests) |
| Forms/Validation | §7.2.8 | validation.js | ✅ schema(), 15 validators, transformers, middleware |
| Auth | §7.2.9 | auth.js | ✅ JWT, password hashing, sessions, CSRF |
| Jobs/Queues | §7.2.10 | jobs.js | ✅ createJobQueue, createScheduler, cron parser |
| Incremental | — | incremental.js | ✅ File hash cache, dependency tracking |

**Missing:** @component server components, template() compilation to render functions, @signal/@computed decorator compilation.

---

## §8 CLI — Command Status

| Command | Described In | File | Status |
|---------|-------------|------|--------|
| `nodeon new` | §8.3 | new.no | ✅ Basic scaffolding (not full monorepo) |
| `nodeon init` | §8.2 | init.no | ✅ |
| `nodeon dev` | §8.4 | dev.no | ✅ Dev server with watch |
| `nodeon build` | §8.2 | build.no | ✅ Single + multi-file |
| `nodeon build --prod` | §13.1 | build-prod.no | ✅ Server + client + pre-render |
| `nodeon run` | §8.2 | run.no | ✅ Compile + execute |
| `nodeon check` | §8.2 | check.no | ✅ Type check only |
| `nodeon fmt` | §8.2 | fmt.no | ✅ Formatter |
| `nodeon lint` | §8.2 | lint.no | ✅ 7 rules, configurable |
| `nodeon test` | §8.2 | test.no | ✅ Delegates to vitest |
| `nodeon deploy` | §13.3 | deploy.no | ✅ Docker/Vercel/Fly |
| `nodeon generate` | §8.2 | generate.no | ⚠️ Basic — not entity/module level |
| `nodeon repl` | §8.2 | repl.no | ✅ Basic |
| `nodeon help` | §8.2 | help.no | ✅ |
| `nodeon version` | §8.2 | help.no | ✅ |
| `nodeon start` | §8.2 | — | ❌ Not implemented |
| `nodeon doctor` | §12.1 | — | ❌ Not implemented |
| `nodeon eject` | §2.6 | — | ❌ Not implemented |
| `nodeon db` | §8.2 | — | ❌ Not implemented (migrate/rollback/seed/reset/status) |
| `nodeon bundle` | §8.2 | — | ❌ Not implemented |
| `nodeon upgrade` | §8.2 | — | ❌ Not implemented |
| `nodeon migrate` | §8.2 | — | ❌ Not implemented (codemods) |
| `nodeon doc` | §8.2 | — | ❌ Not implemented |

---

## §9 Generators — What's Missing

The architecture describes `nodeon generate entity user` creating **10 files** (model, migration, types, validators, service, API, pages×2, tests×2). Current `generate.no` exists but does NOT implement the full entity/module generators with template files.

**Missing:**
- Entity generator (10-file scaffolding)
- Module generator (orchestrates entity + service + API + pages + tests)
- Template file system (`*.no.tmpl`)
- Generator types: page, component, island, service, middleware, migration, job

---

## §10 Database — What's Missing

`packages/db/` exists with: `database.no`, `query-builder.no`, `schema.no`, `migrations.no`, `index.no`.

**Missing:**
- `nodeon db migrate/rollback/seed/reset/status` CLI commands
- Auto-diff migrations (`nodeon db diff`)
- Connection pooling
- Multiple drivers (@nodeon/db-postgresql, @nodeon/db-sqlite)
- `nodeon db studio` (web GUI)

---

## §12 Developer Experience — What's Missing

| Item | Status |
|------|--------|
| Structured error messages (E0100+) | ✅ Done |
| `nodeon doctor` | ❌ Not implemented |
| Framework error codes (N0001+) | ❌ Not implemented |
| HMR (Hot Module Replacement) | ❌ Not implemented |
| Source map debugging | ⚠️ Source maps generated but no DAP adapter |

---

## Priority Action Items (What to Build Next)

### Tier 1 — High Impact, Enables Everything Else

1. **`nodeon doctor`** — Environment health check (Node version, deps, db, config)
2. **`nodeon db`** — Wire packages/db to CLI (migrate, rollback, seed, reset, status)
3. **Full entity generator** — `nodeon generate entity user` → 10 files
4. **CompilerPlugin interface** — Enable Nova to hook into compilation
5. **Decorator execution** — @service/@inject/@page/@api compile to real code

### Tier 2 — Framework Completeness

6. **`nodeon eject`** — Export as plain JS project
7. **`nodeon start`** — Start production server (run dist/server/index.js)
8. **Full monorepo `nodeon new`** — Generate apps/web, apps/api, packages/shared, packages/db, etc.
9. **CONTRIBUTING.md** — Setup guide, PR process, coding style
10. **Framework error codes (N0001+)** — Nova-specific diagnostics

### Tier 3 — Polish

11. **`nodeon bundle`** — Single-file distribution bundle
12. **`nodeon upgrade`** — Self-update mechanism
13. **Environment profiles** — .env.development, .env.production, .env.test
14. **HMR architecture** — WebSocket-based hot reload for dev server
15. **`nodeon doc`** — Documentation generator from comments
