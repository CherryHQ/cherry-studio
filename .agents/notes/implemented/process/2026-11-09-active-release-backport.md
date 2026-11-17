# Agent Note: Release branch selection for hotfix backports

Status: implemented

English | [中文](2026-11-09-active-release-backport.zh.md)

## Problem

The hotfix workflow discovers targets by joining draft GitHub Releases to release branches. The first successful build creates the draft, so hotfixes merged before that build succeeds require manual backporting. This happened to [#24023](https://github.com/CherryHQ/cherry-studio/pull/24023#issuecomment-6738737793) while the v2.2.0 branch already existed.

## Decision

Cherry Studio maintains one active release line. Automatic hotfix backports select the highest semantic-version `release/v…` branch when its version exceeds every published release. A draft is optional. If the highest branch is already published or older than a published version, the workflow skips the backport.

The workflow resolves the target under the release-state lock and rechecks the selected branch and its expected head before writes. It preserves the existing topic branch lease, aggregate PR handling, source tracking, and bilingual release notes.

## Alternatives considered

- Require a matching draft. This blocks automatic backports during initial build recovery.
- Use a repository variable. This adds a manual activation step for each release cycle.

## Consequences

Preparing the next version's branch makes it eligible for hotfixes before the first build. Abandoning an unpublished version requires removing its branch through the documented release procedure.

## Verification

- AC1 — The resolver selects the same eligible branch with or without a draft. A read-only GitHub query selected `release/v2.2.0`. Production PR creation remains to be exercised after merge.
- AC2 — Focused tests cover semantic-version ordering, published versions, and API failures.
- AC3 — Focused tests reject a newer target, a changed release head, and publication before a write.
- AC4 — The release guide documents target selection, first-build recovery, and abandonment. The documentation gate passes.
