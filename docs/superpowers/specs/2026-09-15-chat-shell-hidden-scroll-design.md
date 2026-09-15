# Chat Shell Hidden Scroll Design

## Context

The shared chat layout currently derives nested heights from the viewport in two places:

- `ConversationShell` subtracts the navbar height and an additional six pixels.
- `ConversationNavigationPane` independently subtracts the navbar height.

Their flex parents already own the available height. In the main window, the duplicate calculations make the
navigation pane six pixels taller than `PageSidebar` and make the conversation shell three pixels taller than its
page container. Both parents use `overflow-hidden`, which clips visible overflow but still permits programmatic
scrolling. Focus restoration or `scrollIntoView()` can therefore move the two hidden scroll containers by nine CSS
pixels in total, shifting the assistant list upward by 18 physical pixels on a device-pixel-ratio-2 display.

This is a pre-existing shared Chat Shell defect. It was not introduced by the assistant-preset feature branch.

## Goals

- Keep the assistant list at its intended top position after focus changes and programmatic scrolling.
- Give each Chat Shell layer exactly the height allocated by its flex parent.
- Preserve the existing layout in the home page, Agent page, and detached chat window.
- Deliver the fix in an independent branch and pull request based on `origin/main`.

## Non-goals

- Changing assistant-row or Add Assistant button spacing.
- Changing dialog focus restoration or list-selection behavior.
- Redesigning the page shell, navigation pane, or detached-window chrome.
- Replacing intentional scrolling inside the assistant and topic lists.

## Options Considered

### 1. Let flex parents own height (selected)

Replace nested viewport-derived heights with `h-full min-h-0`. The existing App Shell and page composition remain
the single source of truth for available height. This directly removes the overflow that makes hidden ancestors
scrollable and applies consistently to every Chat Shell consumer.

Tradeoff: this relies on the existing flex-parent contract, so all supported consumers must be verified.

### 2. Keep viewport calculations and synchronize offsets

Adjust the constants so each nested calculation matches its current parent.

This could remove today's overflow, but it duplicates layout knowledge across components. Any title-bar, border, or
window-frame change could desynchronize the constants again.

### 3. Suppress the resulting scroll

Use clipping behavior that cannot scroll, reset `scrollTop`, or intercept focus scrolling.

This would address the visible symptom while leaving the invalid height relationship intact. It also risks
interfering with legitimate focus and scroll behavior.

## Design

### Height ownership

The application/page flex layout owns the usable vertical space. `ConversationShell` fills that allocation with
`h-full min-h-0` in both the main and detached window. Its frame-mode condition remains responsible only for the
main-window corner radii.

`ConversationNavigationPane` likewise fills the `PageSidebar` content area with `h-full min-h-0`. It no longer
needs a frame-specific viewport-height calculation. Its child continues to use flex sizing and `overflow-hidden`,
while the actual resource/topic list keeps its intentional scroll behavior.

No imperative scroll reset is introduced. Removing the overflow makes focus restoration harmless by construction.

### Consumers

The change stays in the two shared Chat Shell components. Home chat and Agent chat consume the same shell and
navigation pane, so they receive the fix without page-specific branches. The detached chat window uses the same
components in window-frame mode and retains its existing chrome and full-height behavior.

### Error handling and state

This is a layout-only correction. It adds no state, events, persistence, error paths, or cross-process contracts.

## Verification

The regression to catch is: focusing or revealing an item must not programmatically scroll a nominally hidden
ancestor and move the navigation content upward.

Verification will cover:

1. A focused layout regression check, at the lowest practical browser/Electron layer, that compares relevant
   `clientHeight` and `scrollHeight` values and confirms the hidden ancestors retain `scrollTop === 0` after focus or
   reveal behavior. It should assert rendered geometry rather than merely pinning Tailwind class strings.
2. Home page runtime verification before and after opening Add Assistant, restoring focus, selecting assistants,
   and toggling the sidebar.
3. Agent page runtime verification for the equivalent navigation and focus flows.
4. Detached chat-window runtime verification, including its title bar and full-height layout.
5. Targeted renderer tests plus the repository lint gate. A broader suite is unnecessary unless the final diff
   expands beyond these shared renderer components.

For each surface, the Chat Shell and navigation-pane hidden ancestors must have no unexpected vertical overflow,
must remain at `scrollTop === 0`, and must keep their visible top edge stable through the exercised interactions.

## Risks and mitigations

- **Parent height is missing in a consumer:** verify all three supported surfaces in the running app; the existing
  full-height parent chain is part of the acceptance criteria.
- **Main-window rounding changes:** keep the frame-mode radius condition unchanged and inspect the outer shell.
- **List scrolling regresses:** do not change the list's own scroll container; verify long-list scrolling separately
  from the hidden shell ancestors.

## Success criteria

- The assistant navigation content no longer shifts upward after focus or reveal operations.
- The nested Chat Shell containers have no unexplained vertical overflow on the home page, Agent page, or detached
  window.
- Existing main-window radii, detached-window chrome, list scrolling, and pane toggling remain intact.
