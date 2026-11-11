# Agent Note: Nine-runner CI execution

Status: implemented

English | [中文](2026-11-10-ci-runner-consolidation.zh.md)

## Problem

A full CI plan allocates twelve heavy runners. Three main/preload shards and five renderer shards repeat dependency preparation and occupy capacity needed by other runs. A five-runner trial took 12m21s for combined main/packages; an earlier full trial took 23m53s for unsharded renderer. An eight-runner trial still left unsharded main/preload above ten minutes. The execution target is now about ten minutes while conserving the shared twenty-runner pool.

## Decision

Use seven Linux jobs: basic checks, two main/preload shards, package tests, and three renderer shards. macOS and Windows keep one native-contract job each. A successful full plan allocates nine heavy jobs plus three lightweight classification/aggregation jobs. Packages are unsharded; main/preload and renderer use Vitest's built-in sharding with fail-fast disabled.

Run selected main/preload and package groups independently, so neither waits for or suppresses the other. Successful installation marks workspace exports prepared for that job, so validation skips duplicate postinstall builds. Local unprepared validation and native SQLite preparation retain their existing behavior.

Check workflow syntax and formatting in the classification job before allocating heavy runners. Fetch the exact formatter version from the repository manifest without installing workspace dependencies. Planning or preflight failure still fails the required gates. Keep the read-only timing collection scripts available for on-demand analysis; automatic CI Performance execution is disabled through repository Actions settings.

Preserve Linux affected-project selection, test inventories, worker limits, and the `basic-checks`, `general-test`, and `render-test` gates. Update gate dependencies and result mappings together with the execution layout.

Treat the generated documentation source index as documentation rather than an unknown full-validation input. Portable TypeScript sources in `aiCore`, `ai-sdk-provider`, and `web-search` retain their Linux project and consumer tests while omitting native platform jobs. Main/shared source, native adapters, configuration, unknown inputs, and mixed changes retain the existing native-platform selection. Scheduled/manual full validation always includes both platforms. Record platform selection in the plan and scope hash so execution and required gates agree.

This supersedes only the initial main/renderer shard baseline in the [validation proposal](../../proposed/process/2026-10-01-ci-and-local-validation.md).

## Alternatives considered

- Retain five or eight heavy runners: minimizes preparation but leaves combined main/packages, renderer, or unsharded main/preload above the execution target.
- Use seven heavy runners with two renderer shards: renderer's observed unsharded duration suggests insufficient margin for ten minutes.
- Retain twelve heavy runners: shortens individual test jobs but repeats three additional environment preparations.
- Skip native jobs whenever a package changes: rejects the distinction between portable protocols and filesystem/native adapters. Exempt only the three inspected portable source trees; keep their configuration and native consumers conservative.

## Consequences

Relative to the rollback configuration, each full run removes three dependency installations and cache restores, and the remaining jobs reuse their successful workspace preparation. Nine heavy jobs allow two full test layouts within the twenty-runner pool with two slots remaining. Preflight delays test allocation until inexpensive checks pass. The shard counts are an initial allocation to validate against the target, not a measured ten-minute guarantee. Hosted timing must distinguish queue time, cache state, preparation, and test execution.

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` enforces seven Linux runners plus one macOS and one Windows runner, the complete package group, both main/preload shards and all three renderer shards, aggregate failure handling, preflight failure handling, and preparation markers written only after successful installation.
- Regression — `scripts/__tests__/validationPlan.test.ts` preserves complete group execution and native ABI preparation for prepared and unprepared workspaces.
- Regression — `scripts/__tests__/validationPlan.test.ts` and `scripts/__tests__/validationWorkflow.test.ts` reproduce the documentation-index fallback and verify that portable changes retain Linux consumer coverage, mixed/native/configuration inputs and full validation require both platforms, and skipped native jobs cannot hide missing Linux jobs.
