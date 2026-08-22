# macOS Conversation Island Motion and Notch Polish Design

Status: approved

## Summary

Polish the macOS Conversation Island introduced by the approved 2026-08-21 design. Expanded notch layouts gain useful content in the two shoulders beside the physical notch, expanded rows end flush with the island's bottom edge, and the island uses one top-anchored motion language for appearing, expanding, collapsing, and disappearing.

The change remains feature-local. `ConversationIslandService` continues to own window existence, authoritative snapshots, bounds, and close timing. The renderer owns only visual motion and interaction. No Preference, Cache, DataApi, generic WindowManager API, or native helper is added.

## Relationship to the existing design

This document refines [the approved Conversation Island design](./2026-08-21-macos-conversation-island-design.md). All existing activity eligibility, ordering, navigation, timing, placement, localization, and failure-safety contracts remain in force unless this document changes them explicitly.

The refinements are:

- remove the 8 px bottom gap from expanded notch geometry;
- use the previously empty 38 px expanded notch shoulders for activity identity, state, and total count;
- animate appearance and disappearance instead of showing and closing the BrowserWindow abruptly;
- give compact/expanded content changes the same top-anchored spring character as window bounds change;
- preserve reduced-motion and transparent-window safety.

## Goals

- Make the island feel connected to the physical notch instead of appearing as an abrupt black rectangle.
- Make expanded notch shoulders useful without adding controls or competing with the activity list.
- Let the final visible activity row meet the curved bottom edge with no empty strip.
- Keep the existing main/renderer ownership boundary.
- Cancel a pending disappearance when new activity arrives, reusing the same window.
- Respect macOS reduced-motion settings for renderer motion, native bounds animation, and delayed close.
- Preserve immediate safety cleanup when the feature is disabled, the app stops, or the window becomes unreliable.

## Non-goals

- Add mascot skins, sound, tool progress, message previews, or Cindy's native helper.
- Add toolbar actions to the notch shoulders.
- Keep a permanently expanded transparent carrier window.
- Change the 500 ms hover dwell, 250 ms full-leave collapse delay, row navigation behavior, or five-row scroll limit.
- Add a motion preference separate from the operating system's reduced-motion setting.
- Generalize exit animation into WindowManager or a shared window-animation framework.
- Animate application shutdown, feature disablement, invalid display recovery, or renderer failure paths.

## Repository and reference evidence

### Existing Cherry Studio behavior

- `ConversationIslandService` owns the feature's singleton BrowserWindow id, snapshots, bounds, expiry timer, and failure cleanup.
- The renderer reports only `conversation_island.set_expanded`; main remains authoritative for whether expansion is valid.
- Compact notch rendering already divides the 38 px row into leading content, a measured physical-notch occlusion, and trailing content.
- Expanded notch rendering currently reserves the same 38 px at the top with `pt-[38px]` but renders no content there.
- `resolveConversationIslandSize()` currently adds `NOTCH_BOTTOM_PADDING = 8`, which is the entire unwanted bottom gap.
- Existing `setBounds(bounds, animate)` calls already delegate macOS window-bound movement to Electron and disable it when the system prefers reduced motion.
- The renderer already depends on `motion/react` elsewhere in the repository; this feature does not require a new animation dependency.

### Cindy reference

Cindy's hardware-notch compact layout puts status and identity on the leading side and summary/count information on the trailing side. Its island shape changes use a spring with `response: 0.42` and `dampingFraction: 0.82`. Cindy can pre-grow and delay-shrink a native carrier because its helper controls native hit testing; an Electron transparent BrowserWindow cannot safely assume the same behavior.

Sources:

