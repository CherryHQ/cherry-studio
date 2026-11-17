# Agent Note: Cancel obsolete CI after PR closure

Status: implemented

English | [中文](2026-11-09-ci-stale-run-cancellation.zh.md)

## Problem

PR concurrency only replaces runs when another PR event starts CI. Closing or merging a PR leaves unfinished tests running, including independently dispatched full validation. Repeated manual runs also queue behind earlier manual runs. These jobs compete with active PRs for the organization's runner concurrency.

## Decision

The [CI workflow](../../../../.github/workflows/ci.yml) scopes concurrency by event and PR number or full ref. PR runs replace earlier runs for that PR, and manual runs replace earlier manual runs for the same ref. Pushes and scheduled full validation retain non-cancelling groups, separate from manual validation.

The [closed-PR cleanup workflow](../../../../.github/workflows/ci-cancel-closed-pr.yml) uses `pull_request_target: closed` with only Actions write and pull-request read permissions. It executes inline GitHub API calls without checking out repository code. It requests cancellation only for unfinished `ci.yml` PR or feature-branch manual runs matching the closed PR's head repository and branch, created between PR creation and closure. It checks current state before cancellation and leaves the branch alone while another PR on that head is open. A cancellation conflict is accepted only after the run is confirmed completed.

## Alternatives considered

- Cancelling every older push can lose coverage: the next push selects only its own before/after range, not the cancelled predecessor's changes. Release push CI also authorizes exact-head builds.
- Combining PR and manual concurrency can replace merge-result validation with a head-only full check, or cancel an explicitly requested full check with an affected plan.
- Matching only branch names can cancel a different fork's CI. Cancelling by SHA alone misses older manual runs from the same PR branch.

## Consequences

Closing a PR also cleans up manual CI on its feature branch, while manual validation on the default and `release/v*` branches remains available. Push, schedule, completed, and other-workflow runs are excluded. A branch shared with an open PR is retained conservatively. Cleanup uses a hosted runner, so cancellation can wait for capacity; API acceptance does not prove the target has already stopped. Deleted head repositories are skipped because their identity is unavailable.

The workflow reads only runs created during the closed PR's lifetime and excludes attempts started after closure. Later runs and reopened PRs are preserved when observed by the state checks. A PR can still reopen between the last state read and cancellation; the new `reopened` CI event creates a replacement run.

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/ciCancellation.test.ts scripts/__tests__/validationWorkflow.test.ts` with isolated Git configuration: cancellation, event/ref isolation, fork identity, protected branches, reopening, shared branches, completion races, and existing affected-validation gates pass.
- Regression — `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml .github/workflows/ci-cancel-closed-pr.yml`: workflow syntax, expressions, and permissions validate.
