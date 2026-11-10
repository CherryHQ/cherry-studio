# Agent Note: Five-runner CI execution

Status: implemented

English | [中文](2026-11-10-ci-runner-consolidation.zh.md)

## Problem

A full CI plan allocates twelve heavy runners. Three main/preload shards and five renderer shards repeat dependency preparation and occupy capacity needed by other runs.

## Decision

Use three Linux jobs: basic checks, combined main/preload and package tests, and renderer tests. macOS and Windows keep one native-contract job each. A successful full plan allocates five heavy jobs plus three lightweight classification/aggregation jobs. Test groups run without shard filters.

Run selected main/preload and package groups sequentially after one dependency installation. Each group still runs if the other fails; verify both planned step outcomes before accepting the combined job. Successful installation marks workspace exports prepared for that job, so validation skips duplicate postinstall builds. Local unprepared validation and native SQLite preparation retain their existing behavior.

Check workflow syntax and formatting in the classification job before allocating heavy runners. Fetch the exact formatter version from the repository manifest without installing workspace dependencies. Planning or preflight failure still fails the required gates. Restore the existing read-only, non-blocking CI Performance observer to measure queue, preparation, execution, and cancelled-run costs.

Preserve affected-project selection, test inventories, worker limits, and the `basic-checks`, `general-test`, and `render-test` gates. Update gate dependencies and result mappings together when removing the shard job names.

This supersedes only the initial main/renderer shard baseline in the [validation proposal](../../proposed/process/2026-10-01-ci-and-local-validation.md).

## Alternatives considered

- Retain six heavy runners: separates main/preload and package tests but repeats one additional environment preparation.
- Retain twelve heavy runners: keeps test sharding but repeats seven additional environment preparations.
- Consolidate to four or three heavy runners: shares more preparation but serializes more validation work.

## Consequences

Relative to the rollback configuration, each full run removes seven dependency installations and cache restores, and the remaining jobs reuse their successful workspace preparation. Main and renderer tests have less cross-machine parallelism; combining main and packages further lengthens that job. Preflight delays test allocation until inexpensive checks pass. Hosted timing must distinguish queue time, cache state, preparation, and test execution.

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` enforces three Linux runners plus one macOS and one Windows runner, unsharded test groups, independent main/package outcomes, preflight failure handling, and preparation markers written only after successful installation.
- Regression — `scripts/__tests__/validationPlan.test.ts` preserves complete group execution and native ABI preparation for prepared and unprepared workspaces.
