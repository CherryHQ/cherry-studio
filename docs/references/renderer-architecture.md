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
| 2 | **Domain** | `features/<domain>/` | One business domain's vertical slice; mutually isolated from sibling features (consumed from above by the app layer) |
| 3 | **Shared** (no single owner) | `components/` → `hooks/` / `services/` → `utils/` / `data/` / `ipc/` / `workers/`; plus `i18n/` / `assets/` / `types/` | Cross-domain reusable artifacts |
| 4 | **Primitives** | `packages/ui` (`@cherrystudio/ui`), `@shared`, `@logger` | App-agnostic foundation |

Rules:

- **Within the type axis**: `window → page → component → primitive` (UI composition; detailed in §2.1).
- **Along the domain axis**: a domain row depends only **downward** — on the shared layer, primitives, and its own internals; it **never** imports a sibling domain row, and the shared layer **never** imports it (an upward edge). Its only legal *consumers* are therefore the app layer (`windows/` / `routes/` / top-level `pages/`): `window → feature` and `page → feature` are the legal inbound edges — a feature is built to be imported from above. Cross-domain needs route **down** (extract the shared piece into the shared layer) or **up** (the app layer composes both features), never sideways.
- **Inside the shared layer**: `components` (UI) → `hooks` / `services` (behavior / runtime) → `utils` / `data` / `ipc` / `workers` (stateless helpers + infra foundation) → primitives. The foundation members (`utils` / `data` / `ipc` / `workers`) are co-equal and may import one another — a `utils` module calling `data` / `ipc` is a **downward infra call, not an upward edge**. No shared module renders into, or imports from, a higher layer (`components` / `hooks` / `services` / `features` / `pages`).

**Why the two banned edges matter** — both keep the dependency graph a strict downward DAG. `shared → feature` (an upward edge) would make a *shared* module secretly domain-coupled, open `feature → shared → feature` cycles, and pin the feature into the eager shared chunk (defeating per-feature code-split). `feature → feature` (a sideways edge) would leak one domain's blast radius into another, bind callers to internals the barrel (§5) declares unstable, and block clean deletion (features get reshaped/removed in v2). Both are banned as **categories**, not case-by-case, so one `import/no-restricted-paths` rule enforces them (§5; sources in §9).

### 2.1 Type-Axis Composition Chain

The type axis is a strict UI composition order: each kind composes the one below it and never imports the one above.
It is orthogonal to the domain axis (§1) — a `page` may be domain-owned (`features/<domain>/pages/`) or a top-level shell, but its composition rules are the same either way. A feature-internal piece obeys the **identical** type-axis direction rules as its top-level counterpart; its one extra freedom is that it may import its **own** feature's siblings directly (internal cohesion needs no barrel — the §5 barrel is only the *external* door).

| Kind | Composes / may import | Must not import |
|---|---|---|
| `window` | router, app-wide providers, pages, features, shared, primitives | — (imported by no one) |
| `page` | components, feature content, shared, primitives | another `page`, a `window` |
| `component` | other components, primitives, shared behavior (`hooks` / `services` / `utils`) | `page`, `window`, `features` |
| `primitive` | third-party only | any `@renderer/*` / app layer |

**Same-kind peering vs same-slice isolation — two senses of "same layer".** Within one kind, peers compose freely: `component → component`, `hook → hook`, `util → util` are normal edges (a component is built from other components); the type axis only forbids importing **up** a kind (`component → page`/`window`/`feature`). Do not conflate this with the **domain-axis** rule that sibling *features* (the same slice layer, §2) may never import each other — `component → component` is allowed while `feature → feature` is not, because they sit on different axes. Two riders: (a) `page` is the one kind where same-kind peering is **also** banned (`page → page`, §7); (b) same-kind peering still obeys the domain axis — a shared component still can't reach up into a feature, nor a feature-A component sideways into feature-B (§2). `service` / `util` peering is allowed on the same terms but must stay **acyclic**.

