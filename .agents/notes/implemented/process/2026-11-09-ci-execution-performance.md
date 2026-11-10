# Agent Note: CI execution performance

Status: implemented

English | [中文](2026-11-09-ci-execution-performance.zh.md)

## Problem

Serial repository, type, lint and locale checks extend CI latency. Dependency installation builds workspace exports, but validation builds them again. A shared push concurrency group can replace pending commits even when cancellation is disabled.

## Decision

Run the four check groups independently on Ubuntu and retain the required basic gate as a fail-closed aggregator. Preserve every existing check and test project. Use eight renderer shards and retain three main shards, with two Windows shards and one macOS runner. Use setup-node's pnpm cache without adding build-output caches.

Only PRs share a cancellable concurrency group. Push, scheduled and manual runs use unique run IDs and full validation. Documentation-only PRs retain documentation checks and stable required gates without unrelated tests; runtime Markdown remains covered.

Successful CI installation marks workspace exports prepared for that runner. Validation skips only the duplicate postinstall build; local validation still builds exports and native ABI preparation remains unchanged.

This partially replaces the execution policy in the [validation proposal](../../proposed/process/2026-10-01-ci-and-local-validation.md), retaining its coverage and planning decisions. The user explicitly waived Spec approval for this task on 2026-11-09.

## Alternatives considered

Workflow-level documentation exclusions leave required checks pending. Skipping tests or native contracts sacrifices coverage. More caches compete with the approximately 10 GiB dependency cache footprint. Keeping serial checks saves installations but increases latency.

## Consequences

Additional Ubuntu runners trade aggregate runner time for shorter execution paths. Cold setup-node keys require a new dependency cache population; cold and warm measurements must be separated. Concurrent benchmark runs can distort queue time, so report queue, setup and execution separately.

## Verification

- Regression — Validation workflow and planner tests reject missing, failed, cancelled and unexpectedly skipped planned checks; docs-only PRs omit unrelated tests while pushes retain the full inventory.
- Regression — Concurrency tests ensure different push runs have different groups and successive PR runs share a cancellable group.
- Regression — Preparation tests cover both newly installed CI workspaces and unprepared local workspaces without omitting validation commands.
- Local builds — Two consecutive full builds succeeded in 38.43 s and 35.18 s before the duplicate CI preparation optimization; these are not incremental-build speedup claims.
