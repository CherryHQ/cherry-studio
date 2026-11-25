# Agent Note: Keep attachment preparation CPU work off main

Status: implemented

English | [中文](2026-11-09-attachment-preparation-workers.zh.md)

## Problem

Plain-text extraction decodes complete attachments on Electron main. After extraction, `allocateInlineCaps` exactly tokenizes every body and repeatedly tokenizes prefixes to find a maximal cut. The extraction cache saves decoding but does not save this budget work. A synthetic Chat with eleven 5 MiB text attachments and one PNG reproduced multi-second main event-loop stalls while the renderer stayed responsive. This is an independently reproduced blocking mechanism; it does not establish the cause of the original Windows conversation-entry report in #21956.

## Decision

FileManager owns reads and main keeps the content-version extraction cache. Pure encoding helpers live in `utils/textEncoding.ts`, shared by existing file helpers and an attachment worker. Plain-text decoding and attachment allocation use short-lived `?nodeWorker` threads. A shared queue permits two live workers; completion and failure release the worker, active abort terminates it, and queued abort skips creation without releasing another task's slot early. Decode diagnostics return to the central logger.

The attachment allocator uses UTF-8 byte length as a conservative ordinary byte-BPE token bound. Small bodies fit whole; large bodies share the remainder of the existing request pool. A forward code-point scan selects a fitting prefix. Attachment budgeting no longer runs exact BPE or a repeated prefix search. History/system/tool pricing still determines the pool, and truncation offsets remain UTF-16 positions for `read_file` paging.

## Alternatives considered

- Keep exact counting in a worker: preserves unnecessary work and repeated latency on cached text.
- Only cap individual file size: several accepted files can still monopolize main during token allocation.
- Utility process: this pure CPU work needs no native crash boundary or independent environment; the repository's worker-thread precedent has lower overhead.

## Consequences

Conservative pricing can inline less content, particularly ASCII prose and compressible text. The existing continuation tool remains available to tool-capable models; other models receive the truncated head. Input byte reads, full extracted-text caching, PDF/Office parsing, and history/system/tool counting are outside this CPU-path repair. Worker startup and structured cloning still have measurable cost, and cancellation does not cancel FileManager's existing read operation.

## Verification

- Regression — six scoped main test files cover byte-budget conservation, Unicode cuts, large text, extraction compatibility, routing, paging, worker failures, running/queued cancellation, and the two-worker limit: 112 tests pass.
- Electron — one cold before/after Chat send with eleven 5 MiB malformed legacy-text attachments and one PNG, a local OpenAI-compatible server, real FileManager entries, UI sending, and SQLite persistence passes; the outgoing request contains eleven truncated attachment texts and one image.
- Performance — the single macOS development pair records main maximum event-loop lag 4052 ms → 176 ms, response latency 6900 ms → 3401 ms, and independent legacy 3-second probe timeouts 4 → 0. Profiles attribute the removed main CPU work to decoding and attachment BPE. This is not a statistical benchmark, packaged validation, a real-provider test, or Windows OS-freeze acceptance.