**Primitive requirements** (`packages/ui` and `@shared`):

- `packages/ui` (`@cherrystudio/ui`) holds app-agnostic UI primitives (Shadcn + Tailwind). It imports only third-party packages and **never** `@renderer/*`; it carries no business, domain, or data-layer knowledge.
- `@shared` holds **cross-process** types, contracts, and pure logic, importable by both `main` and `renderer` and depending on no app layer. **Cross-process is the entry gate, not a description**: logic reachable from only one process stays in that process's own layer. For `@shared`'s internal layout, its two invariants (cross-process; no mutable runtime state), and the closed top-level set, see [Shared Layer Architecture](./shared-layer-architecture.md).
- Primitives are the leaves: everything may import them; they import no app code.

## 3. Directory Responsibilities

Target layout (in-flight directories pending migration are listed in §8):

```text
src/renderer/
├── windows/      # App      — per-window entry roots (MainApp/SubWindowApp) + shell
├── routes/       # App      — route definitions
├── pages/        # App      — cross-domain shell pages only (domain pages live in features)
├── features/     # Domain   — one business domain per dir
│   └── <domain>/ #            index.ts (sole public API) + pages/ components/ hooks/ services/ utils/
├── components/   # Shared    — cross-domain, app-aware, presentational UI
├── hooks/        # Shared    — cross-domain hooks
├── services/     # Shared    — non-component singletons / runtime logic
├── utils/        # Shared    — cross-domain stateless functions
├── data/ ipc/ workers/  # Shared infra — data access, IpcApi bridge, web workers
└── i18n/ assets/ types/ # Shared — locale, static assets, cross-domain types

packages/ui (@cherrystudio/ui)  # Primitive — app-agnostic design system
src/shared                       # Primitive — cross-process types / contracts / pure logic
```

| Directory | Responsibility | May depend on (downward) | Must not |
|---|---|---|---|
| `windows/` | Multi-window entry points; mount providers, router, shell | every lower layer | be imported by anyone |
| `routes/` | Route definitions pointing at pages | features, shared, primitives | be imported by lower layers |
| `pages/` (top-level) | **Only** cross-domain shell / composition pages; domain pages move into `features/<domain>/pages/` | features, components, shared, primitives | import another `pages/<page>` (cross-page coupling) |
| `features/<domain>/` | One **business domain**'s vertical slice (its pages/components/hooks/services/utils); curated `index.ts` is the sole public entry. Its **only** legal importers are the app layer (`windows`/`routes`/`pages`), via the barrel | shared layer, primitives, its own internals | (1) import a sibling feature (2) be imported by the shared layer or a sibling feature (3) hold non-domain / cross-cutting / domain-agnostic infra |
| `components/` | App-level **shared UI**: cross-page, no domain knowledge, app-aware, presentational | packages/ui, other components, hooks, services, utils, @shared | import features; import pages; own a domain's data flow |
| `services/` | App-level **runtime services**: a module owning retained state / resources / lifecycle (a singleton capability — class + suffix, [Naming §5.2](./naming-conventions.md)), **or** a stateless module promoted out of `utils/` by **outward side effects** or a forced dependency (routing procedure below). A multi-file topic forms `services/<topic>/` behind a barrel (§3.1). Plain modules, **no components or JSX**. A stateless helper does **not** belong here merely for calling `data` / `ipc` reads — route it to `utils/` | other services, utils, data, ipc, @shared | import features; import pages; import components; render UI; call React hooks |
| `hooks/` | **Cross-domain** reusable hooks | other hooks, services, utils, data, @shared | import features/pages/components; retain a domain's hooks once that domain has its own feature (§4.1) |
| `utils/` | **Cross-domain**, **stateless**, domain-agnostic functions (queries, conversions, predicates, formatters) — may call downward infra | other utils, @shared, data, ipc, workers, third-party | import `components` / `hooks` / `services` or any higher app layer; own retained state; perform outward side effects (routing procedure below); render UI |
| `data/`, `ipc/`, `workers/` | Foundational subsystems (data layer, IPC bridge, web workers) | utils, @shared | import features/pages/components |
| `i18n/`, `assets/`, `types/` | **App-global** locale / static assets / shared types only; domain-specific entries move into the owning feature | — | hold domain-specific content |
| `packages/ui` | App-agnostic design system (Shadcn + Tailwind primitives + generic composites) | third-party only | import any `@renderer/*` |

