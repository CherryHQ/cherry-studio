# Agent Note: Independent conversation list sorting

Status: implemented

English | [中文](2026-11-18-conversation-list-sort.zh.md)

## Problem

Chat topics and Agent sessions derive their row order from their grouping mode. Time groups use activity order, while owner/workspace groups use `orderKey`; the Chat right panel has another manual-order exception. Switching grouping can therefore change ordering without an explicit choice. Collection pagination always reads manual order, so sorting loaded rows cannot surface a recently active conversation on a later page.

Existing rows all have `orderKey`, including rows never dragged. There is no historical drag flag.

## Decision

The shared conversation list menu exposes a Sort by submenu beside Group by. Chat and Agent each persist one independent sorting preference, shared by their conversation list surfaces. It offers Last updated, Date created, Name and Manually. Automatic sorts have descending/ascending choices; manual order has no direction control. Grouping retains ownership of section placement and group order. Pinned rows retain their independent pin order.

Last updated means `lastActivityAt`, so rename and reorder writes cannot promote a conversation. Automatic modes disable conversation-row reordering; Manually enables existing valid within-group and owner-transfer drops. Changing grouping never changes the saved sorting preference. Switching automatic sorting never overwrites `orderKey`.

Before default preferences are seeded, `ConversationListSortSeeder` initializes only missing sorting preferences from the complete active conversation tables, separately for Chat and Agent. Rows are read by `orderKey ASC, id ASC`: any increase in `createdAt` means the stored order differs from default newest-created-first order, so choose Manually; otherwise choose Last updated descending. Equal creation timestamps are inconclusive. Trashed rows and pinned rows are excluded, as are task/background Agent sessions. Inference stops once a preference exists. This preserves current custom order, but cannot identify a drag that restored creation order or whose evidence was deleted.

Collection queries accept explicit sort field and direction. Sorting precedes cursor pagination, retains pin precedence and an ascending id tiebreak, and is included in renderer cache keys. The sidebar and right panel use the same within-group order. Omitted query sorting keeps the existing API default for unrelated consumers.

Name sorting uses one shared `Intl.Collator` comparator with the application locale, natural numeric ordering, case-insensitive accent-sensitive comparison and significant punctuation. Canonically equivalent names and numeric/case ties use ascending id as the final key in both directions. All 17 supported UI locales use their ICU/CLDR rules, including Latin, Greek, Cyrillic, Thai, Han and Japanese kana; other scripts in titles use that same locale's mixed-script ordering. Japanese kanji are not automatically converted to readings.

Name queries carry a validated locale in the query/cache key. Changing application language starts a new page chain. The main process reads only eligible unpinned `(id, name)` pairs, sorts and applies the name/id cursor with the shared comparator, then hydrates the bounded page in that order. This avoids a native SQLite ICU extension; other sorts retain their SQL pagination. Pins and all domain filters retain their existing behavior.

Stateless metadata selection and key parsing live in `main/utils/listOrdering.ts`, with no data-layer dependency. Field selection, defaults, eligibility queries, SQL ordering and cursor composition stay in the owning data services.

## Alternatives considered

- Treat every non-empty `orderKey` as a drag marker: rejected because creation assigns it too.
- Infer from `updatedAt`: rejected because messages and metadata also change it.
- Sort only the loaded renderer rows: rejected because later pages can contain the actual first result.
- Rewrite manual keys when selecting an automatic sort: rejected because switching back must restore the custom order.

- Unicode binary ordering: rejected for Name because it does not follow language-specific expectations.
- Add a native SQLite ICU extension: deferred because the current driver has no JavaScript collation registration API and a native extension adds platform-specific build/distribution work.

## Consequences

Legacy inference recognizes current order rather than historical actions. Imports may also create a non-default order and will be preserved as Manually. Time grouping still assigns rows to activity buckets, so row ordering applies within those buckets. No shipped schema migration is rewritten and no conversation rows are changed by preference initialization.

Name pagination reads and sorts all matching name/id pairs per request: O(n) metadata and O(n log n) comparisons. It does not load all conversation payloads. ICU upgrades can change linguistic ordering; locale-specific page chains are refreshed on language changes.

## Verification

- AC1 — `ConversationListOptionsMenu.test.tsx` exercises independent controls and direction selection with the real dropdown; Electron shows the Chat and Agent menus in dark/light themes and a 1024 x 760 viewport.
- AC2 — `conversationListSort.test.ts`, `sessionListHelpers.test.ts`, and the Electron group-switch scenario preserve sorting across grouping and activity changes.
- AC3 — `src/main/data/services/__tests__/conversationListSort.test.ts` verifies default/custom inference, equal timestamps, empty tables, excluded rows and preservation of existing preferences against production SQLite migrations.
- AC4 — The same database suite pages both domains in all automatic directions across pins, ties, empty names and cursor punctuation, without changing manual keys.
- AC5 — Electron changes Chat to Manually, drags a time-group row to the first position, reloads and observes the saved order; automatic mode exposes no enabled sortable rows. The database and renderer suites preserve manual keys and pin precedence.

- AC6 — `src/shared/utils/__tests__/nameOrdering.test.ts` covers all 17 UI locales plus Arabic/Korean, natural numbers, accents, punctuation and canonical/case ties; database and renderer group tests use the same comparator.
- AC7 — `useConversationListSorting.test.ts` verifies fresh page chains on language change; database tests cover scoped candidates and deleted anchors; Electron switches both lists between pinyin and stroke order, compares paged API results and checks reload persistence.
