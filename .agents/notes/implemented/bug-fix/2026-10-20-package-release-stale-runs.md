# Agent Note: Skip obsolete package release runs

Status: implemented

English | [中文](2026-10-20-package-release-stale-runs.zh.md)

## Problem

Queued package release runs can retain changesets already consumed by a merged version PR. On October 20, a run for an older commit recreated `remote-transport@0.2.4` in PR #22033 after #22032 merged; another recreated `file-preview@0.1.3` in #22034 after #22033 merged. The final merge of #22034 changed no files.

## Decision

The [package release workflow](../../../../.github/workflows/release-packages.yml) checks out the triggering event SHA explicitly. Immediately before Changesets runs, it reads the live remote `main` ref and compares it with the checked-out commit. A mismatch skips both version PR generation and npm publication; a failed remote lookup fails the job without authorizing either operation. Workflow concurrency stays serialized with cancellation disabled so a new push cannot interrupt an ongoing npm publication.

## Alternatives considered

- Checking out the latest `main` alone is insufficient: Changesets Action v2 resets the version branch to the event SHA and uses that SHA as the API commit base. It could also publish code different from the code built and tested.
- Cancelling in-progress release runs can interrupt npm publication after only some packages have been published.
- Serializing runs without a freshness check leaves queued event commits obsolete after a maintainer merges a version PR.

## Consequences

The gate checks freshness after builds and tests without replacing the validated checkout. The next eligible push or a new manual `Release Packages` dispatch on `main` processes current changes. A push outside the workflow's path filters can make the run obsolete without scheduling a successor; use a new manual dispatch in that case. Re-running the old event retains its SHA and remains obsolete.

The check is not an atomic lock on `main`: a maintainer can still merge after the check while the action is executing. This repair covers runs already obsolete at the action boundary; it does not claim to eliminate that remaining window or coordinate human merges with the action.

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/package-release-freshness.test.ts scripts/__tests__/changeset-policy.test.ts scripts/__tests__/release-workflow.test.ts`: real local Git repositories exercise a consumed changeset, stale checkout rejection, a current checkout proceeding, unavailable or missing remote refs failing closed, and the workflow's action gate and non-cancelling concurrency contract.
