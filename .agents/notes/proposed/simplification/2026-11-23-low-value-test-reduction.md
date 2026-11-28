# Agent Note: Remove low-value test cases

Status: proposed

English | [中文](2026-11-23-low-value-test-reduction.zh.md)

## Problem

Baseline `b37ce6fa174` has 34,596 statically identifiable test case declarations in 3,224 tracked files. The initial cleanup removed a net 40 declarations. Repetitive setup and assertions that merely restate mock fixtures or pin implementation details still carry maintenance cost.

## Proposal

Remove approximately 10% of the baseline, or about 3,460 declarations through deletion or consolidation. Count inline-callback calls to Vitest and Playwright test APIs in tracked test and spec files. Count each parameterized declaration once and use the same AST query at both revisions. Record executed case totals separately for affected suites.

Review Renderer and Main first. They contain 29,156 baseline declarations. Group candidates by feature and test owner. Each deletion needs evidence of duplicate retained coverage, an assertion that cannot detect a relevant regression, or an unreachable production path. Preserve distinct coverage for persistence, permissions, failure recovery, concurrency, and user-facing workflows. Review the existing candidate index as leads, with file and case evidence in each implementation PR.

## Alternatives considered

- Deleting cases by matcher or fixture pattern alone is fast and can remove meaningful checks of external effects or independent inputs.
- Targeting file count or lines rewards deletion of large fixtures regardless of behavioral coverage.

## Acceptance criteria

- AC1 — Maintainers can reproduce the baseline and a reduction of approximately 3,460 declarations using one counting definition (verification: docs gate)
- AC2 — Each batch identifies the retained behavioral coverage or evidence supporting removal, and its explicitly scoped suites pass (verification: unit)
- AC3 — Changes affecting end-to-end coverage preserve the relevant user workflows in focused smoke runs (verification: Electron)

## Risks

Equivalent test bodies can exercise different setup or platform conditions. Review the fixtures and ownership before removal. Flag any shortfall if the evidence supports fewer deletions than the target.
