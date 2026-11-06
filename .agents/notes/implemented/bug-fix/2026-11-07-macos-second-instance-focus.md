# Agent Note: Activate macOS on a repeated launch

Status: implemented

English | [中文](2026-11-07-macos-second-instance-focus.zh.md)

## Problem

Opening a second instance restores the existing main window, but on macOS the original application can remain behind another application. Restoring or focusing a BrowserWindow alone does not request application activation.

## Decision

When explicitly showing an existing macOS main window, request application focus after restoring/showing and focusing the window. Both minimized and non-minimized paths use Electron's application activation API.

## Alternatives considered

- Forcing focus from the E2E test would hide the user-visible failure.
- Changing all window types would also affect non-activating utility panels.

## Consequences

The existing singleton and protocol routing remain unchanged. Other platforms retain their current focus behavior. This does not alter passive background window creation.

## Verification

- Regression — two second-instance tests model a background macOS application with minimized and ordinary windows. Both failed before the fix; all 128 MainWindowService tests passed afterward.
- Regression — the native MP-133 scenario remains the end-to-end confirmation; its rerun is pending.
