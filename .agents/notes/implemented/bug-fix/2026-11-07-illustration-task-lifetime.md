# Agent Note: Keep illustration cancellation and files with their reply owners

Status: implemented

English | [中文](2026-11-07-illustration-task-lifetime.zh.md)

## Problem

The [reply illustration contract](../../proposed/feature/2026-11-03-reply-illustrations.md) cancels unfinished images when the reply stops. Detaching the reply's abort listener at each failed or cancelled image attempt leaves an explicit retry running after Stop while the original reply is still streaming.

Temporary-chat illustrations use `manual` file cleanup, so discarding the chat leaves generated images permanently outside automatic cleanup. Changing the policy alone would instead let cleanup delete images that an open temporary chat still displays.

## Decision

An unpersisted illustration job keeps its reply abort subscription across failed and cancelled attempts. Terminal persistence detaches finished jobs; jobs still generating detach on completion, and service stop detaches remaining subscriptions. An explicit retry after the original reply has stopped can still start a new image request.

Generated outputs use `delete_when_unreferenced`. IllustrationService retains automatic input and output entries until terminal-message handoff. TemporaryChatService retains illustration inputs and outputs while their topic lives in memory, releases them on topic deletion, and releases them after successful promotion has committed message-file references. Failed promotion keeps the runtime references with the restored temporary topic. These holds reuse [FileManager runtime retention](../../../../docs/dev/references/file/file-entry-cleanup.md#44-temporary-runtime-retention).

## Alternatives considered

- Detach after every image attempt and reattach only for retries: duplicates cancellation ownership and can miss a terminal-to-retry handoff.
- Keep `manual` or release automatic files immediately: respectively leaks abandoned images or lets cleanup remove an open chat's content.

## Consequences

Cleanup can reclaim new unreferenced illustration outputs after its existing grace window, including after a crash. Saved message references continue protecting promoted images. Existing manual entries keep their policy; the repair does not downgrade independently retained files or rewrite historical entries.

## Verification

- Regression — `src/main/ai/__tests__/IllustrationService.test.ts`: stopping the original reply aborts explicit retries after both provider failure and individual cancellation, and late results cannot replace the cancelled state.
- Regression — `src/main/ai/__tests__/IllustrationService.cleanup.test.ts`: real SQLite and FileManager cleanup preserve images before and after text finalization, reclaim entries and physical files after discard, preserve failed promotion, and hand early or late results to saved message references.
- Regression — Six explicit main-process test files covering illustrations, temporary chats, message persistence, runtime file retention, and stream marker handling pass all 256 tests.
