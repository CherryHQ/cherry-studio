# Agent Note: Lightweight tray mode

Status: proposed

English | [中文](2026-11-24-lightweight-tray-mode.zh.md)

## Problem

Hiding Main retains its renderer and webviews while the application is idle in the tray.

## Proposal

Add an opt-in `app.tray.lightweight_mode` preference. With a working tray and close-to-tray enabled, an idle Main closes normally, releasing its renderer while preserving unload hooks. Existing WindowManager bounds and tab persistence restore the interface on demand. Keep the process alive while the tray is active. Preserve Main's composer drafts in a main-memory shared-cache snapshot, without changing other windows' draft isolation or writing drafts to disk. While runtime tasks are active, retain the hidden window; a subsequent close can release it. Launch-to-tray remains unchanged in this first iteration because startup services may depend on the initial renderer.

Voice sessions also retain the renderer. Main's file-edit guard vetoes unloading while files are dirty, saving, opening, or composing; a veto falls back to hiding the window. Quitting retains the application's existing exit semantics.

After a lightweight close succeeds, suspend the detached-tab window pool to release its idle standby. Keep detached tabs that are already open. Resume prewarming asynchronously after the rebuilt Main is shown. A detach that arrives before the standby is ready may create a window on demand.

Quotes wait in the main process until the rebuilt window's active composer reports that its listener is mounted. This replaces the fixed 100 ms delivery delay and rejects readiness reports from other windows.

## Alternatives considered

Force destruction skips unload-based persistence. Moving all drafts to shared cache changes cross-window editing semantics. Replacing Electron is outside this feature's scope.

## Acceptance criteria

- AC1 — The default remains hide-to-tray; opt-in idle close releases Main only with an available tray, and busy close retains it (verification: unit)
- AC2 — Closing the last window with an active tray keeps the process alive; without a tray it still quits (verification: unit)
- AC3 — Main's composer drafts survive renderer recreation, preserve their expiration, and remain isolated from detached-window drafts (verification: renderer)
- AC4 — Reopening recreates one Main with remembered geometry and tabs; repeat close/open works (verification: Electron)
- AC5 — Settings explain the reload cost and busy fallback in all supported locales (verification: scoped formatting and locale checks)
- AC6 — A successful lightweight close releases the idle standby, keeps open detached windows, and resumes prewarming after Main is shown (verification: unit and Electron)

## Risks

Open detached tabs and unrelated window pools retain their renderers. Process-tree measurements distinguish RAM savings from GPU memory, which may remain allocated to Chromium. Unsaved state outside composer drafts and the existing persist cache is not restored. Native platform behavior and reopen latency require validation on each supported platform.

Local validation: dependencies installed, targeted main and renderer tests passed, and the Windows production build succeeded. For the standby policy, 293 tests covering the main window, detached windows, and the WindowManager passed. In an isolated Windows profile, the final build kept an open detached translation tab on the same renderer through a lightweight close, removed the idle standby, and restored the standby after reopening Main.
