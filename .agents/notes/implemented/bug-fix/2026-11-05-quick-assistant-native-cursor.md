# Agent Note: Quick Assistant native drag cursor

Status: implemented

English | [中文](2026-11-05-quick-assistant-native-cursor.zh.md)

## Problem

CSS `cursor: grab` does not reliably change the macOS or Windows cursor over Electron native drag regions. Computed CSS alone cannot verify this behavior.

## Decision

QuickAssistantService opts its macOS panel into the existing Node-API addon during window creation. The addon forwards panel events to Electron, then applies the AppKit open-hand cursor on hover when Chromium's content-view hit test returns nil inside the view. That is Chromium's native draggable-background result. No-drag controls retain Chromium's event handling. Hidden and mouse-passthrough windows do not claim the cursor.

On Windows, the opt-in API accepts an enabled flag and subclasses the window and its same-thread child HWNDs. QuickAssistantService projects its existing view state into that flag: bar and quick-panel enable hand feedback, while conversation panels, including their titlebar, retain the default cursor. The root window's `WM_NCHITTEST` result of `HTCAPTION` owns the region decision within enabled views; the addon applies Chromium's open/closed-hand cursor resources without changing native movement. Client controls and resize edges retain Electron's behavior. Child mouse-move processing must finish before hover feedback is applied, and child capture changes must not end a native caption drag. Disabling clears the hand and timer immediately; no renderer region mirror or second view owner is introduced. The macOS one-argument opt-in remains unchanged.

## Alternatives considered

A custom Electron distribution adds upgrade and packaging work. Renderer-driven window movement duplicates native dragging and multi-display behavior. Mirroring drag rectangles creates another region owner. The addon instead uses the existing native hit test and keeps native movement unchanged.

## Consequences

Only explicitly marked panels opt in. Associated objects hold per-window flags without retaining windows; the Node environment cleanup restores the original method. This depends on Electron's panel class and Chromium's hit-test contract and must be revalidated on Electron upgrades. A plain left press in the drag region sets the closed hand. A timer in common run-loop modes maintains it only while the button is held and stops on release, hide, close, or mouse passthrough. Its window reference is weak. Mouse-up restores hover feedback after forwarding to Electron; the timer also detects release when the window server consumes mouse-up.

Windows uses per-HWND subclasses and a timer only while dragging, not a global hook or idle cursor poll. Hiding, minimizing, cancellation and mouse passthrough stop dragging. HWND destruction and Node environment cleanup remove the subclasses and release the cursor resources. Windows has no system grab/grabbing pair, so the addon embeds Chromium's BSD-licensed cursors. The existing build and packaging entry points also build the Windows target.

Windows fractional-DPI geometry remains a known upstream limitation, separate from cursor handling. At 175% DPI, a renderer child can exceed its parent HWND client area by 1–2 physical pixels and clip a normal border. Repeated bounds get/set round trips can also grow the window. Both behaviors reproduce in standalone Electron 45.2.2 without this addon, including with content-bounds APIs. This change keeps the existing product sizing logic and a normal semantic conversation border; it adds no negative offset or DPI compensation. Evidence: `.context/cherry-electron-dev/content-bounds-ab/report.md`.

## Verification

- Regression — Prior macOS verification, not rerun for the Windows extension: `node native/selection-panel/build.js arm64` and `node native/selection-panel/build.js x64` compile both macOS addon targets; x64 execution remains unverified.
- Regression — Earlier `pnpm test:main src/main/services/__tests__/QuickAssistantService.test.ts`: existing Quick Assistant lifecycle and geometry contracts pass.
- Regression — Prior macOS verification, not rerun for the Windows extension: live Electron native inspection finds `NSCursor.openHandCursor` over toolbar gaps, the text cursor while editing, and no hand after leaving. Computed CSS is not the acceptance signal.

- Regression — Prior macOS verification, not rerun for the Windows extension: native mouse-down/drag/up moves the window while keeping `closedHandCursor`; release restores `openHandCursor`, and hiding while held clears the hand. Evidence: `.context/cherry-electron-dev/native-grabbing-evidence.json`.
- Regression — Windows 11 x64 / Electron 45.2.2 at 175% DPI: all fifteen bar/quick-panel/titlebar cursor samples match grab/grabbing for bar views and the system arrow for conversation titlebars; native movement, stationary view transitions, text/buttons and resize edges pass. Evidence: `.context/cherry-electron-dev/pr-19106-final/native-cursor-comparison.json`.
- Regression — Nine focused main-process, renderer and packaging test files (288 tests) pass, including view-policy changes without resize and the unchanged macOS creation opt-in under a mocked platform. The macOS native source is unchanged; current macOS compilation and runtime acceptance remain unverified.
