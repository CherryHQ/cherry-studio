# Renderer Architecture

This is the canonical reference for how `src/renderer/` is organized: directory responsibilities, dependency direction, and the rules that keep them enforceable.

Renderer code is organized along **two orthogonal axes** — **type** (what kind of artifact it is) and **domain** (which business domain owns it) — with dependencies flowing **strictly downward**, and a **closed top-level**: no capability ever earns its own top-level directory.

## 1. Two Axes

| Axis | Question it answers | Values |
|---|---|---|
| **Type** | What kind of artifact is this? | page / component / hook / service / util / … |
| **Domain** | Which domain owns it? | a specific business domain (chat, knowledge, agent, …) **\|** `shared` (no single owner) |

- `features/<domain>/` is a full **row** on the domain axis: it spans every type column for one domain (its own pages, components, hooks, services, utils). This is why a feature is "cross-cutting" — it cuts across the type buckets.
- The top-level type buckets (`components/`, `pages/`, `hooks/`, `utils/`, …) are the cells of the **`shared` row**: they hold **only** the cross-domain / standalone remainder.
- The meaningful comparison is **cell-to-cell within a column** (`features/chat/components/` ↔ top-level `components/`), never `features/` ↔ `components/` (a category error: a row is not a cell).

## 2. Layers & Dependency Direction

Four layers. Dependencies may only flow **downward** (1 → 2 → 3 → 4).

| # | Layer | Directories | Role |
|---|---|---|---|
| 1 | **App / composition** | `windows/`, `routes/`, top-level `pages/` (cross-domain shells only) | Entry points, provider mounting, router, app shell; composes features |
| 2 | **Domain** | `features/<domain>/` | One business domain's vertical slice; mutually isolated |
| 3 | **Shared** (no single owner) | `components/` → `hooks/` / `services/` → `utils/` / `data/` / `ipc/` / `workers/`; plus `config/` / `i18n/` / `assets/` / `types/` | Cross-domain reusable artifacts |
| 4 | **Primitives** | `packages/ui` (`@cherrystudio/ui`), `@shared`, `@logger` | App-agnostic foundation |

Rules:

- **Within the type axis**: `window → page → component → primitive` (UI composition; detailed in §2.1).
- **Along the domain axis**: a domain row may depend on the shared layer, primitives, and its own internals; it must **never** import a sibling domain row; the shared layer must **never** depend up on a domain row.
- **Inside the shared layer**: `components` (UI) → `hooks` / `services` (behavior / runtime) → `utils` / `data` / `ipc` (pure / infra) → primitives. No shared module renders into or imports from a higher layer.

### 2.1 Type-Axis Composition Chain

The type axis is a strict UI composition order: each kind composes the one below it and never imports the one above.
It is orthogonal to the domain axis (§1) — a `page` may be domain-owned (`features/<domain>/pages/`) or a top-level shell, but its composition rules are the same either way.

| Kind | Composes / may import | Must not import |
|---|---|---|
| `window` | router, app-wide providers, pages, features, shared, primitives | — (imported by no one) |
| `page` | components, feature content, shared, primitives | another `page`, a `window` |
| `component` | other components, primitives, shared behavior (`hooks` / `services` / `utils`) | `page`, `window`, `features` |
| `primitive` | third-party only | any `@renderer/*` / app layer |

**Primitive requirements** (`packages/ui` and `@shared`):

- `packages/ui` (`@cherrystudio/ui`) holds app-agnostic UI primitives (Shadcn + Tailwind). It imports only third-party packages and **never** `@renderer/*`; it carries no business, domain, or data-layer knowledge.
- `@shared` holds **cross-process** types, contracts, and pure logic, importable by both `main` and `renderer` and depending on no app layer. **Cross-process is the entry gate, not a description**: logic reachable from only one process stays in that process's own layer. For `@shared`'s internal layout, its two invariants (cross-process; no mutable runtime state), and the closed top-level set, see [Shared Layer Architecture](./shared-layer-architecture.md).
- Primitives are the leaves: everything may import them; they import no app code.

## 3. Directory Responsibilities

Target layout (in-flight directories pending migration are listed in §8):

