# Agent Note: Bound Claude archive transfers by bytes

Status: implemented

English | [中文](2026-11-14-claude-archive-transfer.zh.md)

## Problem

Restoring a Claude session sent the entire native archive across the worker boundary in one structured clone. Raw imported entries duplicated the bodies already present in the SDK-selected transcript. After transfer, archive reads and observation snapshots serialized large histories again on the main thread. In Electron 45.2.2, an isolated 448 MiB transcript with 200 messages reached multi-GiB RSS and exhausted the main V8 heap during the first observation.

## Decision

The [archive worker](../../../../packages/agent-runtime-claude-code/src/archiveWorker.mjs) transfers serialized buffers whose combined payload is at most 16 MiB per frame. It waits for the [reader](../../../../packages/agent-runtime-claude-code/src/archive.ts) to append each frame before sending the next. A final marker makes publication all-or-nothing. The worker sends only reconciliation fields from raw imports and reads children sequentially. The SDK still chooses chronological message content. The reader preserves empty children, message order and existing missing-session behavior.

Claude archive and observation copies duplicate the object and array containers, sharing immutable string values. Each caller can still mutate its copy without changing the owner or another observer's state. Other adapters retain the shared feed's default copy behavior.

## Alternatives considered

- Count records instead of bytes: a single rich message can dominate the frame, regardless of how many records it contains.
- Transfer the raw and normalized body together: reconciliation only needs raw metadata, including retractions, aborted/rejected messages and the child's parent.
- Share the archive objects with callers: a consumer could mutate the owner's state.

## Consequences

A normalized record larger than 16 MiB serialized fails the native restore through the existing error path, with a transfer-limit diagnostic. Native files stay intact and no partial archive is published. The chunk limit bounds transient handoff buffers. SDK reads and retained history still require memory proportional to the transcript, and total RSS depends on the history and allocator.

## Verification

- Regression — `pnpm test:agent-runtime-claude-code packages/agent-runtime-claude-code/tests/archive.test.ts` exercises the real SDK and worker for multi-chunk UTF-8 history, acknowledgement backpressure, empty children, copy isolation, and retry after an oversized record.
- Regression — Electron 45.2.2 main-process harness on macOS restores a 469,588,289-byte native transcript, reads committed history and drains the initial subscription. The baseline hit V8 OOM during subscription. The fixed build completed and matched the 200-message content SHA-256. The Windows packaged app and the original diagnostic transcript were outside this run.
