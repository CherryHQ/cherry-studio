# Agent Note: Event-time reads for conversation lists

Status: implemented

English | [中文](2026-10-31-conversation-list-row-ownership.zh.md)

## Problem

`Sessions.tsx` was 2430 lines and `Topics.tsx` was 2064. Each was one component holding list data, display derivation, row handlers, group menus, delete flows, and drag reordering.

Row isolation did not hold in `Sessions`. `reconcileSessionListItems` keeps unchanged items referentially equal so memoized rows can skip work, yet a render-count test showed that one changed session re-rendered every other row, for two reasons:

- `handleDeleteSession` depended on `filteredGroupedSessions` and `sessionGroupBy`, so each row received a new `onDelete`.
- `ResourceListProvider` rebuilt `actions` when `onReorder` changed. `handleSessionReorder` and `handleTopicReorder` depend on list data, and rows subscribe to `actions` through context, which `memo` cannot stop.

The handlers only need current data when an event fires. The data already lives outside React, in SWR's cache, `preferenceService`, and `cacheService`.

## Decision

Rows keep the `item` prop. Reference sharing already invalidates per row, so ID-only rows would add migration cost without fixing either cause above.

**1. Stable list actions.** `ResourceListProvider` keeps `actions` referentially stable and calls the latest host handlers when an event fires. `useLatest` lives in `src/renderer/hooks/` and is the one sanctioned home for this mechanism.

**2. Event-time reads in `Sessions`.** `deriveSessionListView` in `utils/chat/sessionListHelpers` builds the displayed list, and both rendering and `handleDeleteSession` call it. `useSessions` exposes `readSessionListItems`, which reads the same SWR keys as the list. The delete handler reads the list when it fires and layers the optimistic name (`withOptimisticNames` from `useOptimisticResourceName`) and the in-flight drag (`optimisticMove`) on top, so its replacement and undo label match the screen. Agents and workspaces do not change with the session list, so they stay ordinary dependencies and no separate snapshot hook exists.

**3. `Topics` keeps its refs.** `handleDeleteTopicFromMenu` already reads `topicsRef` and `activeTopicIdRef` when it fires and does not depend on list state. A render-count test shows one changed topic re-renders only its row in time and assistant modes. Replacing the refs with a cache reader would add a reader and the same overlays for no observable change.

**4. Feature folders.** `Sessions` lives in `pages/agents/components/sessions/` and `Topics` in `pages/home/Tabs/components/topics/`, each behind an `index.ts` barrel. Only parts with a clear boundary have their own files. In `sessions/` these are row menu actions, rename, creation, group expansion, group structure, and workdir group handlers. In `topics/` they are the list body with its rows and the assistant group menu. Delete flows, reorder, group headers, and the logic that ties expansion to the display mode stay in the host files, which are 1498 lines each.

**5. Group menus stay host-built.** Measurement showed their callbacks cause few header render passes, so the long `getGroupHeaderAction` and `getGroupHeaderContextMenu` builders remain.

With 500 sessions in a dev build, median of 7, script time: a single-session update went from 341 ms to 320 ms and a delete from 133 ms to 115 ms.

## Alternatives considered

- Add Zustand or Jotai as in Folo: rejected. Cherry Studio already has four data systems, and the data is already outside React. A fifth system would duplicate SWR's cache.
- ID-only rows with `useSessionById(id, selector)`: rejected for now. SWR caches pages, not entities, so this needs an entity index over the cache plus a place for optimistic names. Existing reference sharing delivers per-row invalidation without it.
- A `useReadSessionListSnapshot` hook that also re-reads agents and preferences: not built. Only the session list changes between renders; the other inputs stay ordinary dependencies.
- Replacing `Topics` refs with a cache reader: not built. `Topics` already meets the row and delete criteria, and the reader would need the same optimistic overlays that caused two defects while building the `Sessions` reader.
- Splitting every responsibility until no file exceeds 800 lines: rejected after trying it. It left `Sessions.tsx` at 759 lines, but the four remaining hooks took 11–25 parameters, were each called once, and still changed together with the host. Total lines grew by about 650 with no reuse or decoupling.
- `useLatest` copies of list state in each host: rejected for `Sessions`. It fixes the render cost, but every handler keeps a hidden dependency on host state, and the derivation stays inside the component.
- Owned group menus, with a `ResourceList` component slot replacing `getGroupHeaderContextMenu`: rejected after measurement. In a dev build with 50 agents and 11 mounted headers, the menu callbacks caused 2 of the 12 header render passes on a pin toggle, 1 of 1 on a sidebar toggle, and 1 of 7 on a session update. At about 0.55 ms per header render, this saves an estimated 5–12 ms on actions that take 93–255 ms, and menus already open in about 45 ms. It would also change a shared `ResourceList` contract and add one subscription per mounted header.
- Lazy menu items with a subscription hook: rejected. It needed `getExtraItems` and `subscribeExtraItems` on `CommandPopupMenu` and existed only to compensate for menu state living in the host.
- A shared `ConversationList` for both hosts: rejected. Delete order, drag rules, and grouping dimensions differ on purpose, and only 6–7% of their lines match.

## Consequences

- One changed session or topic re-renders one row. Group headers still re-render on every list change: a pin toggle re-renders all mounted headers in 12 passes. That cost is not addressed here.
- The two hosts read current data differently. `Sessions` reads the SWR cache through `readSessionListItems`; `Topics` reads refs. A handler that reads the cache must layer optimistic state itself, as `handleDeleteSession` does.
- `readSessionListItems` reads the SWR cache, while rows render the provider's committed snapshot, so the cache can be slightly ahead of the rows during a background refresh. `resourceViewSources.ts` documents this.
- `useReadCache` needs the exact query key, including `limit`. `useSessions` builds the key once for both the list and the reader, and a real-cache test guards it.
- Archiving the active topic logs a not-found error for that topic's `GET /topics/:id`, because `Topics` deletes before it switches the selection. This predates the change.

## Verification

- AC1 — `src/renderer/components/chat/resourceList/base/__tests__/ResourceList.test.tsx` "keeps actions stable when host handlers change, and calls the latest handler" (#23352).
- AC2 — `src/renderer/hooks/useLatest.ts` is imported by `ResourceListProvider.tsx`, `AgentComposer.tsx`, and `ChatComposer.tsx`; the composer tests pass unchanged (#23352).
- AC3 — `src/renderer/pages/agents/components/sessions/__tests__/Sessions.test.tsx` "re-renders only the changed row" in time, agent, and workdir modes; all three fail when `handleDeleteSession` depends on the list again (#23389).
- AC4 — `Sessions.test.tsx` "picks the replacement from the latest list when deleting the active session", plus the unsaved-rename and unconfirmed-drag cases, and `src/renderer/hooks/agent/__tests__/useSession.readList.test.ts` on a real SWR cache; each failed before its fix (#23389).
- AC5 — 217 renderer tests pass unchanged after the move, a line comparison shows only exports, paths, and wiring changed, and Electron flows pass for selection, rename, drag, archive, undo, and group menus (#23413).
- AC6 — `src/renderer/pages/home/Tabs/components/topics/__tests__/Topics.test.tsx` "rerenders only the changed topic row" in time and assistant modes fails when the delete handler depends on the list; the existing delete tests cover the same-assistant replacement and mid-delete changes; Electron flows pass for selection, rename, archive, and undo in both modes and for the assistant group menu; the one failing check is the pre-existing not-found log.
- AC7 — Electron, dev build, 500 sessions, median of 7: single-session update 341 ms before layer 1 and 320 ms after the final layer; delete 133 ms and 115 ms.
