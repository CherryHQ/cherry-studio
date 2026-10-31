# Agent Note: Event-time reads and owned menus for conversation lists

Status: proposed

English | [中文](2026-10-31-conversation-list-row-ownership.zh.md)

## Problem

`Sessions.tsx` is 2430 lines and `Topics.tsx` is 2064. Each is one component holding list data, display derivation, row handlers, group menus, delete flows, and drag reordering. Everything below it closes over that state, which causes two concrete costs.

Row isolation does not hold. `reconcileSessionListItems` and `reconcileTopicListItems` keep unchanged items referentially equal so memoized rows can skip work. A render-count test shows that one changed session still re-renders every other row, for two reasons:

- `handleDeleteSession` depends on `filteredGroupedSessions` and `sessionGroupBy`, so each row receives a new `onDelete`.
- `ResourceListProvider` rebuilds `actions` when `onReorder` changes. `handleSessionReorder` and `handleTopicReorder` depend on list data, and rows subscribe to `actions` through context, which `memo` cannot stop.

Group menus need long dependency arrays. Menu state lives in the host, so `getGroupHeaderAction` and `getGroupHeaderContextMenu` depend on it and each repeat the same action context. Refs and lazy-menu subscriptions were both tried while exploring this; each moved the workaround instead of removing it.

The handlers only need current data when an event fires. They close over it because reading from the host is the only way the code offers today, even though the data already lives outside React: SWR's cache, `preferenceService`, and `cacheService`.

## Proposal

Keep the `item` prop on rows. Reference sharing already invalidates per row, so ID-only rows would add migration cost without fixing either cause above.

**1. Stable list actions.** `ResourceListProvider` keeps `actions` referentially stable and calls the latest host handlers when an event fires. Actions only run on events, so behavior does not change. `useLatest` moves from `components/composer/variants/shared/` to `hooks/` and is the one sanctioned home for this mechanism.

**2. Event-time list snapshots.** Display derivation moves into pure functions in `utils/chat/sessionListHelpers` and `topicsHelpers`. A hook such as `useReadSessionListSnapshot` returns a stable reader that builds the current view from `useReadCache` and `preferenceService.getCachedValue`. Handlers call the reader instead of closing over list state:

```ts
const readSnapshot = useReadSessionListSnapshot()
const handleDelete = useCallback(async (id: string) => {
  const { items, groupBy } = readSnapshot()
  // choose the neighbour from current data
}, [readSnapshot])
```

The rendered list and the reader share the same pure functions, so they cannot disagree on order. Reactive rendering still uses `useQuery`; the snapshot is for handlers only.

**3. Owned group menus.** A group header menu becomes a component that takes an owner id and reads its own state through a hook such as `useAgentGroupActions(agentId)`. Hosts stop building action contexts. `ResourceList` replaces the items-returning `getGroupHeaderContextMenu` with a component slot, because a hook cannot run in a callback. The More button and the right-click menu share that hook.

**4. Feature folders.** `Sessions` splits into `pages/agents/components/sessions/` by responsibility: list host, row actions, group menus, delete flow, reorder. `Topics` follows the same shape after the pattern is proven.

### Expected performance

These are expected effects, not measurements. A render-count test shows the row re-renders today; no timing has been measured yet.

- Row updates: one changed session re-renders one row instead of all mounted rows. Layer 1 and layer 2 deliver this.
- Header updates: a change to one owner's menu state updates that header instead of every header. Only owned menus deliver this.
- Handler identity: handlers stop being rebuilt on list changes, so nothing downstream invalidates because of them.
- New costs: each mounted header holds its own subscriptions, and a handler derives the view on each event. Sorting 2000 items took about 10 ms in an earlier offline sort measurement, so the event cost should stay small, but AC6 and AC9 must confirm both.

Users with a few dozen conversations may not notice a difference. The gain should show with long lists and with frequent list updates during streaming.

Delivery is a stack, and each layer can merge alone. A timing baseline for AC9 is recorded before layer 1 changes any code:

1. Stable actions and `useLatest` (AC1, AC2).
2. `Sessions` snapshot reader and row handlers (AC3, AC4).
3. `Sessions` owned group menus and `ResourceList` slot (AC5, AC6).
4. `Sessions` feature folder (AC7).
5. `Topics` migration (AC8, AC9).

## Alternatives considered

- Add Zustand or Jotai as in Folo: rejected. Cherry Studio already has four data systems, and the data is already outside React. A fifth system would duplicate SWR's cache.
- ID-only rows with `useSessionById(id, selector)`: rejected for now. SWR caches pages, not entities, so this needs an entity index over the cache plus a place for optimistic names. Existing reference sharing delivers per-row invalidation without it.
- `useLatest` copies of list state in each host: rejected as the end state. It fixes the render cost, but every handler keeps a hidden dependency on host state, and the derivation stays inside the component.
- Lazy menu items with a subscription hook: rejected. It needed `getExtraItems` and `subscribeExtraItems` on `CommandPopupMenu` and existed only to compensate for menu state living in the host.
- A shared `ConversationList` for both hosts: rejected. Delete order, drag rules, and grouping dimensions differ on purpose, and only 6–7% of their lines match.

## Acceptance criteria

- AC1 — When a host rebuilds `onReorder`, `onSelectItem`, or another list handler, `actions` keeps its identity and the next event calls the latest handler. (verification: unit)
- AC2 — `useLatest` lives in `src/renderer/hooks/`, existing composer callers use it there, and their tests pass unchanged. (verification: unit)
- AC3 — When one session changes, only that session's row re-renders, in time, agent, and workdir display modes. (verification: renderer)
- AC4 — Deleting the active session picks its replacement from the current displayed list after that list has changed, and `handleDeleteSession` no longer depends on list state. (verification: renderer)
- AC5 — More and right-click group menus for agents and workdirs keep their items, enabled states, and actions. A Cherry More menu still updates while open, a right-click or native menu still runs what its label shows, and existing `Sessions` menu tests pass unchanged. (verification: renderer and Electron)
- AC6 — A change to one agent's pin or sidebar state re-renders only that group header, and opening a menu is no slower than before at 50 groups. (verification: renderer and Electron)
- AC7 — `Sessions` lives in a feature folder where no file exceeds 800 lines, with no change to selection, rename, drag, archive, or undo. (verification: renderer and Electron)
- AC8 — `Topics` meets AC3, AC4, AC5, and AC7 for its time and assistant modes. (verification: renderer and Electron)
- AC9 — With 500 sessions, a single-session update and a delete are profiled before layer 1 and after the final layer, the numbers are reported in the final PR, and neither is slower than the baseline. (verification: Electron)

## Risks

- The snapshot reads server data, so it excludes optimistic overlays such as an in-flight drag. Handlers that must see them have to take that state explicitly. If several do, the reader's scope needs revisiting.
- `useReadCache` needs the exact query key, including `limit`, so the reader must share key construction with `useSessions` or it silently reads nothing. AC4 covers this.
- Per-header hooks subscribe once per mounted header. Virtualization bounds this, but the cost could offset part of the gain, so AC6 must measure it before layer 3 merges. If it does not hold, layer 3 stops and the earlier layers stay valid.
- The `getGroupHeaderContextMenu` slot changes a `ResourceList` contract, and only `Topics` and `Sessions` use it, so both must keep working between layers 3 and 5.
