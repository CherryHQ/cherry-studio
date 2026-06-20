# Shared Layer Architecture (`src/shared` / `@shared`)

This is the canonical reference for what belongs in `@shared`, how it is organized, and the rules that keep its top level from sprawling. It owns the `@shared`-internal rules; [Architecture Overview](./architecture-overview.md), [Renderer Architecture](./renderer-architecture.md), and [Naming Conventions](./naming-conventions.md) reference it.

`@shared` is the **cross-process primitive layer** — Layer 4 in [Renderer Architecture §2](./renderer-architecture.md). It depends on no app code and is importable by `main`, `renderer`, and `preload`.

## 1. Two Invariants

Everything in `@shared` must satisfy **both**, or it does not belong here.

### 1.1 Cross-process

A module belongs in `@shared` only if **both** `main` and `renderer` actually use it — types included, no exceptions.

- **Why**: `@shared` is the single source of truth shared across the process boundary; single-process code already has a process to live in.
- Reachable from only one process → it lives in that process's own layer (`src/main/*` or `src/renderer/{utils,hooks,services}`).
- **No speculative placement.** If something only *might* become cross-process, write it in `main`/`renderer` first and move it here once it actually crosses. Do not park it in `@shared` for a possibility — the common failure is a type or util added "in case", then never used cross-process and left as cruft.

### 1.2 No mutable runtime state

`@shared` exports **types, pure functions, and immutable data only**. It exports **no class-instance singletons** (services / managers / registries) and nothing that holds runtime-mutable state.

- **Why**: `main` and `renderer` are separate V8 realms; an `@shared` module is loaded **once per process**. A "shared singleton" is a fiction — it silently becomes N per-process instances that diverge. Mutable state has no coherent shared owner; it belongs to the process whose lifecycle and context it reflects.
- **`new` is not the test — runtime mutability + identity is.** `new` is allowed only to build immutable data that is then frozen and exported (a `Map` / `Set` / `RegExp` lookup built once from static data and never mutated, e.g. the private `commandMap` in `command/definitions.ts`).
- A stateful class ships only its **definition (blueprint)** from `@shared`; its **instance** is created per-process. Example: `ContextKeyService` is defined cross-process, but `new ContextKeyService()` lives in the renderer's `CommandContextKeyProvider`.

| Allowed | Banned |
|---|---|
| `type` / `interface` / `enum`, schema-derived types | `export const x = new XService()` (any exported instance singleton) |
| pure functions, predicates, converters | a registry / manager / service instance |
| immutable data — consts, definitions, frozen lookups built via `new Map`/`Set` | any module-level value holding runtime-mutable state |
| stateful-class **definitions** (blueprints) | a live **instance** of such a class |

## 2. The Closed Top-Level Set

The top level is a **closed set** — this is [Naming Conventions §4.8](./naming-conventions.md) (top-level closed by default) applied to `@shared`. Exactly these five, by three principled categories:

| Dir | Category | Why it earns a top-level home |
|---|---|---|
| `ai` | **Core domain** | Cherry Studio *is* an AI product; AI's cross-process contracts and pure logic are first-class (mirrors `src/main/ai/`). Holds AI's cross-process slice only — not AI UI or per-process services. |
| `data` | **Cross-process infra** | The data layer's cross-process contracts: API entity/request types, cache/preference/bootConfig schemas, migration mappings, presets. Framework-like, domain-agnostic. |
| `ipc` | **Cross-process infra** | The IpcApi framework: route `define` helpers, request + event schemas, error model, and shared types (`IpcContext`, `WindowId`). Domain-agnostic. |
| `types` | **Shape bucket** | Cross-process type declarations with no single owner. |
| `utils` | **Shape bucket** | Cross-process pure logic plus its supporting constants and class blueprints. |

**Governance rule**: a new capability **never** earns a new top-level dir. It is either (a) the core domain [only `ai`], (b) genuine cross-process infrastructure, or (c) decomposed **by shape** into `types` / `utils`. Anything else → `types` / `utils`.

