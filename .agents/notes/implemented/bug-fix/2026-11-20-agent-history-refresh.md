# Agent Note: Refresh changed Agent messages by ID

Status: implemented

English | [中文](2026-11-20-agent-history-refresh.zh.md)

## Problem

A message projection notification refreshed every loaded Agent history page. Each page read deserialized stored message bodies in Main, including large tool outputs. The selected branch also depended on these reads to discover some newly reserved messages.

## Decision

Publish membership after committing stream reservations. For a projection with IDs, reload only affected loaded rows through the session-scoped detail read. Use the same deferred tool-output projection and Main-owned history actions as the list, and preserve cached sibling groups. When saving an assistant checkpoint can change a direct user reply's edit eligibility, include that reply in the notification.

For a known append, fetch the head page through its previous cursor boundary. Reuse older pages after verifying the existing head is an unchanged suffix and the cursor still matches. Refresh the cursor chain when a notification lacks IDs or the head cannot prove that the rest of the branch is unchanged.

The Agent page reconciles the affected assistant rows before completing the stream overlay handoff or refreshing an approval card. The cached branch is revalidated when the stream has no known anchor or a required message is missing from the loaded history.

Backward pagination keeps the expanded head and its cursor. A detail response replaces a row only while the same cached row is still present, so a clock rollback cannot suppress a terminal reply. Session reassignment invalidates history actions for the whole session.

## Alternatives considered

- Revalidating the page containing a change still deserializes the other message bodies on that page.
- Using reservation payloads as cache truth can expose messages from a branch that Main did not select.

## Consequences

A keyed content change leaves loaded page boundaries intact. Appends can grow the head page within the list limit. Branch changes, deletions without a cursor hint, and explicit history refreshes can still rebuild the loaded cursor chain.

## Verification

- Regression — `useAgentSessionParts.revalidation.test.ts` checks single-row requests, append reuse, concurrent pagination, and selected-branch replacement with the real SWR cache.
- Regression — `agentSessionMessages.test.ts` and `AgentSessionMessageService.test.ts` cover projected detail reads, deferred output, and edit eligibility invalidation.
- Regression — Electron development build with 180 seeded messages and a loopback model. Three Pi Durable turns each completed a streamed child and root reply. List reads fell from 36 to 3 and sampled allocation under `listSessionMessages` fell from 479 MiB to 45 MiB. In a separate run, six updates to one loaded row replaced 24 list reads with six detail reads.
- Regression — Full Agent page on macOS Electron with 180 seeded messages and a loopback vision model. In each of six rounds, four concurrent Pi Durable subagents read five 1 MiB PNGs each. Compared with the initial fix, list reads fell from 30 to 6 and sampled list allocation from 402 MiB to 89 MiB.