```text
src/renderer/
├── windows/      # App      — per-window entry roots (MainApp/SettingsApp/SubWindowApp) + shell
├── routes/       # App      — route definitions
├── pages/        # App      — cross-domain shell pages only (domain pages live in features)
├── features/     # Domain   — one business domain per dir
│   └── <domain>/ #            index.ts (sole public API) + pages/ components/ hooks/ services/ utils/
├── components/   # Shared    — cross-domain, app-aware, presentational UI
├── hooks/        # Shared    — cross-domain hooks
├── services/     # Shared    — non-component singletons / runtime logic
├── utils/        # Shared    — cross-domain pure functions
├── data/ ipc/ workers/  # Shared infra — data access, IpcApi bridge, web workers
├── config/       # Shared    — app-global constants only
└── i18n/ assets/ types/ # Shared — locale, static assets, cross-domain types

packages/ui (@cherrystudio/ui)  # Primitive — app-agnostic design system
src/shared                       # Primitive — cross-process types / contracts / pure logic
```

| Directory | Responsibility | May depend on (downward) | Must not |
|---|---|---|---|
| `windows/` | Multi-window entry points; mount providers, router, shell | every lower layer | be imported by anyone |
| `routes/` | Route definitions pointing at pages | features, shared, primitives | be imported by lower layers |
| `pages/` (top-level) | **Only** cross-domain shell / composition pages; domain pages move into `features/<domain>/pages/` | features, components, shared | import another `pages/<page>` (cross-page coupling) |
| `features/<domain>/` | One **business domain**'s vertical slice (its pages/components/hooks/services/utils); curated `index.ts` is the sole public entry | shared layer, primitives, its own internals | (1) import a sibling feature (2) be imported by the shared layer (3) hold non-domain / cross-cutting / domain-agnostic infra |
| `components/` | App-level **shared UI**: cross-page, no domain knowledge, app-aware, presentational | packages/ui, other components, hooks, services, utils, @shared | import features; import pages; own a domain's data flow |
| `services/` | App-level **singletons / runtime logic** — plain modules, **no components or JSX** | utils, data, ipc, @shared | import features; import pages; import components; render UI; call React hooks |
| `hooks/` | **Cross-domain** reusable hooks | services, utils, data, @shared | import features/pages/components; retain a domain's hooks once that domain has its own feature (§4.4) |
| `utils/` | **Cross-domain** pure functions | @shared, third-party only | import any higher layer |
| `data/`, `ipc/`, `workers/` | Foundational subsystems (data layer, IPC bridge, web workers) | utils, @shared | import features/pages/components |
| `config/`, `i18n/`, `assets/`, `types/` | **App-global** config / locale / static assets / shared types only; domain-specific entries move into the owning feature | — | hold domain-specific content |
| `packages/ui` | App-agnostic design system (Shadcn + Tailwind primitives + generic composites) | third-party only | import any `@renderer/*` |

**Routing `services/` vs `hooks/` vs `utils/`.** The decisive test is the module's *shape*: pure / stateless → `utils/`; uses React lifecycle / state / context → `hooks/`; a stateful class owning state / resources → a `Service` / `Manager` (top-level `services/` when cross-domain); renders JSX → `components/` / `pages/`.
The authoritative table is [Naming Conventions §5.2](./naming-conventions.md).
These top-level buckets hold cross-domain pieces; a small **domain-specific** piece may stay here until its domain earns a `features/<domain>/`, then it moves in (the §4.4 promotion rule).

**Providers.** A React context provider is a **component**, not a service — `services/` holds non-component logic only.
App-wide providers (theme, command, context-key, notification) live in the shared tier (they are components) and are mounted by `windows/` (a downward `window → component` edge); domain-owned providers live in their feature.
A provider's reusable, non-React logic belongs in `@shared` or `services/`, not in the provider component itself.

## 4. `features/` Definition

> A `features/<domain>/` is a **self-contained business-domain module** — a full row on the domain axis that co-locates the pages, components, hooks, services, and utils for **one** business domain in a single tree, exposing its public API through a curated `index.ts`.

