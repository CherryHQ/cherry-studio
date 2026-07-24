# Cherry Review Guidance

Use this reference as the Cherry Studio project-specific lens for code and
architecture reviews. It complements `code-checklist.md`; it does not replace
evidence requirements. Only report issues that are grounded in current code.

## Scope Triage

Classify each reviewed module before looking for issues:

| Area | Common files | Review focus |
| --- | --- | --- |
| Data system | `src/main/data/`, `src/shared/data/`, `src/renderer/data/`, `docs/references/data/` | Correct system choice, DataApi scope, migrations, row/entity boundaries |
| Service boundary | `src/main/data/services/`, `src/main/services/` | Owning service, cross-service calls, transactions, side effects |
| IPC / preload | `src/shared/ipc/`, `src/main/ipc/`, `src/preload/`, `src/renderer/ipc/`, legacy `src/shared/IpcChannel.ts` | IpcApi routing, input validation, exposure, compatibility, migration completeness |
| Lifecycle / windows / paths | `src/main/core/`, window services, path access | Lifecycle ownership, cleanup, `application.getPath`, WindowManager |
| Main architecture | `src/main/` moves, additions, imports, services, features | Closed top level, placement, dependency direction, public boundaries |
| Renderer architecture | `src/renderer/` moves, additions, imports | Type/domain placement, downward dependencies, feature isolation, public boundaries |
| Shared layer | `src/shared/` | Actual cross-process demand, immutable/stateless surface, closed top level, API contracts |
| Renderer data hooks | `src/renderer/data/`, hooks using `useQuery`, `useMutation`, cache/preference hooks | SWR keys, invalidation, optimistic updates, external store snapshots |
| React UI | `src/renderer/`, `packages/ui/` | `@cherrystudio/ui`, i18n, a11y, hooks correctness, design-system fit |
| Naming / module shape | Added, renamed, or moved files/directories; new classes and barrels | Path casing, export-role naming, Service/Manager roles, promotion, barrel boundaries |

## Architecture-First Review

Review altitude matters as much as issue discovery. Judge every changed module
at the architecture level first — placement, ownership, dependency direction,
and abstraction integrity against the governing docs — and only then descend to
line-level details. When both levels produce findings on the same code, report
the architecture finding as the primary issue and fold the detail into it;
never let a line-level nit stand in for a boundary problem.

### Entity Leakage (Business Logic Intrusion)

The most common architecture defect in submitted code is concrete business
knowledge mixed into a generic surface.