- [Cindy hardware-notch shoulder layout](https://github.com/makecindy/cindy/blob/main/apps/desktop/native/agent-island/macos-agent-island-helper.swift#L2395-L2448)
- [Cindy island spring](https://github.com/makecindy/cindy/blob/main/apps/desktop/native/agent-island/macos-agent-island-helper.swift#L2161-L2164)
- [Cindy carrier ordering and delayed shrink](https://github.com/makecindy/cindy/blob/main/apps/desktop/native/agent-island/macos-agent-island-helper.swift#L4472-L4507)

## Visual layout

### Expanded hardware-notch presentation

The expanded surface keeps a 38 px top shoulder zone and renders it as a three-column grid:

1. leading shoulder;
2. measured physical-notch occlusion;
3. trailing shoulder.

The leading shoulder contains:

- an Assistant Conversation or Agent Session icon derived from the primary activity's existing `target.conversationType`;
- the existing state indicator;
- the primary activity's localized status text.

The trailing shoulder contains a quiet badge with the localized total activity count, for example `2 activities` / `2 项`. It has no click behavior. The status text and count truncate before crossing into the measured notch. Icons are decorative and `aria-hidden`; text remains the accessible source of meaning.

The compact hardware-notch layout remains unchanged. The capsule fallback also remains unchanged because it has no physical occlusion or empty shoulder zone to reclaim.

### Rows and bottom edge

Expanded activity rows remain equal 44 px targets. The expanded notch height becomes:

```text
38 px shoulder zone + min(activity count, 5) × 44 px
```

There is no additional bottom padding. The last row's surface reaches the island's clipped 12 px bottom corners. Six or more activities continue to scroll inside a 220 px list viewport.

Expected notch sizes include:

| Visible rows | Previous height | New height |
|---:|---:|---:|
| 2 | 134 px | 126 px |
| 5 | 266 px | 258 px |

Capsule sizes stay at 104 px for two rows and 236 px for five rows because their existing 8 px top and bottom padding remains intentional.

## Motion contract

### Motion character

The visual shell is anchored at the top center so movement reads as growing out of the notch. The primary spring target matches Cindy's perceptual parameters. With unit mass, the equivalent `motion/react` values are approximately:

```text
stiffness: 224
damping: 25
mass: 1
```

This spring is restrained: it may settle once but must not visibly bounce through multiple cycles.

### Appearance

When a window first receives a normal snapshot, the renderer starts from:

```text
opacity: 0
scaleX: 0.90
scaleY: 0.72
transform-origin: top center
```

It springs to full opacity and unit scale. Main opens the window at compact bounds and calls `showInactive()` as today; the transparent renderer background means only the animated island surface becomes visible.

### Compact to expanded and expanded to compact

Main continues to update the same BrowserWindow with `setBounds(target, animate)` and the authoritative snapshot. Renderer content changes inside one stable top-anchored motion shell:

- the outgoing compact or expanded content fades out;
- the incoming content fades in while the shell performs one spring settle;
- the expanded shoulder and rows are present only in the expanded branch;
- list scrolling is available as soon as expanded content is interactive.

The renderer animation accompanies Electron's native bounds animation; it does not replace or continuously drive BrowserWindow bounds from JavaScript.

### Disappearance

Normal disappearance uses a shorter 180 ms ease-in exit so removal feels responsive. The surface fades and contracts toward the top center. It is non-interactive for the entire exit.

Main closes the BrowserWindow only after the 180 ms exit deadline. If a new eligible activity arrives first, main cancels the deadline and pushes a normal snapshot; the renderer reverses to the visible state in the same window.

### Reduced motion

When `systemPreferences.getAnimationSettings().prefersReducedMotion` is true:

- main passes `false` to bounds animation;
- renderer renders unit scale and full opacity without spring or crossfade;
- normal disappearance closes immediately instead of waiting 180 ms.

The renderer receives the resolved reduced-motion boolean in the snapshot so both processes use one authoritative system reading. It does not independently query a user preference.

## Ownership and data flow

### Shared snapshot

`ConversationIslandSnapshot` gains only feature-local presentation fields:

- an optional exit flag indicating that the last visible snapshot is leaving;
- a localized total-activity label for expanded notch shoulders;
- the resolved reduced-motion boolean.

The activity type icon is derived in renderer from the existing navigation target and needs no new cross-process field.

### Main state

`ConversationIslandService` adds:

- the last successfully presented snapshot, so it can render an exit after the final activity disappears;
- one optional exit timer;
- helpers to begin, cancel, and immediately complete a pending exit.

The exit timer belongs to this lifecycle service and is cleared during stop/deactivation. No generic WindowManager hooks or animation API are added.

### State transitions

| Current state | Input | Result |
|---|---|---|
| hidden | first eligible activity | open compact window; renderer performs entrance |
| compact | valid hover expansion | update expanded bounds and snapshot; renderer performs spring transition |
| expanded | valid collapse | update compact bounds and snapshot; renderer performs spring transition |
| visible | no eligible activity | keep last snapshot with exit flag; start 180 ms close timer |
| exiting | eligible activity arrives | cancel close timer; present current normal snapshot in the same window |
| exiting | timer expires | close window and clear window/snapshot references |
| any | disable, stop, invalid window, or presentation failure | cancel timer and immediately hide/close |

Only normal activity exhaustion animates disappearance. Safety and lifecycle teardown remain immediate.

## Interaction and accessibility

- Existing pointer dwell and leave timers remain unchanged.
- Exit state clears renderer hover timers and applies `pointer-events: none`.
- Shoulder content is informational and cannot receive focus.
- Activity rows retain their current accessible labels and click behavior.
- State is expressed with localized text in addition to indicator color.
- Assistant and Agent icons are decorative supplements, not the only identity signal.

## Failure handling

- Failure to push an exit snapshot closes immediately; main never leaves a stale transparent blocker.
- Failure to access, resize, show, or close the BrowserWindow follows the existing guarded hide/close behavior.
- A stale exit timer is generation-guarded or canceled before a newly visible snapshot is presented.
- A destroyed/replaced window cannot be closed by an older timer; the timer validates the captured window id.
- Presentation errors do not extend the 180 ms exit deadline.

## Alternatives considered

### Copy Cindy's full carrier choreography

Pre-growing the BrowserWindow and delaying its shrink would give the renderer a fixed canvas for the entire spring. It is rejected because transparent Electron window pixels still participate in hit testing. A large carrier retained after pointer leave could temporarily block interaction with the underlying application. Cindy's native helper can constrain hit testing to the visual island; this feature cannot without expanding native scope.

### Animate BrowserWindow opacity in main

Driving `setOpacity()` through a main-process interval is rejected. It moves visual-frame ownership into main, adds timer churn, is harder to synchronize with renderer content, and has platform-specific opacity quirks elsewhere in the repository.

### Renderer-only exit with immediate main close

This cannot display a disappearance animation because closing the BrowserWindow destroys or hides the renderer before its exit frames are visible. A short feature-owned close deadline is the minimum correct coordination.

## Verification

### Pure geometry tests

- Two expanded notch rows resolve to 420 × 126.
- Five or more expanded notch rows resolve to 420 × 258.
- Capsule sizes remain unchanged.
- Compact size remains 320 × 38.

### Main service tests

- Normal activity exhaustion pushes an exit snapshot and does not close before 180 ms.
- The matching window closes when the deadline expires.
- New activity cancels exit and reuses the same window id.
- Reduced motion closes immediately.
- Disable, stop, invalid-window, and presentation-failure paths close immediately.
- Exit timers cannot close a replacement window.

### Renderer tests

- Expanded notch shoulders show the correct Assistant/Agent icon, localized status, and total count.
- Expanded capsule rendering does not gain notch shoulders.
- Exit state disables pointer interaction and cancels hover timers.
- Normal and reduced-motion snapshots select the correct motion targets.
- Existing 500 ms expand, 250 ms collapse, fresh re-entry, row navigation, and five-row scrolling contracts stay green.

Tests assert observable contracts and motion state selection, not intermediate animation frames or implementation snapshots.

### Runtime verification

In the tracked Electron instance:

1. inject two temporary activities;
2. confirm compact bounds are 320 × 38;
3. hover and confirm expanded bounds are 420 × 126;
4. confirm the shoulder icon/status/count and that the last row meets the bottom edge;
5. confirm compact/expanded motion is top-anchored and does not steal focus;
6. remove all temporary activities and confirm exit motion precedes window closure;
7. repeat with reduced motion enabled or an injected reduced-motion snapshot;
8. remove the temporary activity state and leave the healthy tracked instance running.

## Acceptance criteria

- Expanded notch layouts contain useful information on both sides of the physical notch.
- The expanded notch list has no bottom gap.
- Appearance, compact/expanded transition, and disappearance no longer read as abrupt state swaps.
- Normal exit is cancelable by new activity and cannot close a replacement window.
- Reduced motion produces immediate, non-animated state changes.
- No new persistent setting, general IPC command, generic WindowManager API, or native helper is introduced.
