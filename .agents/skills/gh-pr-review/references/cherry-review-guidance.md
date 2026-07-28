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
     understandable.

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

### Internal Repository Docs

| Changed area | Consult |
| --- | --- |
| Added, renamed, or moved files/directories; new classes, services, managers, features, or barrels | `docs/references/naming-conventions.md` |
| `src/main/` placement, imports, top-level structure, features, services, or utils | `docs/references/main-process-architecture.md`, plus the subsystem reference it routes to |
| `src/renderer/` placement, imports, top-level structure, pages, features, shared buckets, or public APIs | `docs/references/renderer-architecture.md` |
| `src/shared/` placement, exports, runtime state, top-level structure, or cross-process contracts | `docs/references/shared-layer-architecture.md` |
| Choosing among DataApi, Cache, Preference, BootConfig, and `app_state` | `docs/references/data/README.md`; stop there unless the diff enters one of the subsystem rows below |
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
2. What project boundary or runtime behavior is violated?
3. What realistic failure or maintenance risk follows?
4. What is the smallest reasonable fix or author question?

Use severity language carefully:

- **Blocker**: runtime correctness, data loss, security, broken contract,
  unsafe migration, or high-risk infrastructure change.
- **Warning**: likely maintainability or boundary issue with a clear fix.
- **Notice**: design intent needs author confirmation; do not present as a bug
  unless code evidence shows failure.
