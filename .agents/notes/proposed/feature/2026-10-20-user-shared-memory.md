# Agent Note: Desktop user-level Agent memory

Status: proposed

English | [中文](2026-10-20-user-shared-memory.zh.md)

## Problem

Agents retain their own facts but cannot share durable user preferences. Concurrent replacement of a shared Markdown file can lose updates even when individual writes are atomic.

## Proposal

The user approved this desktop-first implementation plan in the task conversation on 2026-10-20. Store shared facts and events in `USER_FACT.md` and `USER_JOURNAL.jsonl` under the registered `user.memory` directory. Keep all existing Agent files intact. Extend the existing memory tool with a default-agent scope and a read action. User fact replacement requires a content revision, with writes serialized in the single desktop main process. Reuse the Agent configuration JSON for an opt-out, defaulting to enabled. Both runtimes refresh separate shared and Agent sections. Settings loads and displays shared memory only on explicit request, then provides Markdown editing and journal browsing. Identity-file guidance permits durable user-stated preferences and corrections, excluding one-off instructions and redundant rewrites. Channel sessions cannot access the new shared tier.

## Alternatives considered

- A new database store duplicates the existing file memory and is unnecessary.
- A lock without revision checking still permits stale whole-file replacement.
- Channel identity and authority-review workflows are deferred; they require separate product and session contracts.

## Acceptance criteria

- AC1 — Agents share user facts without sharing their independent Agent facts, and omitted scope retains old tool behavior. (verification: unit)
- AC2 — Disabling user memory or using a channel session prevents shared injection and shared tool access in both runtimes. (verification: unit)
- AC3 — Concurrent stale updates fail without changing the current file; journal records remain complete and UI conflicts preserve drafts. (verification: unit | renderer)
- AC4 — Edits and deletions refresh on subsequent turns, session recovery, compaction, and local heartbeat; conflicting tiers remain separate. (verification: unit | Electron)
- AC5 — Initialization preserves existing files and new shared files survive backup and restore; platform coverage is reported separately. (verification: unit | Electron | docs gate)

## Risks

Memory is contextual evidence, not instruction authority. Deletion withdraws current recall but does not erase prior conversations or historical journal records. Arbitrary external editors do not participate in the application mutex. Full channel identity isolation and inferred-memory review remain outside this delivery.