Naming respects [§4.9](./naming-conventions.md): `ai` / `data` / `ipc` are singular namespaces, `types` / `utils` are plural buckets.

## 3. Shape: `types` vs `utils`

`@shared` has only **two** shape buckets. With no UI, no React, and no per-process runtime, the renderer's rich shapes (`components` / `hooks` / `services` / `pages`) collapse to **declarations vs pure logic**.

| `types/` | `utils/` |
|---|---|
| type aliases, interfaces, enums, schema-derived types | pure functions, predicates, converters |
| (plus the small consts a type needs) | plus the constants / static data those functions need, and stateful-class blueprints |

Routing between the two follows the [Naming Conventions §5.2](./naming-conventions.md) route-by-shape table.

### 3.1 File vs subdirectory, and barrels

- **A single `.ts` file is the default.** Most topics are one file — `types/<topic>.ts`, `utils/<topic>.ts`, imported directly. Promote to a subdirectory only when the topic actually owns multiple files ([Naming Conventions §4.4](./naming-conventions.md)); never pre-create one.
- **A topic subdirectory has exactly one `index.ts`** as its public API — `types/<topic>/index.ts`, `utils/<topic>/index.ts`, explicit named exports, no `export *`. The import surface is then identical whether the topic is a file or a subdir (`@shared/utils/<topic>` either way), and the subdir's other files stay private behind it.
- **The bucket roots `types/` and `utils/` have no `index.ts`.** A bucket is a category, not a module — a root barrel re-exporting every file buys no aggregate API and only adds churn and import-cycle risk on every addition. Import the specific file or topic, never the bucket.

### 3.2 Constants & static data

- **Default: a constant lives in its domain/topic single-file**, beside the logic it serves (AI model defaults → `ai/`; a file-type list → `utils/file/`).
- **`utils/constants.ts` is NOT a bucket.** It carries only the genuinely **global, cross-process** residue (`KB`/`MB`/`GB`, `APP_NAME`). Add to it only when you are 100% certain a constant is app-global and cross-cutting; if it belongs to any domain, it goes in that domain's file. — **Why**: this is precisely the guardrail the old `config/constant.ts` lacked, which is how it grew into an 82-importer junk drawer (§6.1).
- **Single-process constants → leave `@shared`** (Invariant 1.1).
- **There is no `config/` bucket.** A constant is data; a frozen value in its domain file (or `utils/`) expresses everything a `config/` dir would, without inviting unrelated globals.

### 3.3 Stateful-class blueprints

A stateful class's **definition** is pure code, so it rides in its topic module under `utils/` — precedent: the stateful `MatchPatternMap` class in `utils/blacklistMatchPattern.ts`. `@shared` has **no `services/` bucket**, because services are per-process (Invariant 1.2).

## 4. Placement Decision

Two gates, in order, then categorize:

1. **Cross-process?** Reached by both processes — no → it goes to a process layer (`src/main/*` or `src/renderer/*`).
2. **Stateless / immutable?** No exported instance, no mutable state — no → only the blueprint and static data stay; the **instance** goes per-process.
3. **Categorize**: core domain (`ai`) / infra (`data`, `ipc`) / shape (`types`, `utils`). Not one of the first two → decompose by shape into `types` / `utils`; **never** open a new top-level dir.

## 5. Anti-Patterns