**Routing `services/` vs `hooks/` vs `utils/`.** Ownership first, then shape — run the tests in order and stop at the first hit:

0. **Ownership.** A module consumed by exactly **one** owner co-locates with that owner — inside its feature, or as a private satellite in `services/<topic>/` (§3.1) — and skips the shape tests below. Shape routing binds **shared** modules only.
1. **Renders JSX** → `components/` / `pages/`.
2. **Uses React lifecycle / state / context** → `hooks/`.
3. **Owns retained module-level state / resources / lifecycle** → `services/`, normalized to a class + singleton export with the `Service` / `Manager` suffix ([Naming Conventions §5.2](./naming-conventions.md) — including what counts as state).
4. **Stateless** → **`utils/` by default.** Promote to `services/` (plain camelCase name, **no** suffix) only for one of two reasons, stated in the PR:
   - **outward side effects** — the module *changes* something outside its own scope (e.g. opens a window, writes the clipboard; canonical list in [Naming §5.2](./naming-conventions.md) — logging does not count);
   - **dependency-forced** — it must import `services/`, which `utils/` may not. (Needing to import `hooks/` is never a routing reason — neither `utils/` nor `services/` may; it means a non-hook export is stranded in a `hooks/` file — fix that upstream.)

**Reads never promote**: calling `data` / `ipc` to fetch or query keeps a module in `utils/`.
The authoritative table is [Naming Conventions §5.2](./naming-conventions.md).
These top-level buckets hold cross-domain pieces; a small **domain-specific** piece may stay here until its domain earns a `features/<domain>/`, then it moves in (the §4.1 promotion rule).

**Providers.** A React context provider is a **component**, not a service — `services/` holds non-component logic only.
App-wide providers (theme, command, context-key, notification) live in the shared tier (they are components) and are mounted by `windows/` (a downward `window → component` edge); domain-owned providers live in their feature.
A provider's reusable, non-React logic belongs in `@shared` or `services/`, not in the provider component itself.

### 3.1 `services/<topic>/` Topic Directories

A **headless** capability (no UI) that outgrows one file grows **in place** into a `camelCase` topic subdirectory — `services/<topic>/` — holding its public face plus its **private, topic-specific satellites** (stateless helpers, per-instance classes, adapters, topic types). This is the middle step of the growth path `services/<topic>.ts` → `services/<topic>/` → `features/<domain>/` (§4.1), and the **terminal** form for capabilities that never grow UI. Existing residents: `services/aiTransport/`, `services/import/`, `services/notification/`. The main process applies the same rule ([Main Process Architecture](./main-process-architecture.md)).

| Rule | Meaning |
|---|---|
| One barrel, sole entry | exactly one curated `index.ts` (§5 topic-barrel rule); everything else is private to the topic |
| Satellites skip shape routing | a topic-**specific** helper lives here even though its shape says `utils/` — the §3 shape tests bind **shared** modules only; a **generic** helper (reads naturally with no topic context) still goes to `utils/` |
| Single consumer, or out | a satellite stays only while this topic is its sole consumer; a second consumer moves it to `utils/` (generic) or promotes it into the barrel (topic public API) |
| No UI, ever | no JSX and no React hooks inside; UI parts route into the shared buckets by shape (§3 / §6), and the domain promotes to `features/<domain>/` only once the §4.1 trigger holds |
| Plain internal names | files drop the topic prefix (the directory carries it) — `aiTransport/streamDispatchCoordinator.ts`, not `aiTransportStreamDispatchCoordinator.ts`; the `Service` / `Manager` suffix still marks only stateful singleton classes ([Naming §5.2](./naming-conventions.md)) |

