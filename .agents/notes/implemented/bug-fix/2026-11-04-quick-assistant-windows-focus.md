# Agent Note: Windows Quick Assistant hide hands focus back with blur plus hide

Status: implemented

English | [中文](2026-11-04-quick-assistant-windows-focus.zh.md)

## Problem

On Windows, hiding the Quick Assistant panel with its global shortcut left keyboard focus with Cherry Studio instead of returning it to the previously foreground application. The user had to click the other app or press Alt+Tab before typing worked again (issue #23292).

`hideQuickAssistant()` used `setOpacity(0)` plus `minimize()` on Windows. That trick was copied from `MainWindowService.minimizeToTrayOnWindows()` (PR #16277), where it works for normal overlapped windows. The Quick Assistant window is `alwaysOnTop` plus `skipTaskbar: true` plus `minimizable: false` (`windowRegistry.ts`, `WindowType.QuickAssistant`), and for that tool-window class `minimize()` does not reliably hand activation back. A minimized window also still reports `isVisible() == true`, so `toggleQuickAssistant()` kept calling hide instead of re-showing.

## Decision

Windows hide is now `setOpacity(0)`, then `blur()` when focused, then `hide()`. `blur()` releases activation so the previously foreground app regains focus; `hide()` removes the tool window; opacity keeps the transition visually clean and `proceedShow()` restores opacity 1 on the next show.

Supporting changes in `QuickAssistantService.ts`:

- `toggleQuickAssistant()` treats `isVisible() && !isMinimized()` as visible, mirroring `MainWindowService.toggleMainWindow()`, so a legacy minimized window re-shows instead of hiding again.
- `hideQuickAssistant()` early-returns when the window is already hidden; the `blur()` re-entrancy through `onBlur` is bounded by the `isFocused()` guard.
- `closeQuickAssistant()` delegates to `hideQuickAssistant()` on Windows only. macOS and Linux keep a plain `hide()` so an explicit settings-initiated close never triggers the macOS `<26` `app.hide()` path from a stale show-time `wasMainWindowFocused` value.
- `onMainVisible` keeps a direct `hide()` because the main window is taking activation itself.
- `proceedShow()` keeps the `show()`-not-`restore()` recovery for legacy minimized windows from pre-fix versions.

macOS hide (`app.hide()` below version 26), Linux hide, pinned blur behavior, and the no-flicker show pipeline are unchanged.

## Alternatives considered

- Keep `minimize()` on Windows: rejected because the alwaysOnTop skipTaskbar tool window does not hand activation back and leaves `isVisible()` true, breaking the next toggle.
- Use `restore()` instead of `show()` in `proceedShow()` recovery: rejected because of the known Electron multi-display scale-factor bug the existing comment documents.
- Delegate `closeQuickAssistant()` to `hideQuickAssistant()` on all platforms: rejected because on macOS `<26` a settings-initiated close could call `app.hide()` from a stale `wasMainWindowFocused == false`, hiding the settings window the user is interacting with.
- Add a native `SetForegroundWindow` module: rejected as overkill, consistent with the PR #16277 decision.

## Consequences

Hiding the Quick Assistant on Windows with the shortcut, blur auto-hide, or explicit close returns typing to the previously foreground app with no extra click or Alt+Tab, and the next shortcut press re-shows the panel with no visible flicker. Repeated toggles never leave the panel in a hide-instead-of-show state. Main-window tray behavior, macOS and Linux hide paths, pin behavior, and fullscreen handling are unchanged.

## Verification

- Regression — `pnpm vitest run --project main src/main/services/__tests__/QuickAssistantService.test.ts src/main/services/__tests__/MainWindowService.test.ts src/main/ipc/handlers/__tests__/quickAssistant.test.ts --silent`: 3 files / 119 tests pass, covering Windows blur-plus-hide, skipped blur when already blurred, toggle minimized-as-hidden, legacy minimized show recovery without restore, already-hidden no-op, and macOS close without app.hide.
- Regression — `pnpm exec oxlint src/main/services/QuickAssistantService.ts src/main/services/__tests__/QuickAssistantService.test.ts src/main/core/window/windowRegistry.ts --deny-warnings`: clean.
- Regression — `pnpm exec tsc --noEmit -p tsconfig.node.json --composite false`: clean.
