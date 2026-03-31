# Judgment Matrix

## Risk Level Assessment

Risk level is per-issue, not per-type — the same category (e.g., rename) can be
low or high risk depending on scope and impact.

| Risk | Rule | Examples |
|------|------|----------|
| Low | Only one reasonable fix exists | null check, fix incorrect comment, rename to match convention, remove redundant duplicate code, fix obvious off-by-one error, missing useEffect cleanup, missing i18n key |
| Medium | Multiple fixes possible, but no design decision or external contract involved | extracting shared logic across functions, removing unused internal methods, simplifying cross-function control flow, adjusting internal module boundaries, refactoring Redux selector logic |
| High | Involves design decisions or external contracts | public API change (signature, behavior, deprecation), IPC channel contract change, Redux state shape change (BLOCKED by v2), IndexedDB schema change (BLOCKED by v2), architecture restructuring, algorithm replacement with multiple viable approaches, introducing a new dependency, changing data persistence/serialization format, performance optimization involving space-time trade-offs, user-facing behavior change beyond the stated bug scope, build system configuration change |

## Handling by Risk Level

| `FIX_MODE` | Low risk | Medium risk | High risk |
|------------|----------|-------------|-----------|
| full       | Auto-fix | Auto-fix    | Auto-fix  |
| low_medium | Auto-fix | Auto-fix    | Confirm   |
| low        | Auto-fix | Confirm     | Confirm   |

**Special rule for "full" mode**: issues that would change test baselines
(screenshot comparisons, golden files) are always deferred for user confirmation,
regardless of risk level.

**V2 block rule**: any fix that would modify Redux state shape or IndexedDB
schema is ALWAYS deferred for user confirmation with a warning that these
changes are currently blocked until v2.0.0.

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
- **V2-blocked changes** — any change to Redux slices, IndexedDB schema, or
  files marked with the v2 deprecation header. Flag for awareness only.
