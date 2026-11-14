# Agent Note: Preserve Mini Apps across sidebar tab replacement

Status: implemented

English | [中文](2026-10-30-mini-app-sidebar-navigation.zh.md)

## Problem

Sidebar navigation forced a new tab when the active tab contained a Mini App, solely to keep its WebView alive. Simply replacing that route released the last guest owner and lost live page state.

## Decision

Built-in app shortcuts replace the active unpinned tab through the existing activation gateway. Resource identity reuse, pinned-tab protection and explicit new-tab actions retain their existing rules.

The Mini App pool includes its live resources alongside route and split owners. Replacing a route hides its guest without releasing it; returning reuses the same guest. Hidden resources remain subject to the existing capacity and LRU policy. Becoming visible updates the resource's access time even when navigation reuses one tab ID.

Explicit closure of the last owning Mini App tab or split, removal from the catalog, explicit hide/remove actions and runtime eviction release the guest. Closing a replacement route does not implicitly close its previously cached Mini App. Pool disposal still releases every guest.

## Alternatives considered

- Keeping a Mini App tab open implicitly preserves live state but makes ordinary navigation create unexpected tabs.
- Releasing every guest without a route owner loses page state during tab replacement.
- Adding a second guest cache duplicates the existing pool's inventory and capacity policy.

## Consequences

Hidden Mini Apps retain live page state and consume resources until closed or evicted. The existing maximum bounds retention; visible and pinned resources retain their existing protection. No new preference or disk format is introduced.

## Verification

- Regression — `src/renderer/components/app/sidebarShortcuts/__tests__/runtime.test.ts`: leaving a Mini App replaces the current tab without focusing a sibling and clears stale navigation metadata.
- Regression — `src/renderer/components/MiniApp/__tests__/MiniAppTabsPool.test.tsx`: tab replacement and return preserve the same guest; explicit closure and eviction release it; sequential navigation within one tab retains the correct LRU order.
- Electron — LongCat to Translate and back preserves the tab ID, tab count, WebContents ID and a temporary JavaScript memory marker. The marker is removed and LongCat restored after verification.
