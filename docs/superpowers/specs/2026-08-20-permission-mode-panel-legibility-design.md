---
description: Visual design for readable and consistent agent permission-mode panels at 1080p.
sources:
  - src/renderer/components/PermissionModeOption.tsx
  - src/renderer/components/QuickPanel/list.tsx
  - src/renderer/components/QuickPanel/QuickPanelView.tsx
  - src/renderer/components/composer/tools/definitions/permissionModeTool.tsx
---

# Permission Mode Panel Legibility Design

## Goal

Make the agent permission-mode chooser readable, concise, and visually consistent on a 1080p display. The change
covers both the composer QuickPanel submenu and the Select panel used by agent create/edit forms.

The existing panel backgrounds, transparency, behavior, permission semantics, and localized copy remain unchanged.

## Current problem

The composer QuickPanel renders secondary copy at 11px over a translucent surface. At common 1080p display scales,
the right-hand copy looks faint and visually detached from the mode title. The create/edit Select panel has the
opposite problem: warning copy expands some rows substantially, selected items color all text with the theme primary,
and the dangerous option renders a large uninterrupted block of red text.

Both surfaces already derive their content from `PermissionModeCard` and share `PermissionModeOptionLabel`. The
visual correction therefore stays with those existing owners instead of introducing a new permission picker or a
new shared UI API.

## Visual contract

### Shared hierarchy and color

- Ordinary titles use `text-foreground` at medium weight.
- Ordinary descriptions use solid `text-muted-foreground`; foreground opacity modifiers are not used.
- The `auto` compatibility warning uses `text-warning` on a compact warning indicator.
- The `bypassPermissions` icon, title, visible description, and warning indicator use `text-destructive`.
- Selection and danger remain separate concepts: the selected check stays neutral while danger stays red.
- Existing panel background and transparency classes do not change.

### Composer QuickPanel

- Rows use a consistent 34px visual height with aligned icon, title, description, and trailing-state columns.
- Titles remain compact; descriptions render at 12px with a 16px line height and truncate when space is limited.
- Long warning copy is removed from the description column. A visible semantic warning indicator exposes the full
  warning in a Tooltip.
- Footer shortcuts use compact neutral keycaps so navigation help remains scannable without competing with content.

### Agent create/edit Select

- Options retain the existing two-line title/description structure with consistent padding and spacing.
- The selected option uses the neutral accent surface and ordinary foreground instead of coloring all copy with the
  theme primary. The check remains visible and neutral.
- Long compatibility and danger warnings move into Tooltips, leaving rows at a consistent height.
- Warning-bearing rows retain a visible orange or red indicator. The full warning opens on pointer hover and when the
  owning option is keyboard-focused; assistive technology receives the same warning as the option description.

## Tooltip content

Tooltips reuse each card's existing localized `warningKey` and `warningFallback`; no shorter duplicate warning copy
or new translation keys are introduced. Modes without a warning do not render an indicator or Tooltip.

## Scope and alternatives

The QuickPanel typography and row metrics are shared because the 11px secondary column is a general readability
defect, independently of permission modes. Permission-specific colors and warning Tooltips remain in the existing
permission presentation component.

Rejected alternatives:

- A permission-only font override would leave the shared 11px row contract and crowded footer unchanged.
- A dedicated permission popover would duplicate QuickPanel keyboard navigation and selection behavior.
- Always-visible multi-line warnings would preserve the current uneven, visually heavy Select panel.

## Verification

- Compare the permission submenu before and after at a 1920×1080 window size and a fractional display scale.
- Verify the composer QuickPanel and agent create/edit Select in light and dark themes.
- Verify ordinary, `auto`, selected, and `bypassPermissions` rows for semantic color and truncation.
- Verify warning Tooltips by pointer and keyboard, including accessible warning text.
- Exercise another QuickPanel submenu to ensure the shared row and footer changes remain usable.
- Run the focused renderer tests for permission presentation and QuickPanel layout, followed by the repository-required
  lint, test, format, and build checks.
