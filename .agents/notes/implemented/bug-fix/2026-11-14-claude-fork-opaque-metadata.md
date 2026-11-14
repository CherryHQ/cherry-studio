# Agent Note: Claude fork compaction metadata stays SDK-owned

Status: implemented

English | [中文](2026-11-14-claude-fork-opaque-metadata.zh.md)

## Problem

Claude fork preparation recursively remapped every string and object key in `compactMetadata`, compared the projected value with SDK output, and rejected any surviving source UUID. SDK 0.3.311 remaps only its recognized reference fields and preserves other metadata. An opaque annotation containing a source or dropped-progress UUID therefore caused `unsupported_checkpoint` even when the fork retained the same context.

## Decision

The [Claude worker](../../../../src/main/ai/runtime/claudeCode/forkWorker.ts) delegates compaction metadata interpretation and remapping to the SDK. It does not project or recursively scan that metadata. Before staging, SDK history read-back still requires the selected checkpoint and the same ordered message identities, types and contents under the SDK's UUID mapping.

Duplicate-UUID checks, content-replacement checks, inherited checkpoint mapping, source-file consistency, cancellation and publication ownership remain in their existing layers. This is a local compatibility repair, not a new native history implementation.

## Alternatives considered

- Keep recursive projection and scanning: rejected because UUID-looking annotation values and keys are not evidence of native references.
- Add a Cherry whitelist of compaction references: rejected for this repair because it duplicates SDK interpretation while read-back already checks the resulting context.
- Accept every successful SDK fork: rejected because the pinned SDK can lose context when a retained message points through an excluded sidechain; the existing regression keeps that failure explicit.

## Consequences

SDK-readable opaque annotations no longer block Fork or Edit and resend preparation. Unsupported checkpoints and observable context changes still fail before staging. Read-back is not proof that every native resume transformation is equivalent; the native continuation tests compare the actual requests sent by resumed sessions.

The tests use an isolated native CLI profile and a scripted local model endpoint. They do not prove Electron UI, packaged applications, live model accounts, or other operating systems.

## Verification

- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/nativeContract.test.ts --maxWorkers=1`: compares source, child and historical grandchild continuation requests for retry, compaction, opaque annotations and preserved context; the opaque-annotation case reproduces `unsupported_checkpoint` before the repair.
- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts --maxWorkers=1`: exercises the real SDK worker for opaque metadata, preserved compaction context, hidden checkpoints, excluded sidechains, source immutability and pre-staging rejection.
