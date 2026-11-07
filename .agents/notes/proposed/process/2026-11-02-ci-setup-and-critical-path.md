# Agent Note: CI preparation and critical-path optimization

Status: proposed

English | [中文](2026-11-02-ci-setup-and-critical-path.zh.md)

## Problem

The 2026-11-02 audit retrieved the latest 50 repository workflow runs and latest 50 CI runs through `gh`. The latter snapshot has 20 cancelled, 12 skipped, 13 unfinished, four action-required and one failed run; it contains no successful baseline. A separate latest-50-successful-CI cohort spans 03:08:28–08:33:42 UTC. It is observational, mixes validation scopes, and cannot establish an optimization speedup.

Successful-job median preparation / validation-step durations are 156 / 84 seconds for macOS (41 samples), 148 / 148 for Windows (41), 64 / 282.5 for basic checks (50), and 63.5 / 308.5 for renderer shard 1 (32). Validation steps include nested preparation; logs must separate workspace builds and native rebuilds from Vitest. Queue medians are 2–3 seconds, so this sample does not justify buying alternative runners. Independent percentile components must not be added to estimate wall time.

Both platform jobs report no exact dependency-cache hit in all 41 samples. Run [41413969420](https://github.com/CherryHQ/cherry-studio/actions/runs/41413969420) restores an older lockfile key on both platforms. Only the Linux basic job permits cache writes in the shared setup action. The cache-usage endpoint reports 9,903,845,526 bytes at collection; cache listing is a separate, changing snapshot. Installing dependencies builds seven workspace packages, then `scripts/validation/run.mjs` repeats that build. Two consecutive local executions of that preparation took 6.74 and 7.88 seconds, both successful; this is not an application-build benchmark.

The current concurrency group is shared by all pushes to a branch. `cancel-in-progress: false` protects an executing run but does not protect an older pending run from replacement. Main must retain every pushed commit's validation. The required checks remain `basic-checks`, `general-test`, and `render-test`, verified through the live main rules endpoint.

This partially supersedes the scheduling and caching direction in [the existing CI proposal](2026-10-01-ci-and-local-validation.md). Its shared inventory, fail-closed gates, runtime-Markdown coverage and native ABI contracts remain applicable. This proposal does not claim that its older unverified acceptance criteria have been completed.

## Proposal

1. Preserve PR-scoped cancellation, but give non-PR CI runs unique concurrency groups using the run ID. Main pushes run the full validation plan for every pushed head; PRs retain conservative affected selection. Preserve release publication serialization separately.
2. Keep the required CI workflow triggered for documentation-only PRs. Select documentation/format checks and explicit successful aggregation gates, while skipping application tests, native preparation and code-only checks. Runtime Markdown, mixed changes, unknown inputs and missing history continue selecting their necessary checks. Top-level path exclusion must not leave required contexts pending.
3. Prefer `setup-node` pnpm caching after installing the pinned pnpm executable, with the root lockfile as dependency input. Seed platform-specific caches from main, including Windows/macOS. Verify exact-hit behavior on a second main-compatible run. Do not cache all `node_modules`, native ABI outputs or unrelated build artifacts by default. Measure archive size, transfer, extraction and install separately; avoid duplicate archives and respect the repository cache budget.
4. Give workspace preparation one explicit owner per CI job. Preserve normal installation lifecycle hooks for third-party/native dependencies. Separate workspace preparation and native ABI preparation from test execution, retaining safe preparation for local commands after source changes. Never infer freshness solely from an output directory existing. Evaluate existing build-tool incremental support before adding custom fingerprints.
5. Split repository, types, lint and i18n into independent Ubuntu jobs only where measured critical-path reduction outweighs extra setup. Keep `basic-checks` as a fail-closed aggregation gate. Preserve every current policy, migration/generation drift, locale, type and lint check; preserve failure propagation when another group fails. No broad in-process concurrency increase or memory-limit removal.
6. Retain all test projects, platform contracts and package artifact tests. Measure renderer shard imbalance and module-loading time before changing shard count or worker allocation. Keep native-safe isolation. Do not apply `isolate: false`, replace typecheckers, remove ESLint rules or purchase runners without a separately justified decision. Tools should use existing/precompiled distribution rather than introducing source compilation during setup.
7. Push implementation to a review branch, measure real CI, then perform a second evidence-driven pass. Compare matching task/project scope, runner labels and cache state; report cold and warm behavior separately. Include failing/cancelled-run counts, wall time and runner seconds. Keep unmatched observations visible without asserting a speedup.

## Alternatives considered

- Apply the article's claimed 20x improvement as a target: rejected; its workload, runners and budget differ. Use its measurement method instead.
- Skip the entire required workflow for Markdown: rejected; required contexts can remain pending and some Markdown is runtime input.
- Increase shard counts immediately: rejected; each shard duplicates preparation and competes for shared runner capacity.
- Cache all installed/native outputs or disable test isolation: deferred; correctness and invalidation evidence are prerequisites.
- Keep main in one default concurrency group: rejected; pending commits can be replaced even with cancellation disabled.

## Acceptance criteria

- AC1 — Raw run/job/step evidence and per-job queue/preparation/validation breakdowns distinguish cancellation, incomplete runs, nested setup, cleanup, dependency waits and unavailable timestamps. (verification: audit artifacts and metrics regression tests)
- AC2 — Consecutive PR pushes supersede old PR runs, while multiple main pushes retain full validation for every pushed head. (verification: workflow contract tests and GitHub run evidence)
- AC3 — Documentation-only PRs complete all three required contexts without application tests; mixed/runtime/unknown changes retain coverage, and missing/failed/cancelled planned work fails gates. (verification: validation planner and gate tests plus documentation-only CI)
- AC4 — Every selected test project and existing policy/drift/type/lint/locale check remains represented after scheduling changes. (verification: inventory comparison, workflow contract tests and full-scope remote CI)
- AC5 — Platform caches are populated from trusted main-compatible runs and reused with the correct lockfile/runtime/platform boundaries; deleted or changed build inputs cannot reuse stale outputs. (verification: cold/warm CI logs and preparation invalidation tests)
- AC6 — Consecutive local preparation and application builds have recorded per-stage timings, and each duplicate preparation step is removed or explained without weakening native ABI correctness. (verification: local timed commands and focused preparation tests)
- AC7 — A pushed implementation and subsequent optimization pass report comparable before/after wall time, runner seconds, queue/setup/verification times and sample counts; no unsupported speedup is claimed. (verification: real CI runs and comparison report)

## Risks

Parallel jobs may increase runner minutes and contention; main full validation increases work compared with affected push selection. Cache migration temporarily creates cold starts and can increase eviction. Native Node/Electron ABI outputs cannot be shared blindly. Local warm timings do not predict hosted-runner timings. A single successful run is insufficient for a stable speedup claim. Spec approval is required before implementation; remote main cache seeding can only be fully verified after approved changes reach main, so PR results alone cannot close that acceptance criterion.
