# Agent Note: Reuse older Agent history pages on append

Status: implemented

English | [中文](2026-11-20-agent-history-refresh.zh.md)

## Problem

[The timeline update](https://github.com/CherryHQ/cherry-studio/pull/25406) reads committed replies by ID. New reservations still triggered a read of every loaded history page. Growing the first page on each append also lost already visible history when the page reached the endpoint's 200-row limit and a refresh returned to 50-row pages.

## Decision

Use the same history refresh path for committed membership notifications and reservation acknowledgments. Verify the new prefix against the selected branch before publishing it. Keep a normal 50-row first page and carry any partial page directly behind it so scrolling can reuse the remaining server-issued cursors. Each read stays within the normal page size even when one notification contains more than 200 IDs.

A branch change or an append that cannot be verified uses history revalidation. A late append cannot replace a different cache snapshot or interrupt an in-flight history refresh.

## Alternatives considered

- Growing the first page eventually reaches the API limit. Rebuilding the same number of pages at the normal size then loses loaded rows.
- Seeding the history directly from a reservation acknowledgment can expose a branch Main did not select.

## Consequences

A typical turn updates one history page over IPC. Older loaded messages stay visible through repeated appends, and the oldest loaded cursor still leads to the next page of history.

## Verification

- Regression — `useAgentSessionParts.revalidation.test.ts` uses the real SWR cache to cover over 200 appended messages, subsequent backward pagination, and a branch switch during an append.
- Earlier profiling of the original approaches on the full Agent page remains recorded in [the previous #24960 snapshot](https://github.com/CherryHQ/cherry-studio/blob/11a500ebe8ffded55e980f9d41609d04f97c95b5/.agents/notes/implemented/bug-fix/2026-11-20-agent-history-refresh.md#verification). Those results predate the current timeline and paging implementation.
