# Agent Note: Keep conversation spacing independent of native scrollbar gutters

Status: implemented

English | [中文](2026-11-04-conversation-scrollbar-spacing.zh.md)

## Problem

Conversation lists combine `scrollbar-color` with WebKit scrollbar styling. Blink ignores the WebKit styling when the standard scrollbar properties apply, so a configured 6px width does not guarantee a 6px gutter. Platform scrollbar selection then determines whether the viewport loses space. A transparent classic scrollbar still reserves its gutter with `scrollbar-gutter: stable`; an overlay scrollbar does not. Identical list padding therefore produces different available row widths across environments.

## Decision

The UI package provides a Radix-backed `ScrollArea` with a native scroll viewport and an overlaid solid-color thumb. Hover widens the thumb without resizing the viewport. Radix owns pointer dragging and scrollbar visibility; CSS animates its exit. Resource lists remove their duplicated scrollbar gradient and fade timers.

`DynamicVirtualList` uses the shared UI scroll area for internal scrolling and exposes the native viewport through its ref. Both sortable and non-sortable resource lists keep the existing negative 8px root margin and 8px viewport padding. The scrollbar sits at the pane edge, and the row insets stay the same.

## Alternatives considered

- Change operating-system preferences: changes unrelated applications and does not repair platform-dependent layout.
- Force a fixed WebKit scrollbar width: changes the native hover behavior and requires suppressing the standard color properties.
- Extend a classic native scroller by its measured gutter: aligns rows but clips the scrollbar at the pane boundary.
- Implement custom pointer dragging: duplicates an established primitive's interaction handling.

## Consequences

Resource rows no longer depend on the operating system's native gutter. The thumb retains a solid appearance and hover expansion, with no gradient. The UI package gains a Radix Scroll Area dependency. Native scrolling, virtualizer measurement and listbox keyboard handling continue to use the same viewport element. No settings migration or user action is required.

The normal UI-package typecheck reports TS2882 for an unchanged Markdown CSS import; disabling only side-effect import checking passes. Native Windows hardware, operating-system mode switching and packaged builds have not been verified.

## Verification

- Regression — Five targeted renderer test files pass 157 tests covering resource lists, entity actions and virtual-list consumers.
- Regression — Isolated macOS Electron verifies wheel scrolling, thumb dragging, solid-color hover expansion, intermediate fade opacity and stable row widths; 200px and 360px panes retain 6px left and 6.5px right insets including the border, with no horizontal overflow.
- Regression — Electron measures the hovered thumb ending 0.5px before the pane edge after restoring the original layout pair.
- Regression — Web typecheck, scoped lint and changed-file formatting pass; existing user profiles and operating-system preferences are unchanged.