- **Exported instance singleton** — `export const x = new XService()`, or any registry / manager / service instance. Violates Invariant 1.2. *(Current: `command/menus.ts`'s `menuRegistry`; see §6.)*
- **Single-process code in `@shared`** — main-only or renderer-only logic placed here for convenience. Violates Invariant 1.1. *(Current epicenter: `config/constant.ts`; see §6.)*
- **Junk-drawer file or dir** — a `config/` bucket or a `constant.ts` accumulating unrelated globals across domains and processes. Decompose by domain + process; do not relocate as a blob.
- **A new top-level dir per capability** — every capability decomposes by shape; the top level is closed (§2).
- **A stateful "service" in `@shared`** — state has no coherent shared owner; it belongs to `main` or `renderer`.

## 6. Migration (target vs current — deferred, tracked)

The architecture above is the **target**; `@shared` is not yet migrated to it. Known deviations:

| Area | Current | Target |
|---|---|---|
| `command` | top-level `@shared/command/` | decompose by shape: pure logic + static data + `ContextKeyService`/`MenuRegistry` blueprints → `@shared/utils/command/`; types → `@shared/types/command.ts` |
| `menuRegistry` | exported instance singleton (`command/menus.ts`) | pure `resolveMenu(MENU_CONTRIBUTIONS, options)` — no exported instance (Invariant 1.2) |
| `file` | top-level `@shared/file/` | path/url/canonicalize logic → `utils/file/`; schemas + types → `types/file/` |
| `shortcuts` | top-level `@shared/shortcuts/` | `tokens` → `utils/`; `types` → `types/` |
| `externalApp` | top-level `@shared/externalApp/` | `EXTERNAL_APPS` data → `utils/`; types → `types/` |
| `config` | by-kind junk drawer | dissolve (§6.1) |
| `utils/index.ts` | misc utilities implemented in a bucket-root file | split into topic files (`utils/<topic>.ts`); no bucket-root `index.ts` (§3.1) |
| `IpcChannel.ts` | 18 KB v1 channel enum at the root | v1 legacy; folded into `ipc/` as the IpcApi migration retires channels — not part of this governance |

### 6.1 `config` dissolution — `constant.ts` itemized

`config` is a by-kind junk drawer. Only `KB`/`MB`/`GB` and `APP_NAME` are genuinely global cross-process constants; most entries move by domain, and several must **leave `@shared`** (Invariant 1.1). `constant.ts` has ~82 importers, so this is a decomposition, not a relocation. Targets below are **directional** — confirm each item's actual consumer process before moving (`ZOOM_LEVELS`, for instance, may be cross-process via the main menu and stay).

| `config` content | Target | Note |
|---|---|---|
| `prompts.ts`, `providers.ts` | `ai/` | AI-domain data |
| `types.ts` (LAN / MCP / webview types + `LAN_TRANSFER_*` consts) | `types/` | |
| `logger.ts` (`LogLevel` / `LEVEL_MAP`) | `@logger` or `types/` | decide with the logger owner |
| `code-languages.ts` (3678-line table), `languages.ts` | `utils/` | static reference data |
| `constant.ts` → `KB`/`MB`/`GB`, `APP_NAME` | `utils/constants.ts` | the only genuinely-global residue |
| `constant.ts` → file-ext lists (`imageExts` … `knowledge*Exts`, `textExts`, `customTextExts`) | `utils/file/` | file / knowledge domain data |
| `constant.ts` → `API_SERVER_DEFAULTS` | api-server (main) | |
| `constant.ts` → `ZOOM_*`, `MIN_WINDOW_*` | renderer / window | `ZOOM_OPTIONS` is antd-shaped + renderer-only → **leaves `@shared`** |
| `constant.ts` → `FeedUrl` / `UpdateConfigUrl` / `UpdateMirror` / `DEFAULT_TIMEOUT` / `occupiedDirs` | update (main) | `occupiedDirs` is `@deprecated` v1 → delete |
| `constant.ts` → terminal block (`MACOS_TERMINALS*`, AppleScript, ~200 lines) | main | main-only shell logic → **leaves `@shared`** |
| `constant.ts` → `codeCLI` / `CHERRYIN_CONFIG` / `GitBashPath*` / model defaults (`DEFAULT_TEMPERATURE` …) | code-cli / auth / `ai` | by domain |

## 7. Related

- [Architecture Overview](./architecture-overview.md) — process model and the `@shared` one-line summary.
- [Renderer Architecture §2–§3](./renderer-architecture.md) — the layer model and how the renderer depends on `@shared`; §6 owns command's **renderer-side** cells (this doc owns its `@shared` cell).
- [Naming Conventions §4.8](./naming-conventions.md) — top-level closed by default (this doc is its `@shared` application); §4.9 singular vs plural; §5.2 route-by-shape.
