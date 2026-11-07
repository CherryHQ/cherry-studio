# Agent Note: Honor the macOS Dock hide cooldown

Status: implemented

English | [中文](2026-11-08-macos-dock-hide-cooldown.zh.md)

## Problem

A rapid show and close could leave the Dock icon visible with every contributing window hidden. Electron 45.2.2 ignores `DockHide()` during the first second after `DockShow()`. WindowManager had already recorded the hidden intent, so later identical updates did not retry the ignored native request.

## Decision

WindowManager waits until 1100 milliseconds after its latest Dock show request before hiding. Both ordinary hides and asynchronous show completion use the same latest-intent check. A new show cancels a pending hide. Stop and destroy cancel deferred work and prevent a late show callback from scheduling another hide.

## Alternatives considered

- Slowing the E2E interaction would conceal the user-visible failure.
- Retrying every visibility update would issue redundant native operations without respecting Electron's cooldown.
- An independent polling service would duplicate the window manager's ownership of Dock intent.

## Consequences

A rapid close may retain the icon for the remaining cooldown. Window contribution and hold rules remain the source of the desired state. Deferred work belongs to the existing service lifecycle and cannot hide the Dock after a newer show request or shutdown.

## Verification

- Regression — 301 tests across `WindowManager.quirks.test.ts`, `WindowManager.test.ts` and `MainWindowService.test.ts` passed. The Dock fixture models native cooldown and asserts actual visibility after rapid close, reopen, delayed show completion, shutdown and service restart; it also checks pooled windows and Dock holds.
- Regression — before the repair, the owned local MP-111 observer recorded hidden managed windows and hidden Dock intent while native Dock visibility remained true. Real desktop acceptance of the repair remains pending.
