# Agent Note: Background generation retains an existing reply

Status: implemented

English | [中文](2026-11-09-agent-background-reply-continuity.zh.md)

## Problem

A real Claude Code background Bash task completes after Main has persisted the parent's first answer. The adapter excludes shell tasks from pending child results, then emits a wake without its originating call. Main opens another assistant row labeled `Continued after background work`, splitting one user request into two product replies.

Holding every background shell until exit would also hold development servers indefinitely. The SDK exposes task identity and ambient activity, not a reliable finite-command versus resident-process distinction.

## Decision

Running shell commands retain connection occupancy without holding a product reply open. The Claude adapter retains root Bash call provenance and adds its result only when a non-ambient completion notification arrives. It uses existing SDK task and run fields; nested child shell calls do not acquire root ownership.

Main always reuses an existing assistant message for background generation. An open stream continues directly; a completed reply opens another receive-only execution with the same message ID. Preparation preserves the existing body, projection, author snapshot, conversation head and usage join. Final persistence and retry use the existing reply lifecycle.

A newly admitted input establishes the next product reply boundary. Before admission, native call ownership or the last projected assistant identifies the older reply, while the reserved input waits. Missing or mixed provenance never creates a new assistant identity: the existing admitted reply remains the owner. A wake with no existing product reply is diagnosed rather than inventing a row. Native archives remain authoritative for recovery.

The background continuation badge and its translations are removed. Background origin metadata remains for automatic read-aloud eligibility. Goal rounds still have independent product replies and their own labels. This replaces the standalone background fallback recorded in the [boundary ownership implementation](../../proposed/simplification/2026-11-05-agent-runtime-boundary-ownership.md).

## Alternatives considered

- Wait for every shell process: a server or watcher can prevent an otherwise completed reply from settling indefinitely.
- Recognize resident commands from command text or elapsed time: neither proves product completion or reply ownership.
- Keep the extra row and hide its badge: persistence, reply identity and usage remain split.
- Add another task or reply manager: existing native call provenance, root projection and reply state already provide the required ownership.

## Consequences

Command execution keeps its native foreground/background policy. A completed product reply can receive another execution without another user submission or assistant row. Updating an older reply does not select a different conversation head. Uncertain native provenance no longer has a standalone background row as its fallback. No SDK patch, dependency upgrade or migration is added.

## Verification

- Regression — `control.test.ts`: a root background Bash completion carries the original call whether the wake starts with a user or assistant frame; a running resident command still has no pending product result.
- Regression — `AgentSessionRuntimeService.handoff.test.ts`: completed and still-persisting replies retain their message ID, earlier body and idempotent usage without resending input; notifications before and after a new input's admission preserve two user reply boundaries without a third assistant row.
- Regression — `MessageHeader.test.tsx`: background metadata renders no continuation badge while goal-round labels remain visible.

- Regression — real-model Electron acceptance with Claude Code and LongCat-2.5: background Bash and child-agent completion each retain one assistant row; a second admitted user input retains two replies without a third continuation. UI process history, reloaded API/SQLite bodies and persisted usage associations are verified without injected SDK events.

The new shell-provenance and persisted-reply cases fail before the repair. SDK fixtures and Main SQLite regressions are distinct from real-model Electron acceptance.
