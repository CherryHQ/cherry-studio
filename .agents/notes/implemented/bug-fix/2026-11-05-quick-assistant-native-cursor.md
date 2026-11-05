# Agent Note: Quick Assistant native drag cursor

Status: implemented

English | [中文](2026-11-05-quick-assistant-native-cursor.zh.md)

## Problem

CSS `cursor: grab` does not reliably change the macOS cursor over Electron native drag regions. Computed CSS alone cannot verify this behavior.

## Decision

QuickAssistantService opts its macOS panel into the existing Node-API addon during window creation. The addon forwards panel events to Electron, then applies the AppKit open-hand cursor on hover when Chromium's content-view hit test returns nil inside the view. That is Chromium's native draggable-background result. No-drag controls retain Chromium's event handling. Hidden and mouse-passthrough windows do not claim the cursor.

## Alternatives considered

A custom Electron distribution adds upgrade and packaging work. Renderer-driven window movement duplicates native dragging and multi-display behavior. Mirroring drag rectangles creates another region owner. The addon instead uses the existing native hit test and keeps native movement unchanged.

## Consequences

Only explicitly marked panels opt in. Associated objects hold per-window flags without retaining windows; the Node environment cleanup restores the original method. This depends on Electron's panel class and Chromium's hit-test contract and must be revalidated on Electron upgrades. A plain left press in the drag region sets the closed hand. A timer in common run-loop modes maintains it only while the button is held and stops on release, hide, close, or mouse passthrough. Its window reference is weak. Mouse-up restores hover feedback after forwarding to Electron; the timer also detects release when the window server consumes mouse-up.

## Verification

- Regression — `node native/selection-panel/build.js arm64` and `node native/selection-panel/build.js x64`: compile both macOS addon targets; x64 execution remains unverified.
- Regression — `pnpm test:main src/main/services/__tests__/QuickAssistantService.test.ts`: existing Quick Assistant lifecycle and geometry contracts pass.
- Regression — Live macOS Electron with native cursor inspection: toolbar gaps yield `NSCursor.openHandCursor`, editing yields the text cursor, and leaving the window clears the hand. Computed CSS is not used as the acceptance signal.

- Regression — Native mouse-down/drag/up injection in the live macOS instance: window bounds move while the cursor remains `closedHandCursor`; release restores `openHandCursor`, and hiding while held clears the hand. Evidence: `.context/cherry-electron-dev/native-grabbing-evidence.json`.
