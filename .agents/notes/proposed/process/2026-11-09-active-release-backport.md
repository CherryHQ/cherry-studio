# Agent Note: Explicit release branch selection for hotfix backports

Status: proposed

English | [中文](2026-11-09-active-release-backport.zh.md)

## Problem

The hotfix workflow discovers targets by joining draft GitHub Releases to release branches. The first successful build creates the draft, so hotfixes merged before that build succeeds require manual backporting. This happened to [#24023](https://github.com/CherryHQ/cherry-studio/pull/24023#issuecomment-6738737793) while the v2.2.0 branch already existed.

## Proposal

Use the GitHub repository variable `ACTIVE_RELEASE_BRANCH` as the sole selector. A release maintainer sets it to the full branch name, such as `release/v2.2.0`, after preparation creates the branch and clears it when the release is abandoned or published. An unset variable pauses automatic backports with an explicit run message. Validate the existing release branch naming pattern and resolve the exact repository ref. A malformed value or missing branch fails with a diagnostic.

Allow the selected target to have either no GitHub Release or a draft for its version. A published release blocks writes even if the variable still points to its branch. Treat failures to read configuration, refs, or release state as errors. Use trusted repository configuration and confirm the workflow credential can read it. Before modifying the topic branch or opening a PR, recheck the live selection, release state, and expected release head. Preserve the existing release-state lock, topic branch leases, aggregate PR and retry behavior, source tracking, and bilingual note handling.

Document how to set and clear the selector. Set it for the intended active release when rolling out the implementation so eligible hotfixes continue to route correctly. Draft creation, build dispatch, and publication remain owned by the release workflows.

## Alternatives considered

- Keep draft-based selection. This leaves automatic backports unavailable during initial build recovery.
- Choose the newest release branch. Retained historical branches and concurrent release preparation make version ordering an unreliable signal of maintainer intent.

## Acceptance criteria

- AC1 — With an explicitly selected release branch and no GitHub Release for its version, a merged eligible hotfix opens or updates a PR targeting that branch with its source marker and bilingual notes. The same behavior works when a draft exists. (verification: a GitHub workflow exercise; owner: implementation author)
- AC2 — With an unset, malformed, or missing target, a published release, or an API read error, the workflow does not create or update a backport branch or PR. (verification: focused workflow tests; owner: implementation author)
- AC3 — If the selected target or release head changes, or the version is published before write-time revalidation, the run stops before writing stale state. Retrying an unchanged eligible hotfix preserves existing aggregation and idempotency. (verification: focused workflow tests; owner: implementation author)
- AC4 — The release guide documents activation and deactivation, including the first-build recovery path. (verification: the documentation gate and review of both languages; owner: implementation author)

## Risks

A maintainer must set the selector when opening a new release cycle. Reading the live variable requires a credential with repository variable read access. Verify this access in GitHub before rollout.