- **Promotion, not default.** A domain earns a `features/<domain>/` home only once it is large and multi-file; a small domain stays as single files in the shared buckets. Do not pre-create a feature for an anticipated module. (This is the §4.4 promotion rule, applied per domain.)
- **Business domains only.** Cross-cutting capabilities (e.g. a command/keybinding system), domain-agnostic infrastructure (`data`, `ipc`), and the app shell do **not** live in `features/`.
- **Closest industry match** is bulletproof-react's `features/` (a self-contained domain folder). It is **not** FSD's fine-grained "feature" (a single business action) and **not** Nx's `type:feature` (a role that splits a domain across typed libs).

## 5. Public API & Boundary Enforcement

- **Single entry.** Each feature exposes exactly one curated `index.ts` (explicit named exports, **no `export *`**). External consumers import the barrel; reaching into a feature's internal files is forbidden. (VS Code applies the same rule: one contribution may import only another's single public `common/` API, never its internals.)
- **Mechanical enforcement.** Boundaries are enforced by lint, not by convention alone. Configure `import/no-restricted-paths` zones: `components`/`hooks`/`utils`/`services` may not import `features`/`pages`; `pages` may not import another `pages`; `packages/ui` may not import `@renderer/*`. Roll out at `warn` to quantify existing violations, then tighten to `error`.

## 6. Top-Level Governance

> The top level is a **closed set of categories**, not an open list of modules. A new capability is placed **inside** an existing category by decomposing along the type axis; it never earns a new top-level directory.

This is the renderer-specific application of [Naming Conventions §4.8](./naming-conventions.md) (top-level directories are closed by default): a capability fails §4.8's *necessity* test because existing buckets can host it by decomposition.

Corollary — **capabilities decompose, they do not relocate as a blob**: route each part by its shape (§3) — non-component logic → `services/` (or `@shared/` if cross-process), React providers and UI → `components/`, hooks → `hooks/`, types → `@shared/`. Nothing is added to the top level.

This is why a command/keybinding/menu system is not a feature and not a top-level directory: it decomposes **by shape** across existing homes, one cell per type:

| Part | Nature | Home |
|---|---|---|
| keybinding definitions + resolution, context-expr eval, menu resolution, `ContextKeyService`/`MenuRegistry` blueprints | cross-process pure logic + class blueprints | `@shared/utils/command` |
| command / keybinding / menu types | cross-process types | `@shared/types/command` |
| shortcut-label, `KeyboardEvent` → binding, display-state helpers | renderer-only pure logic | `utils/command` |
| context objects + their accessor hooks, `useResolvedCommand`/`useResolvedCommandMenu`, `useCommandShortcuts` | React contexts + hooks | `hooks/command` |
| `CommandProvider`/`CommandContextKeyProvider`, `CommandMenus`, `CommandControls` | React components | `components/command` |

A `Provider` returns JSX so it is a **component**; the contexts it fills and the hooks that read them are non-JSX and sink one tier below to `hooks/command`; pure logic sinks to `utils/command` (renderer-only) or `@shared/utils/command` (cross-process), and types to `@shared/types/command`. Nothing goes to `services/`, and `@shared` keeps only what **both** processes use — a resolver consumed only by the renderer (e.g. `getCommandShortcutLabel`) belongs in `utils/command`.
After decomposition every edge is downward (`component → component`/`hook`, `hook → hook`); the former `component → feature` and `hook → feature` inversions are gone, and nothing is a "feature".

## 7. Anti-Patterns

- A shared bucket (`components/`/`hooks/`/`utils/`) importing `features` or `pages` (a reverse / upward edge).
- `pages/X` importing `pages/Y` (cross-page coupling).
- Domain-specific artifacts left in a top-level type bucket (backup managers, model/provider widgets, etc.).
- Treating a cross-cutting capability as a peer feature.
- Opening a new top-level directory for a single capability.
- A feature using `export *`, or an external consumer deep-importing a feature's internals.
- A hand-rolled `components/layout/` bucket — "layout" is not a layer here: route layouts live in `routes/` (TanStack layout routes), layout primitives (`Box`/`Stack`/`Grid`) in `packages/ui`, app shell in `windows/`.

## 8. Target vs Current State

This document describes the **target** architecture. The renderer has not yet been migrated to it; the gaps below are known and tracked. Migration is deferred and intentionally out of scope here.

