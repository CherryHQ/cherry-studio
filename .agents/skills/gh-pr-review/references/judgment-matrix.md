# Judgment Matrix

## Risk Level Assessment

Risk level is per-issue, not per-type — the same category (e.g., rename) can be
low or high risk depending on scope and impact.

| Risk | Rule | Examples |
|------|------|----------|
| Low | Only one reasonable fix exists | null check, fix incorrect comment, rename to match convention, remove redundant duplicate code, fix obvious off-by-one error, missing useEffect cleanup, missing i18n key, over-broad DataApi refresh with an obvious narrower key |
| Medium | Multiple fixes possible, but no design decision or external contract involved | extracting shared logic across functions, removing unused internal methods, simplifying cross-function control flow, adjusting internal module boundaries, moving handler business logic into an existing service method, fixing unstable SWR keys or external-store snapshots |
| High | Involves design decisions or external contracts | public API change (signature, behavior, deprecation), IpcApi contract change, architecture restructuring, algorithm replacement with multiple viable approaches, introducing a new dependency, changing data persistence/serialization format, performance optimization involving space-time trade-offs, user-facing behavior change beyond the stated bug scope, build system configuration change, new DataApi endpoint for non-SQLite side effects, new BootConfig key, cross-service transaction redesign, persistence migration |

## Handling by Risk Level

| `FIX_MODE` | Low risk | Medium risk | High risk |
|------------|----------|-------------|-----------|
| full       | Auto-fix | Auto-fix    | Auto-fix  |
| low_medium | Auto-fix | Auto-fix    | Confirm   |
| low        | Auto-fix | Confirm     | Confirm   |

**Special rule for "full" mode**: issues that would change test baselines
(screenshot comparisons, golden files) are always deferred for user confirmation,
regardless of risk level.

**Legacy-data rule on `main`**: Redux is removed, and Dexie/ElectronStore are
throwaway v1 stacks. Do not repair or extend them. When the diff introduces new
v1 use, report it and route the implementation to Cache, Preference, DataApi,
or the v2 migrators as appropriate. When already editing an area, removal of
dead v1 residue is allowed; unrelated cleanup remains out of scope. A true v1
maintenance fix belongs on the `v1` branch and must not be auto-fixed on
`main`.

## Worth Fixing?

Code-checklist and doc-checklist define **what to look for**. This section
defines **whether to fix** a discovered issue.

### Decision principles

1. **Must fix** — The issue affects runtime correctness, safety, or security.
2. **Fix when clear** — The issue improves code quality (performance,
   simplification, architecture). Fix only when the solution is unambiguous and
   does not introduce new risk. Performance changes require both high confidence
   in semantic equivalence and a net benefit after weighing the gain against
   added code complexity.
3. **Fix when inconsistent** — The issue involves naming, initialization,
   comments, or file organization. Fix only when it violates project rules
   loaded in context or contradicts the surrounding code's established patterns.
4. **Always skip** — Pure style preferences (not violating any consistency
   rule), suggestions based on assumed future requirements rather than current
   code, and alternative implementation rewrites for stable code that has no
   correctness issue.

### Exceptions

- Duplicate code extraction: fix when identical logic is clearly duplicated
  (not by count threshold — judge by complexity and maintenance cost).
- Public API signature changes that are not bug fixes: fix only when justified
  by clear benefit to API consumers. Always high risk.
- Test coverage gaps and regression risks are **flagged, not fixed** — report
  them for the user's awareness rather than auto-fixing.
- `console.log` → `loggerService`: always worth fixing (project convention).
- Hardcoded UI strings → i18n: always worth fixing (project convention).
- DataApi misuse for pure side effects: always worth reporting; fixing is high
  risk if it changes IPC/API contracts.
- Handler-level business logic: worth fixing when the owning service and
  smallest move are clear; otherwise report as a design confirmation.
- Bypassing an owning service's business rules: worth reporting. Do not flag
  read-only `left join` data matching unless it reimplements another domain's
  validation, filtering, ordering, or row mapping.
- Renderer data hook bugs that can leave stale UI, corrupt optimistic state, or
  leak subscriptions are worth reporting.
- New BootConfig keys require explicit pre-lifecycle justification and tech-lead
  confirmation.

## Anti-patterns (Do NOT Fix)

Patterns that frequently produce false positives. Skip unless there is strong
evidence of an actual bug:

- **Speculative optimizations** — build system tweaks, caching additions, or
  conditional guards with no proven failure or measured bottleneck.
- **Documentation example "simplification"** — removing attributes, parameters,
  or steps from examples that are intentionally verbose for pedagogical
  purposes. This is NOT the same as removing redundant code.
- **Behavior changes disguised as bug fixes** — if a proposed fix changes
  observable behavior (not just implementation details), verify the original
  behavior is actually a bug, not an intentional design choice. When intent
  cannot be confirmed from the diff context alone, flag but do not fix.
- **Legacy-stack repairs on `main`** — do not fix Dexie/ElectronStore behavior
  or reintroduce Redux. Report newly introduced dependencies; route v1
  maintenance to the `v1` branch. Removing dead residue in an already-touched
  area is allowed when it cannot affect live v2 behavior.