## 4. `features/` Definition

> A `features/<domain>/` is a **self-contained business-domain module** — a full row on the domain axis that co-locates the pages, components, hooks, services, and utils for **one** business domain in a single tree, exposing its public API through a curated `index.ts`.
>
> *Self-contained* describes **internal cohesion** (all of one domain's parts live in one tree), **not** external unreachability: a feature is openly imported from above by the app layer (§2). It is isolated only **horizontally** — from sibling features.

- **Promotion, not default.** A domain earns a `features/<domain>/` home only once it is large and multi-file; a small domain stays as single files in the shared buckets. Do not pre-create a feature for an anticipated module. See **§4.1** for the operational trigger and a worked example.
- **Business domains only.** Cross-cutting capabilities (e.g. a command/keybinding system), domain-agnostic infrastructure (`data`, `ipc`), and the app shell do **not** live in `features/`.
- **Closest industry match** is bulletproof-react's `features/` (a self-contained domain folder). It is **not** FSD's fine-grained "feature" (a single business action) and **not** Nx's `type:feature` (a role that splits a domain across typed libs).

### 4.1 Promotion Rule — when a domain earns a feature

Promotion is **lazy and per-case** (§4), not a default — but it is a real path, not a directory doomed to stay empty: the rules above describe what the destination *looks like*. Until a domain qualifies, its pieces legitimately sit in the shared type-buckets (`pages/<domain>/`, `components/<domain>/`, `hooks/<domain>/`, …). (No `features/` directory exists yet — see §8.)

Operational trigger (guidance, not a hard gate) — promote when **all** hold:

- the domain already owns its **own page(s)** plus a **multi-file** spread of components/hooks/services across several shared buckets;
- those pieces are imported **mainly within the domain** — broad cross-domain reuse is instead the signal to push a piece **down** into the shared layer, not into a feature;
- folding them behind one barrel would **shrink** cross-bucket coupling, not merely relocate it.

Worked example — `chat` → `features/chat/`:

```text
# scattered today (shared type-buckets)        # promoted
pages/home/           chat page shell           features/chat/
components/chat/      ~288 files          →       ├── index.ts      # curated public API (named exports, no export *)
components/composer/  ~119 files                  ├── pages/        # ← pages/home
hooks/chat/                                       ├── components/   # ← components/chat + components/composer
services/…            chat-only services          ├── hooks/        # ← hooks/chat
                                                  └── services/     # ← chat-only services
```

After promotion: the app layer (`windows`/`routes`/`pages`) imports `@renderer/features/chat`'s barrel; nothing reaches into its internals (§5); and cross-surface runtime that *other* domains also use (e.g. the AI-stream transport, now at `services/aiTransport`) stays in the **shared** layer, **not** inside the feature.

## 5. Public API & Boundary Enforcement

- **Single entry.** Each feature exposes exactly one curated `index.ts` (explicit named exports, **no `export *`**). External consumers import the barrel; reaching into a feature's internal files is forbidden. Barrel rules — including *no nesting* and *enforced-entry-or-no-barrel* — are the cross-process set in [Naming §6.4](./naming-conventions.md); this is its feature-tier application. (VS Code applies the same rule: one contribution may import only another's single public `common/` API, never its internals.)
- **Lazy loading goes through the same door.** Dynamic `import()` obeys [Naming §6.4](./naming-conventions.md) rule 2 like any import: `React.lazy(() => import('@renderer/features/chat').then(m => ({ default: m.ChatPage })))` — map the named export at the call site rather than deep-importing an internal file for its default export. Only a feature's own code may lazy-load its internals.
- **Component directories.** A single-file component stays flat (`components/Foo.tsx`, no directory). Promote to a directory only when it owns private satellites (sub-components, hooks, helpers, styles); the main implementation is then a **named** file, and the directory exposes a barrel that closes the satellites off. The barrel is `index.ts` — **never `index.tsx`**: a re-export has no JSX, so a component's `Foo/index.tsx` is the classic double mistake here (implementation *and* wrong extension). The `index` name is reserved for the barrel ([Naming §6.4](./naming-conventions.md)):

  ```
  components/Foo.tsx          # single-file → flat, no directory
  components/Bar/             # multi-file → named impl + barrel door
    Bar.tsx                   #   main implementation (never index.tsx)
    components/BarRow.tsx     #   private satellite, closed off by the barrel
    index.ts                  #   .ts, not .tsx (re-export has no JSX): export { Bar } from './Bar'
  ```
