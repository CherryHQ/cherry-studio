# Agent Note: Alt+Space show/hide shortcut on Windows

Status: implemented

English | [中文](2026-11-26-alt-space-show-shortcut.zh.md)

## Problem

The "Show application" global shortcut (`app.window.show`, `shortcut.app.window.show`) cannot be recorded as Alt+Space on Windows. The OS opens the window system menu before the keystroke reaches Chromium's DOM `keydown`, so the settings recorder never captures it.

## Decision

- The shortcut recorder offers a Windows-only manual "Use Alt+Space" assignment for `app.window.show`, with a hint that enabling it takes over the system-menu shortcut. The default binding stays empty; Alt+Space is opt-in.
- Once saved, registration flows through the existing `globalShortcut` path, and a registration failure surfaces the existing occupied-by-system-or-application conflict.
- When the main window is focused and the saved binding is Alt+Space, `before-input-event` swallows the keystroke so the system menu does not open on top of the toggle.

## Alternatives considered

- Capturing Alt+Space directly in the recorder is impossible: the OS consumes the keystroke before it reaches the renderer.
- Suppressing the menu through a native Win32 message hook adds native surface for no extra coverage; `globalShortcut` (RegisterHotKey) already preempts the menu once bound.
- Shipping Alt+Space as the default binding was rejected as too intrusive: it would hijack every Windows user's system menu without consent.

## Consequences

Windows users can bind Alt+Space; other platforms are unchanged. While bound, the main window's Alt+Space opens the app instead of the system menu. No packaged-artifact end-to-end validation on physical Windows hardware is claimed.

## Verification

- Regression — `src/renderer/pages/settings/__tests__/ShortcutSettings.test.tsx`: fallback visibility on Windows, manual assignment without key capture, conflict blocking, and hiding off Windows and for other shortcuts.
- Regression — `src/main/services/__tests__/ShortcutService.test.ts`: Alt+Space global registration, registration-conflict broadcast, focused-window system-menu suppression, and untouched behavior otherwise.
- Regression — `src/shared/utils/__tests__/shortcut.test.ts`: Alt+Space is a valid binding and resolves from a Win32 Alt+Space key event.
- Regression — `src/shared/utils/command/__tests__/keybindings.test.ts`: `app.window.show` with an Alt+Space preference resolves to the `Alt+Space` Electron accelerator.
