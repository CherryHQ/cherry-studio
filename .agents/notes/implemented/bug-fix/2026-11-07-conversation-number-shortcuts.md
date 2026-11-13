# Agent Note: Scope numbered shortcuts to conversation lists

Status: implemented

English | [中文](2026-11-07-conversation-number-shortcuts.zh.md)

## Problem

The numbered navigation commands were registered by the application sidebar and opened app entries. The intended interaction is to select a Chat topic or Agent session in the active page and reveal its shortcut while holding the configured modifier.

## Decision

The Chat topic and Agent session list bodies register the nine commands through the shared conversation-list hook. Positions follow the rendered list model, including pinned groups, sorting, filtering and collapsed sections. Only the first nine displayed items participate; group headings and collapsed items do not consume positions. The active tab owns registration, and effect cleanup releases it when its Activity hides or the page unmounts.

Holding the configured conversation modifier for 500 ms shows each available binding in a row-end Kbd. Releasing the modifier, losing window focus or changing document visibility clears the hints. Executing a shortcut does not require holding first. Disabled bindings have no hint; customized bindings display their actual combination.

The shipped `app.sidebar.open_1` through `app.sidebar.open_9` command IDs and preference keys remain stable to preserve custom bindings. Settings merge the eighteen numbered commands into one card. The default assigns Cmd on macOS (Ctrl elsewhere) to conversations and Ctrl on macOS (Alt elsewhere) to tabs; the other selector option swaps both sets in one preference update. Existing customized bindings remain until a preset is selected. Nine new `tab.open_N` commands are registered by AppShell and follow pinned tabs before regular tabs. The horizontal tab bar shares the hold-to-reveal hook with conversation lists, showing the corresponding tab bindings after 500 ms. Pinned tabs temporarily replace their icon with the hint; regular tabs show it at the trailing edge. The hook reads command defaults when no saved preference exists. The application sidebar no longer registers these commands.

## Alternatives considered

- Window-owned handlers would keep navigation alive outside the owning conversation page and require another active-list registry.
- Renaming command IDs would discard existing custom bindings unless accompanied by an unnecessary preference migration.
- Numbering source data would disagree with displayed grouping, filtering and collapse state.

## Consequences

Settings, Mini Apps and unrelated pages do not switch conversations with these commands. Collapsing or reordering a group changes the positional shortcuts. Nine tab shortcut preferences are generated from the preference definitions; no database schema changes are needed.

## Verification

- Regression — `src/renderer/components/chat/resourceList/__tests__/useConversationListShortcuts.test.tsx`: real command dispatch selects the displayed item, skips collapsed groups and missing slots, transfers ownership between Activity pages, honors custom/disabled bindings, and clears held hints on release or blur.
- Consumers — focused Topics, Sessions, SessionItem, Sidebar and CommandProvider tests pass.
- Electron — an isolated macOS development profile verifies Chat and Agent row hints, Cmd+2 selection and release cleanup; no provider requests are needed. The settings selector, persisted swap after reload, Ctrl conversation selection and Cmd tab selection are also verified. Native Windows interaction is not verified.

- Presets — focused tests cover all nine positions on macOS, Windows and Linux, custom binding preservation, and updating both roles together.
