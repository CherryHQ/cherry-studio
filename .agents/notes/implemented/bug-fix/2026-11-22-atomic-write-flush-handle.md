# Agent Note: Atomic writes flush the original write handle

Status: implemented

English | [中文](2026-11-22-atomic-write-flush-handle.zh.md)

## Problem

The atomic writer closed its temporary output and reopened it with `r+` during commit to sync and stat it. A destination may accept a sequential write but reject a read/write reopen. [Issue #25004](https://github.com/CherryHQ/cherry-studio/issues/25004) reports that failure at backup completion on GVfs/SMB. The source contains the reported reopen; fault-injected real-file tests reproduce its failure without needing a mounted share.

The prepared-stream API also promises a flushed temporary file before invoking its callback. Waiting only for the write stream's end callback is not waiting for its descriptor to close or for Node's close-time flush.

## Decision

Restore the existing flush-before-handoff contract at the writer that owns the open descriptor. In-memory preparation syncs its original write handle before closing. Stream preparation uses Node's `createWriteStream({ flush: true })` and waits for `finished()` including close before handing off prepared bytes. Commit stats the prepared path and renames it without reopening it. Stream abort cleanup waits for actual close, including a pending flush, rather than treating `destroyed` as proof the descriptor is closed.

No sync error is ignored. A file-sync failure still rejects, preserves the previous destination and cleans up the temporary output. Same-directory temporary placement, rename publication, creation modes, hashes, metadata ownership and best-effort directory fsync remain unchanged. This is not a weaker network-filesystem durability mode.

## Alternatives considered

- Skip fsync or write directly into the final backup: rejected because either can weaken the existing persistence contract or destroy the previous backup on failure.
- Retry the reopen read-only: rejected because it still requires reopening the completed object and does not address the prepared-stream handoff ordering.
- Add custom descriptor flushing for streams: unnecessary; [Node's filesystem API](https://nodejs.org/api/fs.html) provides the close-time `flush` option in the supported runtime.

## Consequences

Preparation now finishes its file sync before a caller can receive prepared bytes, including callers that later abort instead of commit. That follows the existing prepared-stream promise. Unsupported file-sync operations remain failures rather than silently accepting a potentially unsafe backup.

Real GVfs/SMB and packaged Electron acceptance are not established by these tests. This repair does not add destination-setting preflight or a new UI warning. It does not establish that every filesystem supports rename or fsync. Issue #25004 remains referenced, not declared resolved, while that environment boundary and the broader setting-preflight request remain.

## Verification

- Regression — `fs.atomic-durability.test.ts`: real buffer and stream bytes replace an existing destination under an injected `r+` ENOTSUP restriction, without temporary residue; file-sync EIO/ENOTSUP preserve the old destination; delayed sync prevents early publication and abort waits for closure.
- Regression — `fs.test.ts` and `fs.errno-warn.test.ts`: existing prepared writes, modes, hashes, conditional writes, copies, downloads, abort, rename failures and error observability pass.
- Regression — `LegacyBackupManager.test.ts`, `sentryLog.test.ts`, `FileManager.integration.test.ts`, `FileManager.ipc-v2.test.ts`, `FileEditService.test.ts` and `BootConfigService.test.ts`: scoped consumer tests pass; they are not a real network-share or packaged-application run.
