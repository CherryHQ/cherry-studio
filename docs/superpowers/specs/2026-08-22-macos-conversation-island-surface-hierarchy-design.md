# macOS Conversation Island Surface Hierarchy Redesign

Status: approved

## Summary

Reorganize the macOS Conversation Island so its information hierarchy remains predictable across one activity, multiple activities, hover expansion, and compact presentation. Compact mode becomes a glanceable title-and-status summary. A single expanded activity shows identity and status above the full title. Multiple expanded activities retain the existing top summary, while every list item reuses the single-activity reading order: identity and status first, title second.

The change remains feature-local. Main continues to own eligible activities, Primary Activity selection, frozen expanded order, authoritative expansion, window bounds, exit timing, and navigation. The renderer derives one private presentation surface from the existing snapshot. No shared snapshot field, IPC route, persistent setting, native helper, or generic WindowManager API is added.

## Relationship to the existing designs

This document refines:

- [the approved Conversation Island design](./2026-08-21-macos-conversation-island-design.md);
- [the approved motion and notch polish design](./2026-08-22-macos-conversation-island-motion-polish-design.md).

The following earlier decisions are replaced:

- compact content order;
- the capsule fallback's reduced expanded content;
- the flat 44 px multi-activity row;
- permanent Primary Activity row emphasis;
- the five-visible-row limit;
- presentation-specific information semantics.

All other eligibility, priority, ordering, localization, click navigation, top anchoring, spring, exit, reduced-motion, transparent-window safety, and failure-cleanup contracts remain in force.

## Problem

The current renderer infers display behavior through overlapping booleans such as expanded, single activity, and notch presentation. The resulting layouts do not share a stable grammar:

- compact and expanded modes move the title and status to unrelated positions;
- single and multi-activity hover states look like different products;
- the multi-activity header and rows duplicate status without a clear summary-versus-item distinction;
- a permanent Primary Activity background competes with the content and resembles selection;
- multi-activity rows emphasize status while reducing the task title to muted trailing text;
- capsule and hardware-notch presentations omit different information.

The implementation has the data required to solve these issues. The problem is renderer presentation ownership, not missing shared state.

## Goals

- Define one explicit renderer surface for every compact/expanded and single/multi combination.
- Preserve a stable information order as the island expands and activity count changes.
- Make task title the primary compact information.
- Reuse the single-activity reading grammar inside every multi-activity list item.
- Retain the existing multi-activity top status and localized activity-count summary.
- Keep notch and capsule presentations semantically equivalent.
- Improve list readability without increasing the maximum expanded window height.
- Preserve existing hover timing, navigation, motion, reduced-motion, ordering, and failure behavior.

## Non-goals

- Add message previews, tool details, progress bars, inline actions, pinning, or a close control.
- Change activity eligibility, priority, expiry, or Primary Activity selection.
- Add Cindy's presentation policy engine, blocking cards, completion cards, or native carrier helper.
- Add a shared `displaySurface` field or another IPC command.
- Add a user preference for density, motion, or compact content order.
- Redesign Assistant or Agent identity resolution.
- Generalize the surface resolver or activity-card layout for other windows.

## Repository and reference evidence

### Cherry Studio ownership

- `ConversationIslandService` already owns authoritative activities, Primary Activity selection, expansion, bounds, exit, and snapshot publication.
- `expandedActivityState` already freezes expanded ordering, so list priority does not jump while the user targets a row.
- Every `ConversationIslandActivityItem` already contains `identityAvatar`, `identityName`, `state`, `statusText`, and `title`.
- `ConversationIslandSnapshot` already contains `secondaryCount`, `activityCountText`, `presentation`, `expanded`, `exiting`, and `reducedMotion`.
- The renderer currently combines these values through scattered booleans; comparable renderer code elsewhere in the repository derives private discriminated view models from authoritative inputs.

These facts make a renderer-local surface resolver the narrowest correct owner. Moving the decision into the shared snapshot would duplicate state, couple main to renderer layout, and provide no independent cross-process capability.

### Cindy reference

Cindy separates multiple layers rather than treating every flag combination as a visual state. It keeps compact and expanded modes distinct, uses an explicit display surface for its richer presentation policies, and branches expanded content between a single-session detail and a multi-session list. Its stable compact grammar and count-based expanded branching are useful here. Its main-owned `displaySurface` is not copied because Cherry Studio does not currently auto-present blocking, transient, or completion cards.

Sources:

- [Cindy compact and expanded display modes](https://github.com/makecindy/cindy/blob/cb648cfdc264618a0986d4425a29d62ba3992fdf/apps/desktop/src/shared/agentIsland.ts#L60-L64)
- [Cindy display-surface and presentation-policy resolution](https://github.com/makecindy/cindy/blob/cb648cfdc264618a0986d4425a29d62ba3992fdf/apps/desktop/src/main/agent-island/state.ts#L1680-L1815)
- [Cindy compact and expanded layout branching](https://github.com/makecindy/cindy/blob/cb648cfdc264618a0986d4425a29d62ba3992fdf/apps/desktop/native/agent-island/macos-agent-island-helper.swift#L2378-L2496)

## State model

The renderer derives one private discriminated union from the snapshot:

```ts
type ConversationIslandSurface =
  | {
      kind: 'compact'
      primary: ConversationIslandActivityItem
      totalCount: number
    }
  | {
      kind: 'single-detail'
      activity: ConversationIslandActivityItem
    }
  | {
      kind: 'activity-list'
      activities: ConversationIslandActivityItem[]
      primaryActivityId: string
    }
```

The resolver is pure and feature-local:

| Authoritative snapshot | Derived surface |
| --- | --- |
| `expanded === false`, one activity | `compact` |
| `expanded === false`, multiple activities | `compact` |
| `expanded === true`, `secondaryCount === 0` | `single-detail` |
| `expanded === true`, `secondaryCount > 0` | `activity-list` |

`presentation: 'notch' | 'capsule'`, `exiting`, and `reducedMotion` are orthogonal. They affect shell layout, interactivity, and motion, but never change the derived business surface.

Expanded multi-activity snapshots are produced with an `activities` array by main. The renderer does not invent a fallback ordering or reconstruct missing business data. That invariant remains covered at the service boundary.

## Information hierarchy

### Compact, one activity

Hardware notch:

```text
[ state dot + task title ] [ physical notch ] [ localized status ]
```

Capsule:

```text
[ state dot + task title ]                    [ localized status ]
```

The title is the primary information. The state dot is supplemental and never replaces localized status text. Long titles truncate before status or physical occlusion.

### Compact, multiple activities

The compact layout remains structurally identical and adds a total-count badge after status:

```text
[ state dot + Primary title ] [ physical notch ] [ Primary status ] [ total count ]
```

The badge shows total eligible activities, derived as `secondaryCount + 1`. It does not use `+N`, so its meaning agrees with the expanded total summary. Accessible text continues to include the localized `activityCountText`.

### Expanded, one activity

```text
[ identity avatar + identity name ] [ physical notch if present ] [ state dot + status ]
[                              full task title                               ]
```

The top row answers who is active and what state it is in. The bottom row is the existing navigation target and answers what task is active. The capsule uses the same two-row information grammar without an occlusion column.

### Expanded, multiple activities

The existing top summary remains:

```text
[ activity icon + Primary state + Primary status ] [ physical notch ] [ localized total ]
```

The capsule presents the same summary in a continuous horizontal row.

Each activity item then uses the single-detail reading order:

```text
[ identity avatar + identity name ]                  [ state dot + status ]
  task title
```

The summary status and the first item's status are intentionally repeated at different scopes. The header provides a stable Primary Activity overview while scrolling; the item status identifies the individual navigation target. Ordering, not a permanent fill, communicates priority.

## Visual rules

- Use `@cherrystudio/ui` controls and existing semantic theme tokens.
- Hardware-notch surfaces remain black with controlled white-opacity foregrounds.
- Capsule surfaces use semantic popover, border, foreground, muted-foreground, accent, and focus-ring tokens.
- Titles use the primary foreground; identity and status use quieter foreground levels.
- State colors supplement localized text and are never the only status cue.
- The Primary Activity has no permanent selected background or stronger font solely because it is primary.
- Only the row under pointer hover or keyboard focus receives a restrained accent surface.
- Identity avatars are decorative; identity name, status, and title remain text.
- List content truncates to one line per text field. The island does not expose message content as a fallback.

## Dimensions and scrolling

Both notch and capsule presentations use the same outer dimensions:

| Surface | Width | Height |
| --- | ---: | ---: |
| compact | 320 px | 38 px |
| single detail | 420 px | 82 px |
| two-activity list | 420 px | 142 px |
| three-activity list | 420 px | 194 px |
| four-or-more activity list | 420 px | 246 px |

The formulas are:

```text
single detail = 38 px summary + 44 px title
activity list = 38 px summary + min(activity count, 4) × 52 px item
```

Four items are visible. The fifth and later items scroll inside the list while the summary remains fixed. This replaces the former 44 px rows and five-visible-row limit. The maximum expanded height decreases from 258 px to 246 px, so the clearer two-level rows do not enlarge the maximum transparent BrowserWindow footprint.

The BrowserWindow continues to resize to exact visual bounds. It is never pre-grown or left larger than the visible island because transparent Electron pixels can intercept input.

## Interaction and motion

- Compact pointer entry starts the existing 500 ms expansion dwell.
- Dwell does not swap content or move information before expansion.
- Expansion remains top-center anchored and uses the approved restrained spring.
- Expanded content crossfades within the resizing shell.
- Leaving the whole expanded surface starts the existing 250 ms collapse delay.
- Re-entry before the deadline cancels collapse.
- Hover or focus changes only the targeted activity row.
- Clicking a compact surface opens the Primary Activity.
- Clicking an expanded row first requests collapse, then opens that activity through the existing navigation route.
- Fresh-reentry protection continues to prevent resize-induced accidental reopening.
- The existing 180 ms normal exit and immediate safety cleanup remain unchanged.
- macOS reduced motion disables spring, scale, and crossfade while preserving structure and controls.

## Accessibility

- Every navigable surface remains a real button from `@cherrystudio/ui`.
- Expanded multi-activity content remains a semantic list of buttons.
- Row accessible names include localized status and title; identity remains visible text.
- Focus-visible feedback is equivalent in strength to pointer hover and uses the semantic focus ring.
- Physical-notch spacer and decorative avatars/icons are hidden from assistive technology.
- Exit snapshots are non-interactive and hidden from assistive technology as today.

## Data flow and failure behavior

1. Main selects and orders eligible activities and builds the existing snapshot.
2. Main freezes expanded ordering and decides whether expansion is authoritative.
3. The renderer derives `compact`, `single-detail`, or `activity-list` without mutating the snapshot.
4. `presentation` selects a notch or capsule shell around the same semantic content.
5. Main resolves exact bounds from activity count and presentation-independent surface dimensions.
6. Existing IPC requests handle expand, collapse, and navigation.

No new failure mode is introduced. Expansion and navigation request failures continue through the feature logger. Disablement, shutdown, invalid display, unreliable window, and renderer failure continue to use immediate main-owned cleanup. The renderer does not add speculative malformed-snapshot recovery.

## Alternatives and tradeoffs

### Add `displaySurface` to the shared snapshot

Rejected. Cindy needs a main-owned surface because its blocking, transient, completion, and manual policies affect when the native island presents itself. Cherry Studio's current main process already supplies every fact required by the renderer, and no second consumer needs a presentation surface. A shared field would duplicate truth and couple main to one renderer layout.

### Turn multiple activities into a generic list page

Rejected after visual review. Replacing the single-detail header with “Activities / Total” made single and multi hover states feel disconnected and removed Primary Activity continuity.

### Keep Primary Activity detail and append only secondary rows

Rejected after visual review. It preserved single-detail continuity but lost the requested multi-activity top statistics and gave the first item a structurally privileged layout.

### Keep 44 px rows and five visible activities

Rejected after density comparison. Two lines fit only by compressing text size and spacing, weakening the hierarchy this redesign is intended to establish. The approved 52 px row shows four items while reducing maximum surface height by 12 px.

### Preserve presentation-specific content

Rejected. Omitting identity or summary information from the capsule creates two semantic products and multiplies state combinations. Presentation should describe physical layout only.

## Verification

### Pure surface tests

- One compact activity resolves to `compact`.
- Multiple compact activities resolve to `compact`.
- One expanded activity resolves to `single-detail`.
- Multiple expanded activities resolve to `activity-list`.
- Notch, capsule, exiting, and reduced-motion inputs do not change the resolved surface kind.

### Pure geometry tests

- Compact remains 320 × 38.
- Single detail resolves to 420 × 82.
- Two activities resolve to 420 × 142.
- Three activities resolve to 420 × 194.
- Four activities resolve to 420 × 246.
- Five or more activities remain 420 × 246 and scroll internally.
- Notch and capsule use equivalent outer dimensions.

### Renderer contract tests

- Compact single and multi surfaces prioritize title, preserve status, and show total count only for multiple activities.
- Single detail shows identity and status above the full title for both shell presentations.
- Multi-activity header preserves Primary status and localized total for both shell presentations.
- Every activity row shows identity, status, and title in the approved order.
- No row has permanent Primary Activity emphasis.
- Pointer hover and focus-visible affect only the targeted row.
- Existing 500 ms expansion, 250 ms collapse, fresh re-entry, click navigation, exit, and reduced-motion contracts remain green.

Tests assert observable contracts and pure state/geometry results, not markup snapshots or duplicated implementation calculations.

### Runtime verification

In the tracked Electron instance:

1. verify compact single and multi states at 320 × 38;
2. hover one activity and verify the 420 × 82 identity/status/title hierarchy;
3. inject two, three, four, and five activities and verify 142, 194, and capped 246 px heights;
4. verify the summary remains fixed while a fifth activity scrolls;
5. verify no row is permanently highlighted and hover/focus affects one row only;
6. click each visible activity type and confirm collapse-before-navigation behavior;
7. force or simulate capsule presentation and verify semantic parity;
8. repeat transition checks with reduced motion;
9. remove temporary activity state and leave the healthy tracked instance running.

## Acceptance criteria

- The four compact/expanded and single/multi combinations have an explicit, testable renderer surface.
- Compact mode consistently prioritizes task title, then status and total count.
- Single detail and every multi-activity item share the identity/status/title reading grammar.
- Multi-activity expansion retains its top Primary status and localized total summary.
- Notch and capsule presentations show equivalent information.
- Multi-activity rows are 52 px high, show at most four items, and scroll beyond four.
- The maximum expanded window height does not exceed 246 px.
- Primary order is visible without a permanent selected background.
- Existing ownership, timing, motion, navigation, reduced-motion, and failure-safety contracts are preserved.
- No shared snapshot extension, new IPC route, persistent setting, native helper, or generic infrastructure abstraction is introduced.
