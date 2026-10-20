# Agent Note: Closing the last tab always lands on Launchpad

Status: implemented

English | [中文](2026-10-20-last-tab-close-launchpad.zh.md)

## Problem

Closing the last remaining tab produced two different outcomes from two entry points for the same user intent. The tab bar's X button closed the tab, and `TabsProvider` replaced it with the Launchpad fallback tab. The `tab.close` shortcut instead requested `window.close`, because `handleCloseActiveTab` special-cased `tabs.length === 1` (added by #21144 while fixing #21134).

The divergence was invisible from the user's side until the last tab: the same close action either left the shell in its designed empty state or quit the window.

## Decision

`tab.close` always closes the active tab through the tab bar's `closeTab` path. A close that empties the tab strip therefore produces the Launchpad fallback tab, exactly like the X button. The window-close accelerator (`app.window.close`, `CommandOrControl+Shift+W`) and the title bar close button remain the only ways to close the main window.

A detached sub-window keeps mapping `tab.close` to `window.close`: it hosts one tab, draws no tab bar, and has no Launchpad empty state to fall back to.

## Alternatives considered

- Keeping #21144's split behavior matches Safari/Chrome/Zed, but leaves two different results for the same action and makes the shortcut disagree with the X button.
- Making the X button close the window too would remove the Launchpad empty state entirely and change `TabsProvider`'s zero-tab contract, a much larger change than the reported inconsistency.

## Consequences

`CommandOrControl+W` no longer closes the main window when one tab remains; it leaves the Launchpad instead. Closing the window still has a dedicated shortcut and the title bar button, and close-to-tray behavior is untouched. This intentionally reverses #21144, so a future maintainer should not restore the window-close special case without also removing the Launchpad fallback.

## Verification

- Regression — `src/renderer/components/layout/__tests__/AppShell.test.tsx`: the `tab.close` shortcut on the last tab routes to `closeTab` and never requests `window.close`; the tab bar path keeps the same routing.
- Regression — `src/renderer/components/layout/__tests__/TabsProvider.test.tsx`: closing the only tab still opens `/app/launchpad` (existing coverage of the fallback).
