# Agent Note: Recall queries in global search

Status: proposed

English | [中文](2026-11-22-search-query-history.zh.md)

## Problem

Issue #19537 asks to recall previous search queries rather than only recently opened tasks. Its screenshot shows the global-search popup. Today `GlobalSearchPanel` reads `ui.global_search.recent_items`, whose route/topic/session entries are navigation history, not search terms. The panel already protects Enter against IME confirmation and stale debounced/deferred results. Query recall must not bypass those guards or turn every intermediate keystroke into stored history.

## Proposal

### Remember deliberate searches

Add a separate local query-history group above the existing recently opened group when the global-search input is empty. Keep navigation recents, existing limits and behavior unchanged. Query history is not browser history, settings search, knowledge recall history, or web-provider search history.

Remember a trimmed, non-empty query when the user activates an aligned search result or enters full message search from that query. Also provide an accessible Search action beside the non-empty input so a user can deliberately remember and run a query with no result to open. This action uses the existing search pipeline, stays in the panel, and does not open a conversation. Do not change Enter's existing selected-result behavior. The Search action must wait for the IME composition to finish and for input/debounce/deferred values to agree; loading or failed results cannot commit stale text. A successful zero-result search is a valid query. Typing, changing filters, closing the popup, and automatic background refreshes alone do not record queries.

Store at most 20 queries, newest first, with query text and last-used time only. Trim outer whitespace; preserve internal whitespace, Unicode and case. Deduplicate by the resulting exact text and move reuse to the front. Do not save result snippets, conversation contents, entity IDs, credentials or filter snapshots. History recall uses the panel's current filters and visibly leaves them unchanged. A query is a literal local-search input, never a URL, command, tool request or instruction to a model.

### Recall and deletion

Show the newest six queries in the empty-input panel, with a localized Show all control when more exist. Choosing a query by pointer or keyboard fills the input, focuses it, and reruns ordinary search without opening a result. The user can edit the query before choosing a result. Blank input and an empty history show the existing recent/empty state without an empty history heading.

Provide an accessible remove action for each query and a Clear search history action for the whole query list. Deletion must not activate the row, navigate, clear navigation recents, or delete conversations. Keep keyboard focus sensible after removal, including removal of the last row. Clearing while a request is in flight cannot be undone by a late response; only a subsequent deliberate search action may add history again. Use ordinary text rendering, truncation with an accessible full value, and stable IDs rather than injecting query text as markup.

### Storage and ownership

Use a new typed `usePersistCache` key, following the data-layer guidance for dispensable recent-search state. Keep the existing recent-items key and schema intact; no migration converts titles or routes into queries. Renderer CacheService owns localStorage persistence; Main only relays existing cross-window persist-sync messages and does not store this history. Renderer modules own grouping, normalization, recall and keyboard behavior. Cross-process cache value types contain only the stored data contract. Reuse existing UI primitives and cache synchronization rather than adding a database table, preference, IPC protocol or service.

Validate persisted values at the read boundary: accept only the expected text/time shape, discard empty/invalid entries, deduplicate and cap before display. Follow existing cache ownership and reset behavior. History is local convenience state, not guaranteed permanent storage or a synced account archive. Treat queries as potentially sensitive: no new logs, analytics or model/provider requests. Removal updates the application cache; do not promise forensic erasure from backups or storage media.

## Alternatives considered

- Replace recently opened items with queries: removes an existing navigation affordance without being necessary for recall.
- Persist each debounce: stores incomplete and IME-composition text without a deliberate search action.
- Record only result openings: misses useful zero-result searches, so an explicit Search action is also needed.
- Store filters, results or message snippets: adds privacy and stale-state costs outside the request.
- Put history in preferences or a new database table: conflicts with the established dispensable-cache ownership and adds migration work without a user-data requirement.

## Acceptance criteria

- AC1 — Deliberate aligned result activation, full-message-search entry and explicit Search remember the correct non-empty query, including zero-result success; typing, IME confirmation, stale/failed/loading results and popup dismissal do not. Existing Enter behavior is preserved. (verification: renderer)
- AC2 — Restart/reopen recalls at most 20 exact-trimmed, deduplicated newest-first queries independently of navigation recents; malformed cache entries are safely discarded and existing recent entries remain unchanged. (verification: unit, renderer and Electron)
- AC3 — Empty input shows six queries with Show all when needed; pointer/keyboard recall fills and searches under visible current filters without opening a result, while empty history has no empty group. (verification: renderer and Electron)
- AC4 — Per-query removal and Clear affect only query history, do not activate rows, preserve accessible focus and survive late search responses without resurrection. (verification: renderer and Electron)
- AC5 — English/Chinese labels, narrow/light/dark layouts and assistive semantics pass scoped checks; existing IME/stale-Enter, message preview, navigation-recents and filter flows remain intact, with native boundaries stated rather than assumed. No new query logging or external/model call is introduced. (verification: renderer, docs gate and Electron)

## Risks

A deliberate-search boundary is less automatic than recording every backend call, but avoids accumulating typed fragments. The Search action must remain distinct from selecting the first result and must not weaken the panel's existing async guards.

Queries can contain private text. Keep history bounded and removable, avoid new telemetry, and state the storage limits honestly. Persistence may be lost with cache reset; this is not user-authored conversation data.

Adding history rows changes the listbox's keyboard order. Removal controls must not nest interactive elements incorrectly or steal the row action. Reuse the panel's option IDs and active-descendant model, and verify real keyboard behavior before calling the implementation complete.
