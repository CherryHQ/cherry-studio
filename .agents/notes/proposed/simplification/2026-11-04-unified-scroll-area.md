# Agent Note: Unify application scroll areas and remove legacy scrollbars

Status: proposed

English | [中文](2026-11-04-unified-scroll-area.zh.md)

## Problem

The renderer-local `Scrollbar`, the UI-package `Scrollbar`, and `DynamicVirtualList` separately own native scrollbar styling and visibility timers. All can select platform-dependent gutters through standard scrollbar colors. The renderer-local component has 17 direct production importers, including editors, selectors, settings and horizontal containers, plus dedicated tests and mocks. UI Scrollbar consumers include message virtualization, thinking panels, file navigation, settings, knowledge and translation.

The conversation-spacing repair introduces a Radix-backed UI `ScrollArea`, but only resource lists opt into it. Its fixed vertical scrollbar, scroll-only visibility, default `flex-1` root and viewport-oriented div props are insufficient for migrating the existing consumers unchanged. The existing repair note remains the owner of that scoped fix: [conversation scrollbar spacing](../../implemented/bug-fix/2026-11-04-conversation-scrollbar-spacing.md).

## Proposal

Keep `ScrollArea` as the sole application scroll-container API in `@cherrystudio/ui`. Root layout and viewport behavior are explicit: root props own layout, size and `hidden`; viewport props own the native scroll ref, scroll events and keyboard attributes. Content props own the layout of the children. Do not make a generic primitive flex-grow by default. Use Radix's native scrolling and pointer handling for both axes, visibility modes and exit animation; retain pure-color hover expansion without layout changes.

Migrate both old Scrollbar populations directly, then delete the renderer-local component and UI-package Scrollbar implementation, exports, obsolete stories, mocks and implementation-pinning tests. Do not retain compatibility aliases or wrappers. Map permanent visibility and hover/scroll visibility from existing callers to supported behavior, retaining custom hide delays only where an existing consumer needs them.

Make internal-scroll `DynamicVirtualList` use the same UI scroll area. Its external-scroll mode remains attached to the supplied ancestor without creating another scroll owner. Remove its native scrollbar styles, duplicate visibility state/timers and the resource-only viewport-injection escape hatch. Resource lists retain their pane-edge layout in their own composition.

Migrate application-owned list and popup scrollers that duplicate this styling, including the translation language picker. Inspect every fixed gutter compensation and nested-scroller inheritance reset against the new geometry. Message anchor ticks currently reserve approximately 15px for a native gutter; their placement must be derived from their actual host rather than preserving that assumption. Editors, native text inputs, code viewers, HTML-preview documents and intentionally scrollbar-free surfaces are separate owners and are not mechanically wrapped or globally restyled.

## Alternatives considered

- Keep old exports as forwarding adapters: leaves two public names and makes incomplete migrations appear complete.
- Change only the UI Scrollbar: misses renderer-local, virtual-list and hand-styled consumers.
- Replace every overflow element: changes third-party/editor layout and creates nested scroll owners.
- Preserve the single-div implementation: minimizes DOM changes but retains the platform-dependent gutter and native-style conflict.

## Acceptance criteria

- AC1 — No production or test import, mock, export or documentation reference requires either deleted Scrollbar implementation; only the UI ScrollArea owns application scrollbar behavior (verification: source search, scoped typechecks)
- AC2 — Vertical, horizontal and two-axis overflow scroll correctly; hidden/folded panels occupy no layout and max-height/auto-height, flex and grid consumers preserve their sizing (verification: UI browser tests, Electron)
- AC3 — Consumer refs, measurements, wheel handlers, keyboard navigation and programmatic scrolling target the real viewport; internal and external virtualization retain stable reading anchors and sticky headers (verification: targeted renderer tests, Electron)
- AC4 — Always-visible and hover/scroll-visible consumers retain their visibility contracts; solid thumbs widen on hover and fade without changing row width, including reduced-motion behavior (verification: UI browser tests, Electron)
- AC5 — Conversation panes, message anchor ticks, nested thinking/code panels, selectors and translation remain aligned without fixed native-gutter assumptions or horizontal overflow (verification: Electron on macOS and Windows)
- AC6 — Changed-file lint/format, affected-consumer tests, documentation pairing and source-linked documentation checks pass, with unverified platform/build coverage recorded explicitly (verification: scoped local checks, CI)

## Risks

The strongest counterargument is DOM compatibility: Radix adds a viewport/content layer, while existing consumers use direct-child flex/grid layout, `hidden`, refs and virtualizer measurements on one div. Blind prop forwarding can create blank space, break folding or attach scrolling to the wrong element. Each call site must assign root and content layout deliberately; wrappers and CSS selectors need verification.

Preserving visual behavior does not mean preserving native scrollbar metrics. Hover cards, reading anchors, wheel ownership, nested panels and horizontal message groups need explicit regression evidence. The migration should be one coherent simplification with independently verifiable consumer groups, not a repository-wide text replacement. This note is a proposal and does not authorize deleting supported behavior before verification.
