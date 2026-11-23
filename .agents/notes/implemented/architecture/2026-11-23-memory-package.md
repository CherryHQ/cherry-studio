# Agent Note: Portable shared memory package

Status: implemented

English | [中文](2026-11-23-memory-package.zh.md)

## Problem

The [shared memory Spec](../../proposed/feature/2026-10-29-shared-memory.md) defines what an Assistant or Agent can remember. Its [desktop implementation](../../../../src/main/ai/memory/README.md) couples those rules to Electron identities, Node file operations, Drizzle queries and desktop jobs. The [mobile app](https://github.com/CherryHQ/cherry-studio-app/tree/41afc6ecbaa168ef66e23ed75f09851042707e94) has its own session, storage and model services. Reimplementing the rules there would give each client a different place to fix a lost correction, stale write or history leak.

## Decision

Cherry Studio provides `@cherrystudio/memory` in `packages/memory`. Use the complete [desktop tree at 8231bf0](https://github.com/CherryHQ/cherry-studio/tree/8231bf06993490cdc7c3e15f0b73d456beef8fc7/src/main/ai/memory) as the behavioral baseline for shared and Agent-private scopes. The package implements the flows below. Desktop cutover, mobile integration and device tests, npm publication and cross-device synchronization are separate deliveries. Desktop retains its legacy FACT upgrade and editor UI.

### Host contract

| Host dependency | Contract |
| --- | --- |
| `MemoryStorage` | Read logical names as bytes and versions, including missing files and file-set identity. Persist backups before the first mutation. At final replacement, enforce the expected version, actual target identity and current authorization. Define how concurrent writers and revocation are ordered. |
| `MemoryStateStore` | Persist per-scope progress, generations, fingerprints, pending source references and write intents across engine restarts. The package owns state transitions. Keep conversation text out of maintenance state. |
| `MemoryConversationSource` | Supply authorized owner, selected branch, message identity, role, completion state, source-local date and version. Search within that owner and revalidate the snapshot before use or commit. |
| `MemoryModel` | Bind an operation to a resolved model and token limits. Count tokens and generate text with cancellation. The host owns credentials and transport. Extraction and organization use bounded input with tools, implicit retries and automatic trimming disabled. |
| `MemoryAccess` and runtime signals | Bind scope and caller to a host-issued capability. Provide revalidation, revocation, foreground activity, clock, IDs and hashing. The host schedules wakeups and registers tools. |

### Public operations

- `createMemoryEngine(ports)` owns a write queue per scope and one maintenance worker. Opening a session requires live access. A full read returns bytes or text and an edit receipt bound to the caller and version. Entry and model reads return bounded or purpose-filtered views. Bind prompt context and its protection fingerprint to the conversation.
- Commit an approved, exact proposal using its read receipts. Persist the original bytes and return a result per file: `applied`, `unchanged`, `conflict` or `pending`. Preview clear and recovery against a specific file set. After interruption, reconcile actual files with the backup before continuing. Pause, invalidate, drain and dispose release work and revoke stale output.
- Preview extraction over an authorized range. Record permission at user submission and register a turn after its successful reply. Fix the batch endpoint on the selected branch. Process eight eligible turns or the remainder at local 21:00. Resume registered work after an ordinary restart and discard stale model output. Keep at most 16 visible messages, 32,000 UTF-8 bytes total and 8,000 per message. Preserve gaps and remove whole turns to meet the budget.
- Validate verbatim user evidence and recheck source and memory versions before saving. An explicit correction binds a unique complete old entry to the user's words. Preserve whether a fact changed, was mistaken or gained a condition. Current reads hide invalid copies across files. Historical reads retain the reason and source-local time. Recovery and organization preserve those protections.
- Run one maintenance pass on host wakeup. Extraction and Dreaming have independent switches and share the worker. Organization uses ten controlled changes, seven days of pending changes, capacity pressure or a manual request as triggers. Foreground activity defers work. Release the write lock during inference and revalidate inputs at commit. When moving a topic, write its destination and update links before deleting its source.
- Export the `memory_search` definition and execution. Bind searches and expansions to the trusted owner and selected branches, exclude the current message by ID and count both operations against four calls per answer. Return bounded excerpts with correction and truncation information. Hosts own the FTS query and MCP, AI SDK or runtime tool registration.

## Alternatives considered

- Copy the desktop service into mobile. Its file identity, authorization and session lifecycle depend on the desktop process.
- Share schemas and prompts alone. Each app would still own the decisions that can lose a correction or replay an interrupted write.
- Migrate both apps in this stack. That couples package review to two runtime integrations. An independent consumer can exercise the public contract first.

## Consequences

Two implementations will coexist until desktop adoption. Pin source revisions, port behavioral cases and track relevant fixes. A test host can demonstrate ordering and recovery at the package boundary. Native adapters must separately prove file identity, conditional replacement and revocation ordering on their own storage. A JavaScript permission check followed by an asynchronous bridge write leaves an interval in which permission may change.

## Verification

- AC1 — `scripts/check-package.mjs`: The installed tarball resolves both JavaScript entries and their TypeScript declarations.
- AC2 — `scripts/check-package.mjs`: A standalone browser bundle resolves all runtime dependencies. The installed workflow also runs with the React Native export condition.
- AC3 — `tests/format.test.mjs`: Markdown round trips, missing and empty views and multibyte line limits pass.
- AC4 — `tests/store.test.mjs`: A changed file set, a stale receipt or a revoked approval prevents the proposed write.
- AC5 — `tests/store.test.mjs`: A fresh store restores the committed portion after a simulated multi-file failure.
- AC6 — `tests/extraction.test.mjs`: Fixed model outputs exercise adds, all three correction reasons, source-local dates, hidden duplicates and invented quotes.
- AC7 — `tests/dreaming.test.mjs, tests/extraction.test.mjs, tests/workflow.test.mjs`: The tests exercise eight turns, the local daily cutoff, recovery after a file commit, foreground interruption, independent switches, ten changes and seven days.
- AC8 — `tests/recall.test.mjs`: Branched history tests cover owner isolation, current inputs, the shared search/expansion budget, truncation and correction metadata.
- AC9 — `tests/dreaming.test.mjs, tests/extraction.test.mjs, tests/workflow.test.mjs`: Context, correction and recovery tests cover stable entry reads, hidden obsolete copies and clear/undo across sessions.
- AC10 — `scripts/check-package.mjs`: The installed consumer completes extraction, commit, restart, organization, recall, clear and recovery.