**Already aligned:**

- `packages/ui` has no back-imports from `@renderer/*` (the primitive layer is clean).
- The command capability is decomposed by shape with no `component`/`hook → feature` edges: the renderer cells (`utils/command`, `hooks/command`, `components/command`) are in place. Its cross-process cell currently sits at the top-level `@shared/command` and is slated to dissolve into `@shared/utils/command` + `@shared/types/command` — tracked in [Shared Layer Architecture §6](./shared-layer-architecture.md).

**Pending (current deviations from the target):**

This table lists definite mis-classifications and structural violations only.
A small domain's pieces (components, pages, hooks, services, utils) may legitimately sit in the shared type-buckets until that domain earns a `features/<domain>/`; that promotion is a separate per-case judgment (§4.4) and is not prescribed here.

| Area | Current state | Target |
|---|---|---|
| App shell | shell chrome in `components/layout/` is partly window-specific, partly cross-window | decompose by ownership: main shell (`AppShell`, `AppShellTabBar`, tab drag) → `windows/main/`; sub-window chrome (`SubWindowControls`, `SubWindowTitle`) → `windows/subWindow/`; cross-window building blocks (`TabRouter`, `TabIcon`, `titleBar`, tab icons) → shared `components/` (e.g. `components/shell/`). No new `windows/shell/` bucket |
| `components/app/Navbar` | a shared page-header component (`Navbar`/`NavbarCenter`/…) consumed by ~10 pages, mislabeled under an `app/` (shell) subdirectory | it is shared UI, **not** shell: keep in `components/` (regroup as `components/Navbar/`) |
| `components/app/Sidebar` | no importers found — likely dead code | verify; remove if unused, otherwise place by its actual consumer (window shell → `windows/`, reusable UI → `components/`) |
| Cross-page imports | `pages/<domain>/` import each other (`pages → pages` coupling) | a page must not import another page; route shared needs through the shared layer |
| `transport/` | a chat-domain capability (`IpcChatTransport`, `TopicStreamSubscription`) occupies its own top-level directory | belongs to its owning domain (chat); not its own top-level directory (§4.8) |
| `queue/` | a single-file capability (`NotificationQueue`) occupies its own top-level directory | belongs with its owning logic; not its own top-level directory (§4.8) |
| `context/` | redundant by-kind bucket (providers are components); mixes global and domain providers | dissolve: app-wide providers → shared tier (components), mounted by windows; domain providers → their owning domain; none → `services/` |
| `config/` | by-kind bucket mixing app-global constants (`constant.ts` ~80 consumers, `env.ts`) with domain static data (`providers.ts` ~1.4k lines, `models/`, `agent.ts`, …) | dissolve: app-global residue (`constant.ts`, `env.ts`) stays; domain config/data → its owning domain |
| `store/`, `databases/` | v1 Redux / Dexie | removed during the v2 refactor (do not model) |
| Boundary enforcement | none | `import/no-restricted-paths` zones (§5) |

Known reverse/coupling edges at time of writing: ~35 `pages → pages` cross-imports (the command-driven `component`/`hook → feature` edges have been resolved). These are the violations the §5 lint rules are designed to catch and prevent.

## 9. Industry References

| Claim | Source |
|---|---|
| Unidirectional dependencies; no cross-feature imports | bulletproof-react — `docs/project-structure.md` |
| Same-layer slices cannot import each other, so a widely-depended-on module must sit on a strictly lower layer; `shared` is the lowest layer | Feature-Sliced Design — `reference/layers`, `reference/public-api` |
| Tag cross-cutting capabilities as a lower type (`type:ui`/`util`) and enforce direction with lint | Nx — `enforce-module-boundaries` |
| Command/keybinding services live in the `platform/` foundation layer; feature contributions are isolated | VS Code — Source Code Organization |
| A domain-agnostic, non-differentiating capability is a generic subdomain, not a peer of core domains | DDD strategic design |
| App-wide singletons live in Core; features do not import each other | Angular — Core / Shared / Feature modules |

## Related

- [Naming Conventions §4.10](./naming-conventions.md) — feature-module placement and naming.
- [Architecture Overview](./architecture-overview.md) — monorepo structure and cross-process layering.
