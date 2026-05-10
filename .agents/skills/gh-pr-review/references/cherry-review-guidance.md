# Cherry Review Guidance

Use this reference as the Cherry Studio project-specific lens for code and
architecture reviews. It complements `code-checklist.md`; it does not replace
evidence requirements. Only report issues that are grounded in current code.

## Scope Triage

Classify each reviewed module before looking for issues:

| Area | Common files | Review focus |
| --- | --- | --- |
| Data system | `src/main/data/`, `packages/shared/data/`, `docs/references/data/` | Correct system choice, DataApi scope, migrations, row/entity boundaries |
| Service boundary | `src/main/data/services/`, `src/main/services/` | Owning service, cross-service calls, transactions, side effects |
| IPC / preload | `src/preload/`, `packages/shared/IpcChannel.ts`, handlers | Input validation, renderer exposure, contract compatibility |
| Lifecycle / windows / paths | `src/main/core/`, window services, path access | Lifecycle ownership, cleanup, `application.getPath`, WindowManager |
| Renderer data hooks | `src/renderer/src/data/`, hooks using `useQuery`, `useMutation`, cache/preference hooks | SWR keys, invalidation, optimistic updates, external store snapshots |
| React UI | `src/renderer/src/`, `packages/ui/` | `@cherrystudio/ui`, i18n, a11y, hooks correctness, design-system fit |
| Shared types / API contracts | `packages/shared/`, DataApi schemas, DTOs | Type/runtime schema alignment, DTO boundaries, discriminated states |

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

- New UI should use `@cherrystudio/ui` and project design rules. Do not add
  `antd`, HeroUI, or styled-components.
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
