# Agent Note: Cmd+W closes the last main-window tab by closing its window

Status: implemented

English | [中文](2026-10-31-cmd-w-last-tab-closes-main-window.zh.md)

## Problem

On macOS, `Cmd+W` on the last main-window tab closed the tab and left the Launchpad fallback open. This contradicted the platform's conventional behavior of closing the window when its last tab closes, and left the user with no keyboard path to dismiss the window without quitting the app. This supersedes [the previous last-tab decision](2026-10-20-last-tab-close-launchpad.md).

## Decision

On macOS, `tab.close` closes the active tab when multiple tabs remain and requests `window.close` when exactly one tab remains. The existing main-window close path preserves macOS behavior: the window closes and the app remains available in the Dock.

The tab bar's X button continues to close a tab and show the Launchpad fallback. Non-macOS shortcut behavior is unchanged.

## Alternatives considered

- Keeping the Launchpad fallback for `Cmd+W` preserves consistency with the tab bar's X, but violates the expected macOS window-close behavior.
- Making the tab bar's X close the window too would broaden the change and remove the useful Launchpad empty state.

## Consequences

`Cmd+W` closes the main window only when its last tab is open; with multiple tabs it closes only the active tab. `Cmd+Shift+W`, the tab bar's X button, detached sub-window behavior, and close-to-tray behavior are unchanged.

## Verification

- Regression — `src/renderer/components/layout/__tests__/AppShell.test.tsx`: the last-tab shortcut requests `window.close` on macOS, while multiple tabs and the tab-bar X continue to close tabs; the non-macOS fallback remains unchanged.
