# Agent Note: Stable account menu snapshots

Status: implemented

English | [中文](2026-10-29-account-menu-cache.zh.md)

## Problem

Closing the avatar menu unmounts its account panel. Reopening reset both account status and subscription lookup to loading, briefly replacing the account identity, paid plan and available actions.

## Decision

Account status uses the renderer's in-memory SWR cache. Status events and completed login actions update that cache; SWR mutation ordering prevents an older status read from replacing a newer event. A known status remains ready during background refresh.

Account queries follow the panel's mounted lifetime, including the popover's exit animation. Closing the menu does not clear its query keys before the content unmounts.

The sidebar keeps the status observer mounted and prepares subscription data before the menu opens. The panel and subscription settings share the existing account-plans key, which includes the account ID. Changing accounts selects another cache entry, even when display names match; a previous account's late response cannot populate the new entry. Known plans remain visible during refresh. Initial failures without cached data remain retryable.

For an active paid plan, the header subtitle displays the plan name and the menu row displays usage with the lowest remaining percentage across its quota windows. Overlapping limits are not added together; a missing quota shows the existing no-quota message. The row opens the complete usage details. Accounts without an active paid plan retain the subscribe action. Cache entries contain display data, not credentials, and do not persist across renderer restarts.

## Alternatives considered

- Keeping every hidden popover mounted retains unrelated overlay state and does not share subscription settings data.
- A component-local cache still loses its snapshot on unmount and requires separate request ordering.
- A single account-independent plan key can display another account's plan after a session change.

## Consequences

Cached data can remain visible while a refresh is pending or fails. Status events and normal SWR revalidation provide updates; successful refreshes replace the snapshot. This is presentation caching, not an authorization decision or a change to billing behavior.

## Verification

- Regression — `src/renderer/hooks/__tests__/useCherryAccountSession.test.ts`: remount and pending refresh preserve a known session; an older request cannot replace a newer status event.
- Regression — `src/renderer/components/__tests__/UserAccountPanel.test.tsx`: reopening preserves cached identity and plan until refresh completes; account changes clear the previous plan, including matching display names and late responses; initial failures remain retryable.
- Consumers — focused renderer tests for Sidebar, SubscriptionSettings and OnboardingPage pass with the cached session hook.
