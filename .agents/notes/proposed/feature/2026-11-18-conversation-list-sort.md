# Agent Note: Independent conversation list sorting

Status: proposed

English | [中文](2026-11-18-conversation-list-sort.zh.md)

## Problem

Chat topics and Agent sessions derive their row order from their grouping mode. Time groups use activity order, while owner/workspace groups use `orderKey`; the Chat right panel has another manual-order exception. Switching grouping can therefore change ordering without an explicit choice. Collection pagination always reads manual order, so sorting loaded rows cannot surface a recently active conversation on a later page.

Existing rows all have `orderKey`, including rows never dragged. There is no historical drag flag.

## Proposal

Add a Sort by submenu beside Group by in the shared conversation list menu. Chat and Agent each persist one independent sorting preference, shared by their conversation list surfaces. Offer Last updated, Date created, Name and Manually. Automatic sorts have descending/ascending choices; manual order has no direction control. Grouping retains ownership of section placement and group order. Pinned rows retain their independent pin order.

Last updated means `lastActivityAt`, so rename and reorder writes cannot promote a conversation. Automatic modes disable conversation-row reordering; Manually enables existing valid within-group and owner-transfer drops. Changing grouping never changes the saved sorting preference. Switching automatic sorting never overwrites `orderKey`.

Before default preferences are seeded, initialize only missing sorting preferences from the complete active conversation tables, separately for Chat and Agent. Read rows by `orderKey ASC, id ASC`: any increase in `createdAt` means the stored order differs from default newest-created-first order, so choose Manually; otherwise choose Last updated descending. Equal creation timestamps are inconclusive. Exclude trashed rows, pins and task/background sessions from the Agent comparison. Never repeat inference after a preference exists. This preserves current custom order, but cannot identify a drag that restored creation order or whose evidence was deleted.

Collection queries accept explicit sort field and direction. Apply sorting before cursor pagination, retain pin precedence and an ascending id tiebreak, and include the sorting choice in renderer cache keys. Use the same within-group order in all conversation list surfaces. Omitted query sorting keeps the existing API default for unrelated consumers.

## Alternatives considered

- Treat every non-empty `orderKey` as a drag marker: rejected because creation assigns it too.
- Infer from `updatedAt`: rejected because messages and metadata also change it.
- Sort only the loaded renderer rows: rejected because later pages can contain the actual first result.
- Rewrite manual keys when selecting an automatic sort: rejected because switching back must restore the custom order.

## Acceptance criteria

- AC1 — Chat and Agent menus show independent grouping and sorting controls, selected values, four sorting modes and automatic-sort directions (verification: renderer and Electron)
- AC2 — Changing groups preserves the selected sorting mode; activity changes affect Last updated order and preserve Manually order (verification: renderer)
- AC3 — Missing preferences infer manual versus activity order from complete active rows; equal timestamps, empty data, excluded rows and subsequent runs preserve the initialization contract (verification: main database tests)
- AC4 — Every automatic sort and direction produces deterministic complete pagination across pin boundaries, tied values, empty names and names containing cursor punctuation (verification: main database tests)
- AC5 — Automatic sorts preserve manual keys and disable row reordering; switching to Manually restores the stored custom order, while pins retain pin order (verification: renderer and Electron)

## Risks

Legacy inference recognizes current order rather than historical actions. Imports may also create a non-default order and will be preserved as Manually. Time grouping still assigns rows to activity buckets, so row ordering applies within those buckets. No shipped schema migration is rewritten and no conversation rows are changed by preference initialization.
