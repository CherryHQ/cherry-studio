# Agent Note: Validate Changeset package eligibility

Status: implemented

English | [中文](2026-11-18-changeset-package-eligibility.zh.md)

## Problem

Changesets can name internal or unchanged packages. Skipping a package during versioning does not prevent contributors from adding such entries.

## Decision

The existing `changeset:check` gate rejects unknown, private, and ignored packages in every pending Changeset. It uses Changesets configuration and workspace discovery rather than npm registry state or dependency protocols.

With `--base <ref>`, newly added or edited Changesets must reference packages with changed files against the merge base, including local staged, unstaged, and untracked changes. PR CI supplies its target branch. Release automation omits this comparison because main accumulates Changesets from multiple PRs.

## Alternatives considered

- Relying on Changesets skip settings does not reject invalid entries at contribution time.
- Checking every pending Changeset against one PR would reject valid entries inherited from the base.
- Checking npm publication history would prevent first releases and introduce a network dependency.

## Consequences

Empty Changesets remain valid. Workspace dependency protocols do not determine eligibility. Any file change inside the package counts, including documentation and deletions; the gate does not decide whether that change deserves a release. Dependency-induced version bumps remain the responsibility of Changesets.

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/changeset-policy.test.ts`: real Git fixtures cover invalid package entries, local and committed package changes, inherited Changesets, and first releases outside `packages/*`.