- **Shared buckets carry no root barrel.** `types/`, `utils/`, and `services/` are *categories*, not modules: each has **no root `index.ts`** — consumers import the specific file or topic (`@renderer/types/<topic>`, `@renderer/utils/<topic>`, `@renderer/services/<topic>`), never the bucket root. A multi-file topic *subdirectory* exposes exactly one curated `index.ts` (named exports, **no `export *`**) and keeps its other files private; a single-file topic stays a flat `<topic>.ts` and is promoted to a subdirectory only when it actually owns multiple files. This mirrors [Shared Layer Architecture §3.1](./shared-layer-architecture.md) one-for-one — same rule, the bucket merely lives under `@renderer/*` instead of `@shared/*`.
- **Mechanical enforcement.** Boundaries are enforced by lint, not by convention alone. The `import/no-restricted-paths` zones are configured: `components`/`hooks`/`utils`/`services` may not import `features`/`pages`; `pages` may not import another `pages`; `packages/ui` may not import `@renderer/*`. The shared-layer edges are enforced at `error`; the sibling-page (`pages → pages`) edges remain at `warn` pending features-ization.

## 6. Top-Level Governance

> The top level is a **closed set of categories**, not an open list of modules. A new capability is placed **inside** an existing category by decomposing along the type axis; it never earns a new top-level directory.

This is the renderer-specific application of [Naming Conventions §4.8](./naming-conventions.md) (top-level directories are closed by default): a capability fails §4.8's *necessity* test because existing buckets can host it by decomposition.

Corollary — **capabilities decompose, they do not relocate as a blob**: route each part by its shape (§3) — non-component logic → `services/` or `utils/` per the §3 routing (or `@shared/` if cross-process), React providers and UI → `components/`, hooks → `hooks/`, types → `@shared/`. Nothing is added to the top level.

This is why a command/keybinding/menu system is not a feature and not a top-level directory: it decomposes **by shape** across existing homes, one cell per type:

| Part | Nature | Home |
|---|---|---|
| keybinding definitions + resolution, context-expr eval, menu resolution, `ContextKeyService`/`MenuRegistry` blueprints | cross-process pure logic + class blueprints | `@shared/utils/command` |
| command / keybinding / menu types | cross-process types | `@shared/types/command` |
| shortcut-label, `KeyboardEvent` → binding, display-state helpers | renderer-only pure logic | `utils/command` |
| context objects + their accessor hooks, `useResolvedCommand`/`useResolvedCommandMenu`, `useCommandShortcuts` | React contexts + hooks | `hooks/command` |
| `CommandProvider`/`CommandContextKeyProvider`, `CommandMenus`, `CommandControls` | React components | `components/command` |

