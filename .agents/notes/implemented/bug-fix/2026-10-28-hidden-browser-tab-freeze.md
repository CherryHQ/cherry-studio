# Agent Note: Hidden browser tabs kept running at full speed

Status: implemented

English | [中文](2026-10-28-hidden-browser-tab-freeze.zh.md)

## Problem

On a production v2.1.8 install, one browser tab the user was not looking at (vercel.com) held its renderer process at 60-90% CPU for 27 hours. Garbage collection took about 60% of its time. All Cherry Studio processes together used about 82% CPU, almost all of it from this tab.

Route tabs are hidden with React `<Activity>`, which sets `display: none` on the tab, including its `<webview>`. Chromium then stops painting the guest, so `requestAnimationFrame` stops. The guest still reports `document.visibilityState === 'visible'` at its last size, so the page never receives `visibilitychange` and Chromium never applies background-tab timer throttling. Measured on the production instance, most hidden guests ran timers at about 100 per second, the same as a visible page.

Each awake browser tab is also its own renderer process. Eight open tabs used about 2.1 GB. `TabLruManager` unloads tabs only once more than ten are awake.

## Decision

`WebviewBrowser`, which renders standalone browser tabs and opened HTML artifacts, reports its guest's visibility to main through `webview.set_visible`. The report is sent from an effect and its cleanup, because a hidden `<Activity>` runs effect cleanups but not effect bodies. `WebviewService.setGuestVisible` checks that the caller's window owns the guest and passes it to `HiddenGuestFreezer`.

`HiddenGuestFreezer` starts a `HIDDEN_FREEZE_DELAY_MS` (5 minutes) timer when a guest is hidden. When the timer fires, it attaches the guest's debugger and sends `Page.setWebLifecycleState` with `state: 'frozen'`, the mechanism Chrome uses to freeze background tabs. When the guest is shown again, it sends `state: 'active'` and detaches. The debugger stays attached while the guest is frozen, so a resume is always sent after the freeze on the same session. A guest that is playing audio, has DevTools open, already has a debugger attached, or is driven by a `--remote-debugging-port` client (tracked by `RemoteDebuggingMonitor`) is left running. A guest destroyed while hidden drops its timer. Stopping the service resumes every frozen guest.

## Alternatives considered

- Unload hidden tabs after a few minutes: rejected because it loses page state such as scroll position, form input, and single-page app state. `TabLruManager` already unloads tabs past its cap.
- Freeze as soon as the tab is hidden: rejected by the user in favour of a delay, so switching away briefly does not pause work a page is doing, such as streaming a response.
- Make the guest report itself hidden: no public Electron API does this. The `webContents` throttling toggle only takes effect on the next visibility change, and a harness on Electron 44 showed a `setBackgroundThrottling(false)` then `true` sequence leaves a hidden guest rendering at about 66 frames per second ([electron/electron#54311](https://github.com/electron/electron/issues/54311)).
- Turn main-window `backgroundThrottling` back on: not adopted. It is disabled on purpose so streaming responses keep updating, and it did not change the hidden guest's CPU when toggled on the production instance.

## Consequences

A browser tab hidden for more than 5 minutes runs no JavaScript until it is shown again. Its timers, network callbacks, and workers are paused, so a page cannot finish background work in the meantime. A tab opened in the background and never shown is not frozen, because its effects never run while its `<Activity>` is hidden. A guest skipped because it was playing audio stays running until it is hidden again. Agent-driven guests in `AgentBrowserRuntimeHost`, mini apps, and the topic browser pane are not covered.

## Verification

- Regression — `pnpm test:main src/main/services/webview/__tests__/HiddenGuestFreezer.test.ts`: freezing only after the full delay, no freeze when shown before the delay, resuming and releasing the debugger, skipping audible, DevTools-open, externally attached, and remote-debugging-port guests, dropping destroyed guests, and resuming on dispose.
- Regression — `pnpm test:renderer src/renderer/components/__tests__/WebviewBrowser.test.tsx` (`reports its guest hidden while the tab Activity is hidden so main can freeze it`): fails without the effect cleanup report.
- Regression — `pnpm test:main src/main/services/webview/__tests__/WebviewService.test.ts src/main/ipc/handlers/__tests__/webview.test.ts` and `pnpm test:renderer src/renderer/pages/browser/__tests__/BrowserPage.test.tsx`: existing webview contracts still pass.
- Regression — isolated dev instance, vercel.com in a browser tab: visible, 61 frames and 100 timers per second; hidden for under 5 minutes, no frames, 67 timers per second, 5-7% CPU; hidden for 5 minutes, page frozen at about 1.5% CPU; shown again, 58 frames and 100 timers per second with the debugger detached.
