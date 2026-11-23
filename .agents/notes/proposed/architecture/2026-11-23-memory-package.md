# Agent Note: Portable shared memory package

Status: proposed

English | [中文](2026-11-23-memory-package.zh.md)

## Problem

The [shared memory Spec](../feature/2026-10-29-shared-memory.md) defines what an Assistant or Agent can remember. Its [desktop implementation](../../../../src/main/ai/memory/README.md) couples those rules to Electron identities, Node file operations, Drizzle queries and desktop jobs. The [mobile app](https://github.com/CherryHQ/cherry-studio-app/tree/41afc6ecbaa168ef66e23ed75f09851042707e94) has its own session, storage and model services. Reimplementing the rules there would give each client a different place to fix a lost correction, stale write or history leak.

## Proposal

Deliver `@cherrystudio/memory` in `packages/memory`. Use the complete [desktop tree at 8231bf0](https://github.com/CherryHQ/cherry-studio/tree/8231bf06993490cdc7c3e15f0b73d456beef8fc7/src/main/ai/memory) as the behavioral baseline for shared and Agent-private scopes. The package implements the flows below. Desktop cutover, mobile integration and device tests, npm publication and cross-device synchronization are separate deliveries. Desktop retains its legacy FACT upgrade and editor UI.

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

### Delivery

P1 defines this contract. P2 delivers neutral public types, formats and byte limits. P3 delivers controlled storage, conversation context and recovery. P4 delivers model-backed extraction, correction and durable admission. P5 delivers Dreaming and shared scheduling. P6 delivers recall. P7 delivers documentation, a source-to-package map and an installable tarball. Use one dependent PR per layer. Compare the source map with upstream fixes before accepting the artifact.

## Alternatives considered

- Copy the desktop service into mobile. Its file identity, authorization and session lifecycle depend on the desktop process.
- Share schemas and prompts alone. Each app would still own the decisions that can lose a correction or replay an interrupted write.
- Migrate both apps in this stack. That couples package review to two runtime integrations. An independent consumer can exercise the public contract first.

## Acceptance criteria

- AC1 — A consumer outside the workspace can install the tarball, resolve the ESM and CJS entries and consume their declarations. (verification: packaged artifact, P7)
- AC2 — The runtime and declarations resolve without Electron, Node built-ins, React, database drivers or desktop aliases. The React Native export selects the neutral implementation. (verification: packaged artifact dependency and export checks, P2/P7)
- AC3 — Markdown round trips preserve its bytes. Entry filtering, missing versus empty files and multibyte truncation match the baseline. (verification: unit, P2)
- AC4 — A stale file or file set, edited proposal, expired receipt, cancellation or revocation before final commit prevents the write. (verification: unit, controlled interleavings, P3)
- AC5 — An interrupted multi-file commit reports individual outcomes. A new engine can reconcile the backup with actual files and resume eligible recovery. (verification: unit, fault injection, P3)
- AC6 — Adds and all three correction cases retain quoted evidence, conditions and source-local dates. Fabricated references fail and invalidated copies leave the current view. (verification: unit, fixed model outputs, P3/P4)
- AC7 — Eight successful turns or local 21:00 make a batch due. Restart resumes without duplicate saves. Foreground activity defers work and revocation invalidates it. Independent switches and organization triggers operate through the shared worker. (verification: unit, controlled clock and restart, P4/P5)
- AC8 — Recall isolates owners and selected branches, excludes the current message, enforces its call budget and reports expansion, truncation and applicable corrections. (verification: unit, branched conversation fixtures, P6)
- AC9 — Conversation snapshots stay stable. Invalidation, purpose filtering, forgetting and recovery prevent protected or superseded text from reappearing in current context. (verification: unit, context and recovery scenarios, P3/P4)
- AC10 — An independent consumer using the installed tarball and a test host completes read, extract, commit, organize, search, clear and recover through public operations. (verification: packaged artifact, P7)

## Risks

Two implementations will coexist until desktop adoption. Pin source revisions, port behavioral cases and track relevant fixes. A test host can demonstrate ordering and recovery at the package boundary. Native adapters must separately prove file identity, conditional replacement and revocation ordering on their own storage. A JavaScript permission check followed by an asynchronous bridge write leaves an interval in which permission may change.
