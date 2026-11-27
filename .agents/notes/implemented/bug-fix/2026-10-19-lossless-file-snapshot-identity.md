# Agent Note: Lossless file snapshot identity

Status: implemented

English | [中文](2026-10-19-lossless-file-snapshot-identity.zh.md)

## Problem

`openReadableFileSnapshot` compares a path's device/inode with its opened handle and carries that identity into diagnostic collection and upload checks. Number-valued stats can round distinct 64-bit file IDs above `2^53` to the same value. Equal size and millisecond modification time then cannot reliably expose a replacement. The existing `isSameFile` helper already uses BigInt stats for this NTFS limitation; snapshot reads did not.

## Decision

Read both path and handle stats with Node's `bigint` option, and retain device/inode as BigInt through the internal snapshot and diagnostic source identities. Keep byte counts numeric for existing stream contracts. Obtain modification time from a Number-valued stat on the same handle and floor it, matching the existing optimistic-write version check; BigInt `mtimeMs` truncation can disagree with Number rounding at a millisecond boundary. Reject a size outside the safe integer range before constructing a numeric stream length.

## Alternatives considered

- Number identities lose information before comparison; converting them to BigInt afterward cannot recover it.
- Delaying the test or changing timestamps would hide the collision while leaving the file identity check unsafe.
- Decimal strings would preserve identity but add conversions to an entirely in-process comparison. These identities are not serialized into diagnostic manifests, IPC responses or stored rows.

## Consequences

Snapshot consumers retain fixed-length handle reads and existing replacement rejection. Diagnostics can still stage the inspected prefix of a growing log with the same exact identity. The internal identity types and one test fixture change; no wire, persistence or provider behavior changes.

The deterministic large-ID regressions establish the precision defect on any platform. The observed Windows diagnostic test failure predates the Skills search diff, but its failed run did not record file IDs; this repair is not proof of that run's exact cause. Windows CI remains separate evidence.

## Verification

- Regression — `src/main/utils/file/__tests__/readableFileSnapshot.test.ts`: distinct device/inode values that collide as Numbers are rejected; exact large identities remain readable; unsafe stream lengths are rejected.
- Regression — `src/main/ai/agents/__tests__/heartbeatDocument.test.ts` and `src/main/utils/file/__tests__/fs.test.ts`: a snapshot version from a sub-millisecond timestamp remains valid for an unchanged-file save, while stale edits remain rejected.
- Regression — `src/main/services/diagnostics/__tests__/sourceCollector.test.ts`: real files exercise replacement rejection, growing-log prefixes and record filtering.
- Regression — `src/main/services/diagnostics/__tests__/CherryDiagnosticUploadClient.test.ts`: existing mutation and upload checks exercise snapshot consumers.
