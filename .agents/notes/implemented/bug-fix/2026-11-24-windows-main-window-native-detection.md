# Agent Note: Keep the Windows main window visible to native window detectors

Status: implemented

English | [中文](2026-11-24-windows-main-window-native-detection.zh.md)

## Problem

Electron marks the Windows main window as layered when Cherry Studio sets its opacity, including with an opacity of 1. Lively Wallpaper excludes layered windows before checking whether they are maximized. As a result, native maximize succeeds while Lively's window filter excludes the window. [Issue #25107](https://github.com/CherryHQ/cherry-studio/issues/25107)

## Decision

Keep the Windows main window's default opacity throughout the tray lifecycle. Hiding still removes the taskbar entry, minimizes for focus handoff, and hides the window. Showing or restoring returns the taskbar entry.

## Alternatives considered

- Guarding only the call that restores opacity leaves windows layered after they have been hidden to the tray.
- Hiding without minimizing would discard the focus-handoff behavior introduced for Windows in [PR #16277](https://github.com/CherryHQ/cherry-studio/pull/16277).

## Consequences

Windows handles its normal minimize transition without an opacity override. Native detectors can see the visible window, while the hidden tray window remains invisible.

## Verification

- Regression — `src/main/services/__tests__/MainWindowService.test.ts` verifies taskbar and minimize/hide order and catches main-window opacity changes.
- Regression — an isolated Windows Electron run checks native maximize, full screen, and tray hide/restore. The maximized HWND has `WS_MAXIMIZE` and `IsZoomed` without `WS_EX_LAYERED`.
