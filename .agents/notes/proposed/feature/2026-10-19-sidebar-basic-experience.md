# Agent Note: Sidebar basic experience

Status: proposed

English | [中文](2026-10-19-sidebar-basic-experience.zh.md)

## Problem

The main Sidebar changes layout through edge dragging, leaves an empty shortcut list without guidance, and uses different controls and hard-coded selection colors across layouts.

## Proposal

- Keep edge dragging for expanded, icon-only, and hidden layouts, with hover recovery when hidden. Keep the existing `ui.sidebar.width` persistence. Do not add a title-bar Sidebar toggle or layout menu.
- Keep application discovery in the existing title-bar Launchpad entry. Show an empty-list hint in expanded and floating layouts explaining how to pin apps through their context menus.
- Use shared buttons, circular icon targets, and pill-shaped expanded rows. Inactive icons stay muted on hover; hover uses a faint neutral fill. Selection follows the title-bar tab background, with theme-colored icons and a subtle 0.5px border without shadows. Use 200ms color transitions and respect reduced motion. Keep visible inset keyboard focus, accessible names, and full-name tooltips. Preserve shortcut ordering, resource identities, navigation, middle-click, context menus, and unavailable-resource behavior.
- Keep the default layout and favorites. Do not introduce sections, recent items, folders, virtualization, or a new persistence format. Measure performance before proposing further optimization.

## Alternatives considered

- Separate app entries and resources into sections: deferred because it changes ordering and information architecture.
- Add a title-bar Sidebar toggle or layout menu: rejected to keep the title bar uncluttered; edge dragging and hover recovery remain available.
- Add another Sidebar launcher or shortcut picker: rejected because the title-bar Launchpad already owns application discovery and pinning.

## Acceptance criteria

- AC1 — The title bar has no Sidebar toggle or layout menu; edge dragging and hover recovery remain available, and the saved width survives remounting. (verification: renderer + Electron)
- AC2 — An empty Sidebar explains how to pin apps from Launchpad without adding a duplicate launcher or restoring removed entries. (verification: renderer + Electron)
- AC3 — Both visible layouts expose accessible controls and keyboard focus; long names remain discoverable, selected icons use the theme color, selected and hovered fills remain distinguishable, and inactive icons stay muted in both themes. (verification: renderer + Electron)
- AC4 — Reordering does not navigate, middle-click still opens a new tab, and unavailable shortcuts cannot activate but remain removable. (verification: renderer)
- AC5 — Light/dark themes, short windows, edge resizing, hover recovery, and floating context/account overlays remain usable. (verification: Electron)

## Risks

- Shared button defaults and tooltip wrappers can alter row geometry or drag behavior; verify real controls and Electron geometry.