This codebase repeats one structural pattern at every depth: a **generic
engine paired with a declaration surface** — `WindowManager` + `windowRegistry`,
the lifecycle container + `serviceRegistry` + phase/dependency decorators,
`JobManager`/`SchedulerService` + `jobRegistry` (handlers registered by their
owning domains), `SeedRunner` + `seederRegistry`, `MigrationEngine` +
`migrators/`, the DataApi/IpcApi routers + single-point schema-and-handler
registration, `CacheService`/`PreferenceService` + their shared schema
registries, `ai/runtime/registry` + drivers, tool/MCP pipelines + per-domain
tool units. Per-instance behavior belongs on the declaration side — a registry
entry, a schema field, an adapter, or a domain-owned unit; the engine stays
instance-blind. The review test for every touched module: **identify its
engine/declaration pair, then check which side the change landed on.**
Instance-keyed behavior added to the engine side is entity leakage — at any
module depth, cross-module (features into `core/`, `data/`, `shared/`) and
intra-module (a module's own generic layer) alike.

The renderer (`docs/references/renderer-architecture.md`) expresses the same
rule as a **type × domain grid with strictly downward edges**: the shared row
(`components/`, `hooks/`, `services/`, `utils/`, `data/`, `ipc/`, `workers/`)
and the primitives below it are **domain-blind by definition**; domain
knowledge may exist only in a domain row (`features/<domain>/`, or the
`pages/<domain>/`-style buckets while promotion is pending) or in app-layer
composition (`windows/`/`routes/`/top-level `pages/`). Lint already bans the
import edges (`shared → features/pages`, `feature → feature`, `page → page`);
review must catch **domain knowledge that arrives without an import** — route
strings, cache-key prefixes, domain-id branches, feature-flag props — which
lint cannot see.

What leakage looks like per module (non-exhaustive — derive new cases from the
engine/declaration and domain-blind tests above):

| Generic surface | Leakage looks like |
| --- | --- |
| Lifecycle container (`core/application`) | `Application`/`BaseService` branching on a concrete service name; startup ordering hacked for one service instead of `@ServicePhase`/`@DependsOn` declarations |
| `WindowManager` (`core/window`) | engine or shared behavior code branching on one window type instead of a mode/flag declared per type in `windowRegistry` |
| Job & scheduler (`core/job`, `core/scheduler`) | `JobManager`/`SchedulerService` branching on a concrete job kind; one job's retry/concurrency policy special-cased in the engine; `core/` importing a feature to run its job instead of the domain registering a handler |
| Paths (`core/paths`) | path code deriving a feature's directory ad hoc instead of a declared `namespace.key` |
| DataApi infrastructure (`data/api`) | router or shared pagination/ordering/data-change helpers special-casing one endpoint or table |
| `CacheService` / `PreferenceService` | per-key behavior (TTL, tier, persistence, bridging) coded in the service instead of declared in the schema registry; tier contracts bridged to satisfy one feature's need |
| Migration & seeding (`data/migration/v2`, `data/db/seeding`) | `MigrationEngine`/`SeedRunner` branching on one migrator/seeder; shared mapping utils encoding a single domain's transform |
| DB schemas (`data/db/schemas`) | one column overloaded with several row-kind meanings decoded by parsing; relation columns (`role`, `sourceId`) that no consumer reads |
| IpcApi bridge (`shared/ipc`, preload) | the generic bridge or error model gaining fields or branches only one route uses; a bespoke channel added beside the generic bridge |
| AI runtime & providers (`ai/runtime`, `ai/provider`) | shared driver/registry contracts gaining fields only one driver consumes; stream/pipe loops branching on a concrete provider or model id instead of a registry capability flag |
| AI tools / MCP / approval (`ai/tools`, `ai/mcp`, `ToolApprovalRegistry`) | dispatcher, permission gate, or server pipeline special-casing a concrete `xxxTool`/`xxxMcp`; name side tables; domain params in the generic `ToolHandler` contract |
| Main `services/` bucket | a capability service (files, notifications, shortcuts) branching on which entity called it (avatar vs provider logo) instead of exposing a generic API the owning domain composes |
| Renderer shared row (`components/`, `hooks/`, `services/`, `utils/`) | a shared module encoding a domain without importing it: feature-flag props (`isAgentPage`), route-path branches (`pathname.startsWith('/agents')`), switches over domain ids, one domain's cache key or resource path special-cased |
| Renderer infra cells (`data/`, `ipc/`, `workers/`) | the generic query/mutation layer hard-coding one feature's refresh graph; the IPC facade special-casing one route; a worker encoding one domain's payload shape |
| Sibling domains (`features/<domain>/`, `pages/<domain>/`) | one domain branching on another domain's ids/types/state — the sideways edge the doc routes up (app-layer composition) or down (extract the shared piece); a shared "coordinator" hook that names both domains is the same edge hidden in the shared row |
| Renderer app layer (`windows/`, `routes/`, top-level `pages/`) | cross-domain orchestration pushed down into one feature or a shared hook instead of being composed at the app layer |
| Renderer top-level / capability placement | a capability landing as a blob — a new top-level directory, or a cross-cutting capability (command/keybinding-style) dressed as a peer domain feature — instead of decomposing by shape across existing cells (renderer-architecture §6) |
| `packages/ui` primitives | a primitive acquiring a business prop, domain rendering branch, or data-layer knowledge instead of a render-prop/slot injection point |
| `src/shared/` contracts | shared types/enums/utils gaining fields or members only one process or domain consumes |

Recognition signals across all of them (each is a finding, not a style nit):

- A generic dispatcher/pipeline/registry/permission check branches on concrete
  ids: `if (name === 'xxxTool')`, a `switch` over specific server names.
- A name-list side table (`KB_TOOL_NAMES = [...]`) or string-affix magic
  (`key.startsWith('CherryKb')`) classifies which members of a generic
  collection get special behavior.
- A domain-specific parameter is threaded through a generic contract that most
  implementations ignore (e.g., a knowledge-domain `allowedIds` on a shared
  `ToolHandler.run` signature consumed by only one domain's handlers).
- One primitive field carries several unrelated meanings decoded downstream by
  regex, ordering, or convention, instead of a discriminated union.
- A foundation module imports a concrete feature to make a decision the
  feature should own.

### Fix Direction: Restore Ownership, Never Annotate the Leak

For every entity-leakage or boundary finding, the recommended fix must name the
owning layer and the target shape per the governing architecture doc: move the
concern into a domain-owned unit registered through the extension point the
generic layer already defines (or should define), introduce the explicit domain
type, or relocate the module. State the architecture-level resolution first;
implementation steps second.

Do not propose — and do not accept from a fixer — remedies that keep the wrong
ownership in place:

- adding or renaming a side table / name list,
- adding a metadata flag or optional parameter to the generic contract,
- adding one more special case next to the existing ones,
- wrapping the branch in a helper so the leak is merely indirected.

"Smallest fix" always means the smallest **architecture-conformant** fix. If
that fix is too large for the current PR, say so explicitly and present it as
the required direction (scoped follow-up, author decision) — do not downgrade
the recommendation to a patch that preserves the violation, because authors
will take the patch.

This section does not license speculative abstraction: flag concrete knowledge
invading an existing generic surface; do not demand new layers, registries, or
extension points where the code is already domain-local (see
Anti-Fragmentation principle 3).

## Fix Recommendation Policy (Fix Altitude)

"Minimal fix" versus "thorough fix" is the wrong axis. The right axis is the
**altitude of the defect**: a fix recommendation must operate at the layer
where the defect actually lives, and then be the **smallest complete fix at
that altitude**. A local defect takes a minimal local fix — inflating it into
a refactor is scope creep, itself a defect. A structural defect cannot be
fixed by a smaller change at a lower altitude — a patch below the defect's
altitude is not a smaller fix, it is a non-fix that hides the defect.
Diagnose the altitude first; only then shape the recommendation.

| Problem class | Defect altitude | Optimal recommendation |
| --- | --- | --- |
| Local correctness bug in sound structure (logic error, missing guard/cleanup, off-by-one, unawaited promise) | the line / function | The minimal local correction. Do not inflate into refactors or "while we're here" improvements. |
| Bug that is a symptom of a structural cause (two writers own one state, refresh graph duplicated across call sites, lost-update race) | the owning structure | Name the root cause and recommend the fix there — the symptom class disappears. A symptom patch is acceptable only as an explicitly labeled stopgap **alongside** the primary recommendation (e.g., release urgency stopping user harm), with the structural fix stated as required follow-up. |
| Entity leakage / boundary violation / mandatory-doc non-conformance | the module structure | The smallest architecture-conformant change (see Fix Direction above). **No stopgap tier exists** for this class: unlike a correctness stopgap, a leak-preserving patch stops no harm — it just implements the feature in the wrong place. If the fix is large, present the direction plus a scoped follow-up. |
| Downstream workaround of an upstream limitation | the upstream shared surface | Name the upstream module and the method/contract to extend; the downstream code then simplifies to a normal call. Do not accept the workaround plus a TODO as the recommendation. |
| Duplication, or a new helper shadowing an existing public capability | the canonical owner | Converge: route through the existing owner, or extract once into the correct layer. Never a third copy, never "align the two copies". |
| Speculative abstraction / over-engineering introduced by the diff | the added structure | Deletion. The fix removes structure; recommending a better-built version of an unneeded layer is still wrong. |
| Convention / naming / module-shape violation | the file or identifier | The mechanical fix the doc defines (rename, move, re-case). The doc defines a unique target, so here minimal **is** complete. |
| Performance issue | the measured hot path | A targeted change with semantic-equivalence evidence. No speculative rewrites, no trading clarity for unmeasured gains. |
| Design intent unclear | — | A question to the author, not a fix. Recommending any fix — minimal or architectural — before intent is confirmed is premature. |
| Test coverage gap / regression risk | — | Flag with the named missing cases; do not prescribe the implementation (flag-only per `judgment-matrix.md`). |

When the author or a fixer answers "too big for this PR", the acceptable
outcomes are: do it now, or land the stated direction with a tracked follow-up
and any stopgap explicitly marked temporary. Silently downgrading the
recommendation to the patch is never an outcome — that is how leaks and root
causes survive review.

## Anti-Fragmentation Review Principles

Use these principles before proposing a fix. They prevent scattered local
patches, one-off service APIs, and speculative abstractions from spreading
through the codebase.

1. Fix upstream, not downstream.
   - If a consumer adds a workaround because a shared module, service, hook, or
     component has a limitation, ask whether the shared upstream surface should
     be fixed instead.
   - Flag downstream patches when the same limitation can affect other
     consumers, when multiple consumers duplicate the same guard, or when the
     patch hides an upstream contract bug.
   - Do not demand an upstream rewrite for a truly isolated compatibility shim;
     ask for the boundary and expiration condition instead.
2. Generalize clear public service needs before specializing.
   - When the requirement is a stable domain operation or a likely shared
     capability, prefer a clear method on the owning service, hook, or component
     API over a page-specific helper or endpoint.
   - The need must be concrete. Do not generalize only for imagined future
     callers.
   - A specialized implementation is acceptable for a one-off workflow when it
     remains local and does not duplicate a public capability.
3. Stay simple and restrained.
   - Avoid extra layers, registries, state machines, adapters, config systems,
     or extension points without current evidence.
   - Do not flag "missing abstraction" unless there is real duplication,
     ownership confusion, or a clear public service requirement.
   - Prefer the smallest fix that repairs the boundary and keeps the system
     understandable. A fix that leaves the boundary broken — annotating,
     side-tabling, or special-casing the leak — does not count as repairing
     it; see Architecture-First Review.

Report these as:

- **Blocker** when fragmentation creates a runtime/data/security risk or breaks
  a public contract.
- **Warning** when a one-off patch or specialized helper makes ownership unclear
  and the smaller upstream/general fix is evident.
- **Notice** when the diff needs author confirmation about whether a capability
  should be upstreamed, generalized, or intentionally kept local.

## Reference Routing

Load references by changed area. Do not paste every external guide into every
review. Project docs and repository code win over external references when they
conflict.

### Mandatory Baseline Docs

These documents are mature and authoritative. For every code or mixed review,
load and review the diff against them — they are review criteria, not optional
context:

| Doc | When |
| --- | --- |
| `docs/references/naming-conventions.md` | Always |
| `docs/references/main-process-architecture.md` (follow the subsystem references it routes to for touched subsystems) | Diff touches `src/main/` |
| `docs/references/renderer-architecture.md` | Diff touches `src/renderer/` |
| `docs/references/shared-layer-architecture.md` | Diff touches `src/shared/` |
| `docs/references/data/README.md` (follow its routing into the subsystem rows below) | Diff touches any data surface: DB schemas, DataApi, Cache, Preference, BootConfig, or their renderer hooks |

On-demand docs carry the same authority when their area is touched: the
lifecycle, IpcApi, window, and job-and-scheduler rows in the table below.

**Severity floor**: any non-conformance with these documents is an important
finding by definition. Report it at **Warning** minimum — **Blocker** when it
breaks a contract or creates runtime/data risk — never as a Notice, a style
preference, or "consistent with nearby code". Nearby code sharing the
violation is migration residue, not precedent.

### Internal Repository Docs

| Changed area | Consult |
| --- | --- |
| DataApi contracts, schemas, types, or errors | `docs/references/data/data-api-overview.md`, `api-design-guidelines.md`, `api-types.md` |
| DataApi handlers, services, or renderer hooks | Add `docs/references/data/data-api-in-main.md` for main handlers/services and `data-api-in-renderer.md` for renderer consumers |
| Cache storage, hooks, service calls, or keys | `docs/references/data/cache-overview.md`; add `cache-usage.md` for consumers and `cache-schema-guide.md` only when keys/schemas change |
| Preference storage, hooks, service calls, or keys | `docs/references/data/preference-overview.md`; add `preference-usage.md` for consumers and `preference-schema-guide.md` only when keys/schemas change |
| BootConfig behavior, access, or keys | `docs/references/data/boot-config-overview.md`; add `boot-config-schema-guide.md` only when keys/schemas/mappings change |
| Internal startup continuity markers | `docs/references/data/app-state-overview.md` |
| v1-to-v2 migrators or migration mappings | `docs/references/data/v2-migration-guide.md` plus the affected target subsystem guide |
| SQLite schemas, transactions, migrations, defaults, or nullability | `docs/references/data/database-patterns.md`; add `database-construction.md` for migration/custom-SQL/FTS build changes and `best-practice-default-values-and-nullability.md` for default/nullability changes |
| Sortable resources or order keys | `docs/references/data/data-ordering-guide.md` |
| Offset/cursor pagination or paginated hooks | `docs/references/data/data-pagination-guide.md` |
| Database seeders or seeding policies | `docs/references/data/database-seeding-guide.md` |
| Static presets with user overrides | `docs/references/data/best-practice-layered-preset-pattern.md` |
| Main-process services and long-lived resources | `docs/references/lifecycle/README.md`, `docs/references/lifecycle/lifecycle-usage.md`, `docs/references/lifecycle/lifecycle-decision-guide.md` |
| Jobs, scheduled tasks, or scheduler handlers | `docs/references/job-and-scheduler/README.md`; add `scheduler-usage.md` for consumers, `handler-authoring.md` for new/changed handlers, `concurrency-and-locks.md` for locking/concurrency changes |
| IpcApi routes/events, preload exposure, main handlers, renderer calls, or legacy IPC migration | `docs/references/ipc/README.md`; then `ipc-usage.md` for implementation, `ipc-schema-guide.md` for contracts/naming, and `ipc-migration-guide.md` when legacy IPC is touched |
| Windows | `docs/references/window-manager/README.md` |
| Main-process filesystem paths | `src/main/core/paths/README.md` |
| SQLite services, handlers, seeders, migrations | `docs/references/testing/database-testing.md`, `tests/__mocks__/README.md` |
| UI and shared components | `DESIGN.md`, `packages/ui/`, component usage near the diff |
| Repository skills | `.agents/skills/README.md`, `.agents/skills/create-skill/SKILL.md`, `.agents/skills/gh-pr-review/SKILL.md` |

Treat the listed architecture documents as the authority for their scopes.
Read the relevant sections before judging placement or dependency direction;
nearby code can reflect a documented current deviation and is not a stronger
precedent than the target architecture. Do not load unrelated subsystem guides.

### Internal Skills

Use these skills when they are available in the current runtime:

- Never hard-code machine-local skill paths. Refer to a skill by name and use
  the runtime-provided skill path only when the active environment exposes one.
- `vercel-react-best-practices`: React and Next.js performance, rendering,
  data-fetching, and bundle review.
- `create-skill`: repository-specific skill creation, public skill whitelist,
  `skills:sync`, and Claude symlink rules.
- `skill-creator`: general skill authoring rules, progressive disclosure,
  metadata, references, and validation.
- `gh-create-pr`: PR template compliance when reviewing PR workflow or PR
  documentation changes.
- `cherry-pr-test`: Electron UI test workflow when review findings need local
  app reproduction.

### External Skills And Websites

Use external sources only to clarify framework semantics or to strengthen a
project-specific finding. Do not report an issue solely because an external
source prefers a different style.

| Topic | Reference |
| --- | --- |
| React component composition, boolean-prop growth, compound components | `vercel-composition-patterns`: https://skills.sh/vercel-labs/agent-skills/vercel-composition-patterns |
| Tailwind design systems, tokens, variants, responsive/accessibility patterns | `tailwind-design-system`: https://skills.sh/wshobson/agents/tailwind-design-system |
| Advanced TypeScript types, discriminated unions, conditional/mapped/template literal types | `typescript-advanced-types`: https://skills.sh/wshobson/agents/typescript-advanced-types and https://www.typescriptlang.org/docs/ |
| shadcn/ui composition and component conventions | `shadcn`: https://skills.sh/shadcn/ui/shadcn and https://ui.shadcn.com/docs |
| React Hooks semantics | https://react.dev/reference/react/useEffect, https://react.dev/reference/react/useEffectEvent, https://react.dev/reference/react/useMemo, https://react.dev/reference/react/useCallback, https://react.dev/reference/react/useSyncExternalStore, https://react.dev/learn/you-might-not-need-an-effect |
| SWR cache, mutation, revalidation, and optimistic update semantics | https://swr.vercel.app/docs/getting-started, https://swr.vercel.app/docs/mutation, https://swr.vercel.app/docs/revalidation |
| Tailwind CSS utility semantics | https://tailwindcss.com/docs |

## Naming And Module Shape

Use `docs/references/naming-conventions.md` as the authority when the diff adds,
renames, or moves a path, changes a primary export's role, or creates a module
boundary. Do not infer the rule from whichever nearby legacy file is easiest to
copy.

Review for:

- File casing matching the primary export and its zone: renderer business
  components use `PascalCase.tsx`; hooks/functions use `camelCase.ts`; class
  files use `PascalCase.ts`; `packages/ui` and renderer route paths use their
  documented `kebab-case` conventions.
- Tests using `*.test.ts(x)`, never `.spec.*`, and case-only renames being safe
  on macOS, Windows, and Linux.
- Stateful singleton capabilities using a class with the correct `Service`
  (default) or `Manager` (homogeneous instance pool) role. Multi-instance
  helper classes and stateless modules must not acquire those suffixes merely
  because they contain methods.
- Single files growing into topic directories only when multiple artifacts
  exist, and domains moving to `features/<domain>/` only when they are large,
  complex, and span concerns.
- `index.ts` being a real, lint-enforced encapsulation boundary: explicit named
  re-exports only, no logic, no `export *`, no nesting, and no `index.tsx`.
- New top-level directories being rejected unless the governing process
  architecture explicitly permits them.

## Main, Renderer, And Shared Architecture

Apply the process-specific architecture document whenever the diff changes
placement, imports, public entry points, or ownership. A documented target/current
deviation is context, not permission to introduce more of the deviation.

For `src/main/`, review for:

- New code routed into the closed top-level set by responsibility; business
  code must not leak into `core/`, and a new capability must not create a new
  top-level directory.
- Dependencies flowing toward the foundation: features stay mutually isolated,
  `ai/` does not import features, and main/preload never import renderer code.
- IPC handlers acting as boundary adapters and resolving owning services through
  `application.get` rather than importing domain implementation directly.
- Topic directories and feature public APIs having one curated entry point,
  while bucket roots such as `services/` and `utils/` have no aggregate barrel.

For `src/renderer/`, review for:

- Dependencies flowing down app/composition -> domain feature -> shared
  renderer layer -> primitives. Shared components/hooks/services must not
  import pages, windows, or features.
- Sibling features not importing one another and pages not importing other
  pages. Cross-domain composition belongs above the features; reusable pieces
  move down to the shared renderer layer.
- External feature consumers entering through the feature's curated `index.ts`;
  no deep imports across the boundary.
- A domain earning `features/<domain>/` only at the documented promotion
  threshold; small pieces remain in the appropriate type bucket.

For `src/shared/`, review for:

- Actual use by both main and renderer before placement in `@shared` (except
  the documented Cache schema-registry carve-out). Prospective reuse is not
  sufficient.
- No exported mutable runtime state or live singleton instances. Shared may
  expose types, pure functions, immutable data, and class blueprints only.
- New code fitting the closed `ai`, `data`, `ipc`, `types`, or `utils` top-level
  set. Single-process code stays in its owning process.
- Topic barrels being curated and bucket roots remaining barrel-free.

## IpcApi Boundary

IpcApi is the default command/RPC boundary for non-data main-process
capabilities. Legacy `IpcChannel` entries describe migration residue, not the
pattern for new work.

Review for:

- SQLite-backed business data using DataApi; user settings using Preference;
  disposable/shared state using Cache; pre-lifecycle flags using BootConfig;
  every other renderer-to-main command using `ipcApi.request` unless it meets a
  documented escape hatch.
- A complete typed route: shared zod schema, main handler, generic preload
  bridge, renderer facade call, and typed errors/events where applicable.
- Handlers remaining thin: validate at the boundary, use `IpcContext` where
  caller identity matters, and delegate stateful business/resource ownership
  to the lifecycle or owning service.
- Route and event names following dot `snake_case`, payload fields remaining
  camelCase, and types being derived from schemas instead of duplicated.
- Main-to-renderer pushes using typed `broadcast`/`send` plus `useIpcOn`;
  high-frequency topic streams use directed send and batching rather than an
  untyped channel.
- Legacy domain migration landing atomically across schema, handler, preload,
  renderer, and obsolete channel deletion. Native exceptions must be explicitly
  sender-validated and documented by the IPC migration guide.

## Data System And DataApi Boundaries

DataApi is for SQLite-backed, irreplaceable business data. It is not a
general-purpose RPC layer.

Flag these as real issues when introduced by the diff:

- A DataApi endpoint wraps process/window control, external service calls,
  notifications, or other pure side effects instead of SQLite business data.
- A handler contains business rules, cross-table query logic, validation
  workflows, or transaction orchestration. Handlers should extract request data,
  call a service, and return the result.
- Renderer code reconstructs business workflows from multiple raw DataApi calls
  when the workflow belongs in a main-process service.
- A new BootConfig key is added without a clear reason it must load before the
  lifecycle system. BootConfig should be extremely rare; ask for tech-lead
  confirmation unless the pre-lifecycle requirement is obvious.
- Row-to-entity mapping leaks SQLite `null`, DB rows, or ORM implementation
  details to renderer DTOs.

When judging system choice:

- Regenerable or disposable data -> Cache.
- Stable user settings with fixed keys -> Preference.
- Process-level config needed before lifecycle -> BootConfig, but only after
  explicit justification.
- User-created, structured, irreplaceable data with a table -> DataApi.
- Pure command / side effect -> IPC or lifecycle service, not DataApi.

## Service Ownership, Cross-Table Access, Transactions

Data services own their domain tables and the business rules around those
tables. Cross-domain collaboration is allowed, but the ownership boundary must
stay visible.

Flag these as issues:

- A service reimplements another domain's business logic instead of calling the
  owning service's public method.
- A service imports another domain's table to bypass validation, soft-delete
  filters, ordering rules, permission checks, or row/entity mapping.
- A cross-table write is split across services without one explicit transaction
  boundary or rollback story.
- A handler coordinates multiple service writes directly. Put orchestration in a
  service method.
- A service opens its own transaction in a method that is used as part of a
  larger workflow, preventing callers from composing one atomic transaction.
- A response embeds full cross-domain objects that can become stale when IDs
  would preserve the boundary.

Do not over-report:

- A read-only `left join` for data matching is acceptable when it does not
  encode another domain's business rules. The reviewer should verify it remains
  read-only and does not replace the owning service's validation or mapping.
- Repository files are strongly discouraged, but a private helper inside the
  owning service is fine for complex query readability.
- A registry service is only for read-only "static preset + DB override" merge
  patterns. It should call the owning entity service for DB data.

## Renderer Data Hooks

`useQuery`, `useMutation`, `useInfiniteQuery`, and `usePaginatedQuery` use SWR
semantics: cache keys, deduplication, stale-while-revalidate, mutation refresh,
optimistic updates, and revalidation ordering.

Review for:

- Unstable query keys caused by including non-result-affecting fields or
  re-created query objects.
- Mixing concrete paths and template paths within one module in a way that makes
  refresh reasoning hard, even if the final cache key is equivalent.
- `refresh` that is too narrow and leaves stale UI, or too broad (`/*` over a
  high-cardinality resource) and revalidates unrelated data.
- Template-path `useMutation` triggered concurrently for different IDs from one
  hook instance. Use per-row concrete-path hooks for parallel writes.
- Optimistic updates without rollback or later revalidation.
- Manual cache writes in `onSuccess` that race with pending revalidation.
- Direct use of `useSWRConfig().cache`, `unstable_serialize`, or raw SWR internals
  outside the sanctioned DataApi cache helpers.

`useCache` and `usePreference` use `useSyncExternalStore`-style external store
semantics. Review for:

- `subscribe` returns cleanup and does not leak listeners.
- `getSnapshot` returns the same value when the store has not changed.
- Mutable stores create new object/array snapshots only when data changes.
- Async initialization is not performed during render.

## React Hooks And UI

React issues are worth reporting when they can cause stale data, missed cleanup,
excessive work in hot paths, or incorrect UI state.

Review for:

- `useEffect` used for pure render-derived state, event-specific logic, or
  parent/child state synchronization that can be handled during render or in an
  event handler.
- Missing effect dependencies, or deleted dependencies used to silence reruns.
- Missing cleanup for listeners, timers, observers, subscriptions, abortable
  requests, and third-party widgets.
- `useEffectEvent` used outside Effect-owned non-reactive callbacks, or used to
  evade dependencies. It is appropriate for subscription/timer callbacks that
  need latest props/state without restarting the Effect.
- `useMemo` used as a correctness mechanism. It is only for expensive
  calculations, stable object/array props to memoized children, or stable hook
  dependencies.
- `useCallback` wrapped around ordinary inline handlers with no identity-sensitive
  consumer. It is useful for `memo` children, hook dependencies, or stable custom
  hook APIs.
- `useMemo` / `useCallback` dependencies that are incomplete or defeated by
  always-new object dependencies.
- Custom hooks that leak internal state-machine details or unstable callbacks to
  callers.

UI-specific checks:

- New UI should use `@cherrystudio/ui` and project design rules.
- User-visible text must use i18n.
- Interactive controls need keyboard behavior and accessible names.
- Prefer established component composition over boolean-prop growth.

## Type And Contract Review

Flag type issues when they create runtime mismatch or caller ambiguity:

- DataApi schema type, runtime validation, and service return shape diverge.
- DTOs expose DB rows, ORM fields, or internal-only persistence details.
- Public unions are not discriminated enough for exhaustive handling.
- Complex generic / conditional types make call-site errors unreadable without
  reducing real runtime risk.
- `null` vs `undefined` semantics are inconsistent across DB row, service entity,
  IPC payload, and renderer type.

## Reporting Shape

Every finding should answer:

1. Where is the code? Give `file:line` and a short snippet.
2. What project boundary or runtime behavior is violated? Cite the governing
   doc rule when one applies.
3. What realistic failure or maintenance risk follows?
4. What is the optimal fix at the defect's altitude? Classify the problem per
   Fix Recommendation Policy and recommend the smallest complete fix at that
   altitude. For boundary, ownership, or doc-conformance findings, that means
   naming the owning module or layer and the target shape first, then the
   implementation route (see Architecture-First Review); for local bugs it
   means the minimal correction and nothing more.

Use severity language carefully:

- **Blocker**: runtime correctness, data loss, security, broken contract,
  unsafe migration, or high-risk infrastructure change.
- **Warning**: likely maintainability or boundary issue with a clear fix.
  Violations of mandatory baseline or on-demand docs are Warning minimum.
- **Notice**: design intent needs author confirmation; do not present as a bug
  unless code evidence shows failure. Never file a doc violation or entity
  leak as a Notice.
