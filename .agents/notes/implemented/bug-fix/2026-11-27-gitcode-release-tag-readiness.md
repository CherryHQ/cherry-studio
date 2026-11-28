# Agent Note: Verify the mirrored tag before publishing GitCode release files

Status: implemented

English | [中文](2026-11-27-gitcode-release-tag-readiness.zh.md)

## Problem

GitHub can publish a release before GitCode imports its tag. The v2.2.4 GitCode release write returned HTTP 400 while the tag and its commit were missing from the mirror. The create request targeted `main`, which may point to a different commit than the build.

## Decision

The [GitCode sync script](../../../../scripts/release/sync-gitcode.sh) waits for the exact release tag in COS-backed runs. The tag must resolve to the build SHA recorded in COS before any release metadata or attachments are written. A missing tag is retried, a wrong SHA stops the job, and a timeout reports the current Pull mirror state.

## Alternatives considered

- GitCode rejects Git pushes to its Pull mirror. Its public mirror endpoint reads configuration and status. The web console can trigger a pull, which can force-update diverged branches when that option is enabled.

## Consequences

A delayed mirror can become ready in the same run. If manual recovery is needed, `sync-only` can reuse the existing COS inventory after the tag arrives.

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/gitcode-sync.test.ts scripts/__tests__/release-workflow.test.ts`: a delayed tag permits writes only after it resolves to the build SHA, and missing or mismatched tags leave GitCode release data untouched.
