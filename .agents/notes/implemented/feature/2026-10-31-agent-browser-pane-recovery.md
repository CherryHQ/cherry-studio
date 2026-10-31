# Agent Note: Agent browser pane recovery and page reset

Status: implemented

English | [中文](2026-10-31-agent-browser-pane-recovery.zh.md)

## Problem

The Agent browser pane (`AgentBrowserView` inside the docked right pane) renders a `<webview>` guest owned by `AgentBrowserRuntimeService`. Before this change that guest had one lifetime: it was created when the pane first attached and was replaced only when the agent navigation target changed. Nothing in the pane could replace it, and the pane's own error surface only handled `did-fail-load`, which a dead or frozen renderer never reports.

Two outcomes were therefore unrecoverable from the UI. A crashed guest left the pane blank while every later browser tool call in that Agent session was routed to the dead `WebContents` in `BrowserGuestRegistry`. A guest whose renderer stopped responding left the pane painted with the last frame, and the address bar, back/forward and reload all drove a renderer that would not answer. In both cases the reported workaround was restarting the application, which also destroys the session's chat state. Issue #23244 records the user-facing report (v2.1.8, macOS arm64).

## Decision

`AgentBrowserRuntimeService.recover(sessionId)` replaces the current guest in place. It snapshots the committed URL (falling back to the attach-time `sourceUrl`), keeps `sessionId`, `securityProfile`, owners, pane anchor and overlay state, clears `failed`, sets `loading: true` and bumps `guestRevision` once. `AgentBrowserRuntimeHost` keys the `<webview>` on `resource.guest` and `guestRevision`, so the revision bump unmounts the dead element and mounts a fresh one at the same URL and partition; removing the element destroys the native `WebContents` immediately (measured: same tick), so no stale target survives the swap. A second `recover` while the replacement is in flight (`guest === null`) is a no-op.

Three entry points invoke it:

- `BrowserOverlays` shows the pane's recovery alert. `WebviewHost` now reports guest death (`render-process-gone`, and `did-fail-load` for the initial document) upward as `onGuestDied(reason)`, and the runtime latches it as `recoveryReason`. The alert is informational: it does not replace the guest by itself, because the user loses any page state such as form input on replacement.
- `SessionBrowserView` adds a `Reset page` control to the pane toolbar, next to the shared header actions. It is enabled whenever a guest exists — not gated on `ready`, because the case it exists for is a page that never becomes ready — and disabled only during the replacement gap. This is the only control that can rescue a frozen page: see the measurement below.
- Main reports native health for the agent guest through the `browser.guest.health` IPC payload, and `GuestSession` treats `render-process-gone` as terminal: it invalidates the annotation document, stops observing, aborts an in-flight attach, rejects pending commands and cancels both mutexes, so a browser tool call that was waiting when the renderer died fails instead of hanging. `BrowserSessionService.acquire` refuses a guest that is destroyed or already crashed, so a crashed guest cannot be re-bound to the session.

The `unresponsive`/`responsive` plumbing is delivered and unit-tested but no behaviour depends on it: measured on Electron 44.9.3, a deliberately blocked pane guest never emitted `unresponsive`, even with the window visible and focused for 132 s. The pane therefore does not claim to detect a hang; the user decides, and `Reset page` performs the same replacement a crash recovery does.

## Alternatives considered

- Automatic replacement on `render-process-gone`: rejected. It silently discards page state (typed form input, scroll position, single-page-app state) without the user asking, and the pane already had a manual affordance.
- Automatic replacement on `unresponsive` with a watchdog: rejected as unbuildable on this platform, not merely risky. The event is not delivered for the pane guest (measured twice, 12 s and 132 s); a watchdog would have to guess from CDP timeouts, which cannot distinguish a slow page from a dead one.
- Reload the surviving `WebContents` after a crash: rejected. `reload()` on a crashed target recovers a crashed renderer but cannot recover a frozen one — the target never replies — so it would leave the reported symptom unsolved and hide the difference between the two states.
- Route recovery through the existing `did-fail-load` surface only: rejected. A dead renderer emits `render-process-gone`, not `did-fail-load`; the pane stayed blank while the error surface believed the page was fine.
- Destroy and recreate the whole pane/runtime on reset: rejected as broader than needed. Replacing the guest keeps the session, owners, overlays and commit-time URL, so recovery does not touch chat state.

## Consequences

A guest that dies is replaced only when the user presses the alert's action or `Reset page`; until then the pane keeps them and every browser tool call for that session fails fast with `debugger_unavailable` rather than hanging. Recovery always lands on the last committed URL, so an in-progress navigation is lost. An agent-driven action in flight during recovery fails and must be retried by the model. `Reset page` is available on healthy pages too, where it discards page state — it is a reset, not an undo. Frozen-page diagnosis stays manual: the pane shows no "unresponsive" state, because the platform does not report one.

## Verification

- AC1 — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/__tests__/WebviewHost.test.tsx src/renderer/components/__tests__/AgentBrowserRuntimeHost.test.tsx src/renderer/components/__tests__/WebviewNavigation.test.tsx src/renderer/hooks/agent/__tests__/useAgentBrowserGuest.test.ts src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentBrowserView.test.tsx`: 47 passed; the crash alert, the enabled recovery action and the reset control's replacement (new revision, fresh native id, unchanged URL) are asserted.
- AC2 — `node node_modules/vitest/vitest.mjs run --project main src/main/features/browser/__tests__/GuestSession.test.ts src/main/features/browser/__tests__/BrowserSessionService.test.ts src/main/features/browser/__tests__/AgentBrowserRegistry.test.ts`: 125 passed; a dead renderer invalidates the document, rejects pending commands and cannot be re-acquired.
- AC3 — `node node_modules/@playwright/test/cli.js test tests/e2e/smoke/agentBrowserRecovery.test.ts --project=electron`: native Electron run — crash leaves the guest id and the session bound (no automatic swap), the alert's action replaces it in place (new native id, old `WebContents` gone, same URL and partition, page restored), a blocked page recovers through `Reset page`, and a hide/reopen keeps the same guest.
- AC4 — the same native run navigates through the address bar and reloads through the toolbar `Reload` after recovery, asserting the marker renders and the guest id does not change; existing `WebviewNavigation` and `WebviewBrowser` suites still pass.
- Regression — `probe/probe2.json`: crash → overlay recovery replaces native id 3 with 4 in the real app, `webContents.fromId(3)` undefined, partition and URL unchanged, page restored in 54 ms.
- Regression — `probe/probe3.json`: a blocked pane guest emits no `unresponsive`/`responsive` within 132 s on Electron 44.9.3, which is why hang detection is manual and `Reset page` exists.
