# Agent Note: Clear per-window state when a pooled window returns to its pool

Status: implemented

English | [中文](2026-11-11-window-pool-release-event.zh.md)

## Problem

Closing a recyclable pooled window hides it and keeps the same `BrowserWindow`, id and mounted renderer for the next `open()`. `WindowManager` announced only creation and destruction, so services that cleared per-window state in `onWindowDestroyed` kept treating a closed window as live until the pool destroyed it, which can take minutes.

Two selection agent window failures followed. On macOS, Cmd+M followed by Cmd+W within the 200 ms collapse animation returned the window to the pool, and the animation's continuation then published a capsule for it; restoring that capsule showed a window the pool still treated as idle and could hand to the next agent action. Separately, the window's composer stayed registered as a screenshot target, so a global screenshot taken from another app after closing the window fell back to it as the last chat window and was delivered into the hidden window.

## Decision

`WindowManager` fires `onWindowReleasedToPool` (and the type-filtered `onWindowReleasedToPoolByType`) at the end of `releaseToPool()`, once the window is hidden and in the idle queue. Both `close()` and an intercepted native close reach it. A release that destroys the window (recycling disabled, over capacity, fullscreen) fires only `onWindowDestroyed`, so the two events never fire for the same close and a service clearing per-window session state subscribes to both.

`SelectionAgentWindowService` clears layout, replaceability, summary, shrinking and collapse state on both events. Its collapse animation continuation hides the window and publishes the capsule only while the collapse entry it created is still current; otherwise it only restores opacity, because the pool does not reset opacity on reuse. `ScreenshotChatService` forgets the window's target, last-focused mark and pending deliveries on both events.

## Alternatives considered

Firing the release event on every `releaseToPool()` branch would duplicate `onWindowDestroyed` for destroying releases and blur the existing "truly destroyed" contract. Intercepting the window's native `close` or `hide` inside the selection service misses `wm.close()`, which never emits a native `close`, and cannot tell a collapse hide from a close. Unmounting a released window's renderer content, as some Electron window-pool libraries do, would also release renderer-registered state, but it changes every pooled renderer while the failures found are fixed in main. Resetting state only when the window is reopened is too late: both failures happen while the window sits idle.

## Consequences

Services owning per-window state for a recycling pool now have a release signal; the window-manager usage guide, API reference and README anti-patterns state the two-event rule. Renderers are unchanged: a released window keeps its content mounted until its next open, and the selection agent window remounts on each new session. The native collapse animation cannot be cancelled, so collapsing, closing and reopening the same window within 200 ms still lets that animation act on the reused window. `DirectoryTreeManager` and `FileEditService` still release only on destruction; the selection agent composer can create a notes directory tree, which stays alive until reuse or pool decay. A pending MCP request in an agent window closed into the pool still waits for its deadline, as the selection agent window note records.

## Verification

- Regression — `src/main/core/window/__tests__/WindowManager.test.ts`: release fires for `close()` and intercepted native close, fires once for a repeated close, and an over-capacity release fires only `onWindowDestroyed`; three of these fail without the new event.
- Regression — `src/main/services/selection/__tests__/SelectionAgentWindowService.test.ts`: a window released during its collapse animation publishes no capsule, is not hidden again, and ends at full opacity; fails on the previous service.
- Regression — `src/main/services/__tests__/ScreenshotChatService.test.ts`: after the last chat window is released, a capture without a source window takes the plain capture path instead of delivering to it; fails on the previous service.
