# Agent Note: Failed CLI detection does not establish absence

Status: implemented

English | [中文](2026-11-16-code-cli-detection-failure.zh.md)

## Problem

The Code page waited for remote version metadata before publishing local CLI snapshots. A failed snapshot request exhausted its retries with an empty status map, which the card interpreted as not installed. A missing entry had the same effect. Backend application `unknown` also offered a retry wired to installation, although unknown ownership does not authorize installation (#22887).

## Decision

Snapshot detection and backend application remain separate facts. The Code page publishes available local snapshots before waiting for version metadata. Pending or failed detection cannot establish absence or authorize an install; a retry reads snapshots again. A failed refresh retains the last known executable availability in the existing hook state, with detection uncertainty visible. No new persistent cache or inferred local installation is introduced.

Backend application `unknown` uses detection retry; verified runnable availability still permits launch. Confirmed absence retains the normal install action, and known broken installations retain their repair path. The currently selected Gemini page remains accessible while detection is uncertain so its retry is reachable. A missing latest version cannot support an up-to-date badge.

## Alternatives considered

- Treating every unsuccessful read as absence offers installation without evidence.
- Reusing install retry for a probe failure performs the wrong operation and can never establish reliable state.
- Waiting for remote metadata before publishing local availability makes a network outage hide independently established local facts.
- Persisting a second installation cache adds another source of truth and can outlive filesystem changes.

## Consequences

A failed refresh can display last-known availability, not a guarantee that the executable still exists. Subsequent snapshots replace it, and execution continues to use main-process validation. Detection retry remains usable even when the retained snapshot contains an old in-flight operation. This repair does not change binary installation recipes, version selection, or main-process snapshot derivation.

The early snapshot publication overlaps PR #21088. When integrating both, preserve the persistent-failure and missing-entry handling in addition to the early publication behavior.

## Verification

- Regression — `src/renderer/pages/code/hooks/__tests__/useCliVersionStatuses.test.ts`: delayed/failed metadata, snapshot failures and recovery, missing entries, confirmed absence, and retained local availability.
- Regression — `src/renderer/pages/code/components/__tests__/VersionStatusCard.test.tsx` and `src/renderer/pages/code/__tests__/CodeCliPage.test.tsx`: detection retry is distinct from installation, and uncertain selected tools remain reachable.
- Regression — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`: existing tests establish independently verified mise/system/bundled availability during backend listing failure and omission of failed latest-version results.

Renderer verification uses deterministic IPC fixtures; it does not establish real Windows offline behavior. Electron runtime validation is unavailable in this workspace because the native system-speech build requires Swift tools 6.2.0 while the installed toolchain provides 6.0.3.
