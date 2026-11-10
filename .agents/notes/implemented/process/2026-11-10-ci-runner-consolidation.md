# Agent Note: Eight-runner CI execution

Status: implemented

English | [中文](2026-11-10-ci-runner-consolidation.zh.md)

## Problem

A full CI plan allocates twelve heavy runners. Three main/preload shards and five renderer shards repeat dependency preparation and occupy capacity needed by other runs. A five-runner trial took 12m21s for combined main/packages; an earlier full trial took 23m53s for unsharded renderer. The execution target is now about ten minutes while conserving the shared twenty-runner pool.

## Decision

Use six Linux jobs: basic checks, main/preload tests, package tests, and three renderer shards. macOS and Windows keep one native-contract job each. A successful full plan allocates eight heavy jobs plus three lightweight classification/aggregation jobs. Main/preload and packages are unsharded; renderer uses Vitest's built-in three-way sharding with fail-fast disabled.

Run selected main/preload and package groups independently, so neither waits for or suppresses the other. Successful installation marks workspace exports prepared for that job, so validation skips duplicate postinstall builds. Local unprepared validation and native SQLite preparation retain their existing behavior.

Check workflow syntax and formatting in the classification job before allocating heavy runners. Fetch the exact formatter version from the repository manifest without installing workspace dependencies. Planning or preflight failure still fails the required gates. Restore the existing read-only, non-blocking CI Performance observer to measure queue, preparation, execution, and cancelled-run costs.

Preserve affected-project selection, test inventories, worker limits, and the `basic-checks`, `general-test`, and `render-test` gates. Update gate dependencies and result mappings together with the execution layout.

This supersedes only the initial main/renderer shard baseline in the [validation proposal](../../proposed/process/2026-10-01-ci-and-local-validation.md).

## Alternatives considered

- Retain five heavy runners: minimizes preparation but exceeds the execution target in both main/packages and renderer.
- Use seven heavy runners with two renderer shards: renderer's observed unsharded duration suggests insufficient margin for ten minutes.
- Retain twelve heavy runners: shortens individual test jobs but repeats four additional environment preparations.

## Consequences

Relative to the rollback configuration, each full run removes four dependency installations and cache restores, and the remaining jobs reuse their successful workspace preparation. Eight heavy jobs allow two full test layouts within the twenty-runner pool with four slots remaining. Preflight delays test allocation until inexpensive checks pass. Three renderer shards are an initial allocation to validate against the target, not a measured ten-minute guarantee. Hosted timing must distinguish queue time, cache state, preparation, and test execution.

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` enforces six Linux runners plus one macOS and one Windows runner, complete main/package groups, all three renderer shards, aggregate failure handling, preflight failure handling, and preparation markers written only after successful installation.
- Regression — `scripts/__tests__/validationPlan.test.ts` preserves complete group execution and native ABI preparation for prepared and unprepared workspaces.
