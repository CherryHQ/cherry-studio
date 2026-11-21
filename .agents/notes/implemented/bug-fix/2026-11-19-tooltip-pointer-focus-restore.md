# Agent Note: Keep tooltips closed when a menu returns focus after a pointer pick

Status: implemented

English | [中文](2026-11-19-tooltip-pointer-focus-restore.zh.md)

## Problem

Many call sites wrap a DropdownMenu, Popover, or ContextMenu trigger in `Tooltip`. When nothing is focused before a mouse user opens such a menu and picks an item, the tooltip opens on the trigger after the menu closes. Radix prevents trigger focus on `pointerdown`, the menu focuses itself with a script `focus()`, and on close it calls `trigger.focus()`. Chromium marks a script focus as `:focus-visible` when nothing was focused before, and that state carries through to the restored trigger focus, so the `:focus-visible` guard in `TooltipTrigger` lets the tooltip open.

## Decision

`packages/ui` tracks the last input modality with document-level capture listeners: `pointerdown` marks pointer input, and a `keydown` without Meta, Ctrl, or Alt that is not the bare Shift key marks keyboard input. `TooltipTrigger` blocks focus-open when the last input was a pointer, and otherwise keeps the existing `:focus-visible` check. Before any input, behavior is unchanged.

Modifier keys do not count as keyboard input because Cmd+Tab, Alt+Tab, and shortcuts are not focus navigation; returning to the window restores focus to the trigger, which would otherwise reopen the tooltip. Shift+Tab still counts, because its key is `Tab`.

## Alternatives considered

- `onCloseAutoFocus={(e) => e.preventDefault()}` at each call site (the common Radix workaround) drops focus after the menu closes, which breaks keyboard users, and needs a change in every caller.
- `:focus-visible` alone is the previous guard and misses this case in Chromium.
- Requiring keyboard modality for any focus-open, as Zag does, also suppresses focus that happens before any input and would require keyboard events in existing tests that simulate focus with `:focus-visible` only.
- `@react-aria/interactions` or `@zag-js/focus-visible` provide the same tracking, but they are large for this need, and Zag patches `HTMLElement.prototype.focus` globally.

## Consequences

The only newly suppressed opening is a focus that follows a pointer input. Tab, Shift+Tab, and opening and closing a menu from the keyboard still open the tooltip. The listeners are module-level and live for the window's lifetime.

## Verification

- Regression — In `packages/ui/src/components/primitives/__tests__/tooltip.test.tsx`, opening a DropdownMenu with the pointer while nothing is focused and then picking an item failed before the fix and passes after it. Cmd+Tab, Alt+Tab, Ctrl+C, and Shift after a pointer pick also failed without the modifier filter. Tab, Shift+Tab after a pointer click, and a keyboard pick still open the tooltip.