A `Provider` returns JSX so it is a **component**; the contexts it fills and the hooks that read them are non-JSX and sink one tier below to `hooks/command`; pure logic sinks to `utils/command` (renderer-only) or `@shared/utils/command` (cross-process), and types to `@shared/types/command`. Nothing goes to `services/`, and `@shared` keeps only what **both** processes use — a resolver consumed only by the renderer (e.g. `getCommandShortcutLabel`) belongs in `utils/command`.
After decomposition every edge is downward (`component → component`/`hook`, `hook → hook`); the former `component → feature` and `hook → feature` inversions are gone (the importing `component`/`hook` are the **shared** buckets — a feature-internal `component` importing its own siblings is not such an inversion), and nothing is a "feature".

## 7. Anti-Patterns

- A shared bucket (`components/`/`hooks/`/`utils/`) importing `features` or `pages` (a reverse / upward edge).
- `pages/X` importing `pages/Y` (cross-page coupling).
- Domain-specific artifacts left in a top-level type bucket (backup managers, model/provider widgets, etc.).
- Treating a cross-cutting capability as a peer feature.
- Opening a new top-level directory for a single capability.
- A feature using `export *`, or an external consumer deep-importing a feature's — or a `services/<topic>/`'s — internals.
- Module-scope mutable state behind a plain camelCase name — retained state must take the class + singleton + suffix form ([Naming §5.2](./naming-conventions.md)); a plain name asserts statelessness.
- Importing a shared bucket root (`@renderer/utils`, `@renderer/types`) instead of the specific file/topic, or giving `types/`/`utils/` a re-export root `index.ts` (§5).
- A hand-rolled `components/layout/` bucket — "layout" is not a layer here: route layouts live in `routes/` (TanStack layout routes), layout primitives (`Box`/`Stack`/`Grid`) in `packages/ui`, app shell in `windows/`.

## 8. Target vs Current State

This document describes the **target** architecture. The renderer has not yet been fully migrated to it; the remaining gaps below are known and tracked. Migration is deferred and intentionally out of scope here.

Only **outstanding** deviations are tracked here: once a deviation is resolved it stops violating the target, so it is dropped from this list rather than recorded as done. The table lists definite mis-classifications and structural violations that remain. A small domain's pieces (components, pages, hooks, services, utils) may legitimately sit in the shared type-buckets until that domain earns a `features/<domain>/`; that promotion is a separate per-case judgment (§4.1) and is not prescribed here. A per-file naming-suffix audit of `services/` against [Naming §5.2](./naming-conventions.md) (v1-era pseudo-`Service` function collections, stateful plain-named modules) is likewise out of scope here.

| Area | Current state | Target |
|---|---|---|
| App shell | shell chrome in `components/layout/` is partly window-specific, partly cross-window — including `AppShell` and the `Sidebar` it renders (`components/app/Sidebar`, imported by `components/layout/AppShell.tsx` — window-shell UI, **not** dead code) | decompose by ownership: main shell (`AppShell`, `AppShellTabBar`, tab drag, `Sidebar`) → `windows/main/`; sub-window chrome (`SubWindowControls`, `SubWindowTitle`) → `windows/subWindow/`; cross-window building blocks (`TabRouter`, `TabIcon`, `titleBar`, tab icons) → shared `components/` (e.g. `components/shell/`). No new `windows/shell/` bucket |
| Cross-page imports | ~13 `pages/<domain>/` files import each other (`pages → pages` coupling), held at `warn` by the §5 gate | a page must not import another page; route shared needs through the shared layer, then tighten the gate to `error` |
| `utils/message/` topic barrel | `utils/message/` is a multi-file topic subdir with **no `index.ts`** (the `@renderer/utils` root barrel has already been dropped) | give `utils/message/` one curated `index.ts` (named exports, **no `export *`**) |
| Domain promotion | large multi-file domains (`chat` ≈ `pages/home` + `components/chat` + `components/composer`; `knowledge` ≈ `pages/knowledge` + …) are scattered across the shared type-buckets, and **no `features/` directory exists yet** | promote the largest domains into `features/<domain>/` per the §4.1 trigger (`chat` and `knowledge` first) |

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
