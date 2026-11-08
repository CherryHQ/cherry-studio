# Agent Note: Observe native state before accepting desktop actions

Status: implemented

English | [中文](2026-11-07-native-controller-state-observation.zh.md)

## Problem

Native automation failures obscured product results. Windows save scripts exceeded the command-line limit, address-bar input could reach another foreground window, and profile deletion could precede the fixture's exit callback. macOS clock controls moved between system processes and gained grouping containers. A depth-first notification-panel inspection traversed content before the sibling toolbar; hosted clock lookup also consumed most of the former ten-second process budget.

The controller also restarted a healthy development renderer after twenty seconds even though hosted cold starts took about forty seconds.

The hosted macOS image build unloads the Notification Center launch agent; the observed runner initially had no loaded agent. Its plist filename and service label differ, so enabling a label inferred from the filename does not restore the actual agent.

Windows shell registration also resolves through the application's isolated `APPDATA`. The SDK could not create its shortcut until the Programs directory existed, and that private shortcut was not visible to the real shell.

macOS can use different applications for HTTPS and local HTML files. Pinning the HTTPS browser for an HTML preview could leave the actual file-handler tab untracked. After Safari closes its final tab, its window enumeration can retain a truthy object specifier whose remote value no longer exists; a JavaScript null check does not establish native existence.

Cold Vite dependency optimization reloaded hosted renderers during cases. Phase steps masked failures with `continue-on-error`, so their successful conclusions did not establish passing cases. A Windows restore dialog appeared before CDP, and a new console process could precede its native handle. macOS accessibility snapshots could also briefly lose the correspondence between AX and CG windows.

## Decision

- Send Unicode PowerShell save scripts through standard input and verify the owned dialog and address-bar focus before typing.
- Find the visible Windows notification panel through its native shell window handle before querying its UIA tree. Hide metadata-query consoles.
- Request fixture shutdown through its owned pipe, yield until the child exit event, and escalate only after rechecking process ownership.
- Find the macOS clock by its accessibility identifier inside known system menu hosts, including grouped MenuBarAgent controls. Search panel levels before descending into notification or widget content, keep a thirty-second native-operation budget, and require the requested open/closed state.
- Restrict the permission observer to initialized directories on disposable hosted macOS runners and stop it before application cleanup.
- Wait up to sixty seconds for a revealed macOS development renderer before replacing its process; a loading renderer alone does not prove process failure.
- Read the Notification Center service label from its plist, record the hosted GUI service's prior state, enable it for native checks, and restore that state in an always-run step.
- Prepare the isolated Windows Programs directory. Register an unchanged SDK-generated shortcut in the real Start Menu with an exclusive run-specific name and a checksum lease written before publication. Both case and controller cleanup remove only the unchanged owned copy.

- Enumerate primitive browser window IDs and reacquire each native proxy before reading tabs. If reading tabs fails with a missing-window error, skip only when a fresh ID enumeration confirms disappearance without new IDs. Newly observed IDs make the snapshot incomplete and block quit. Existing IDs, permission errors and failed refreshes still fail cleanup and preserve the ownership ledger.
- Resolve the handler of an owned HTML probe before the preview action, and pin that application for tab ownership and cleanup. URL-only registrations continue to resolve HTTPS. Unsupported handlers fail before opening the external file.

- Seed Cache Storage with an absolute HTTPS request so the fixture works under both development HTTP and built file URLs. Match the Agent summary only in assistant messages; its marker also occurs in the user prompt.
- Build branch applications once and use `electron-vite preview --skipBuild` for every launch, restart and standalone smoke check. Clear inherited development renderer URLs.
- Preserve failed phase conclusions while continuing later phases through explicit cancellation guards. Run GitHub annotations after credential redaction.
- Permit known hosted test requesters to control the supported document, browser and file-manager applications; retain the disposable-runner guards and reject other requesters or targets.
- Dismiss pre-main dialogs through a freshly verified CDP or main-inspector owner, with command and runner-ancestry checks. Keep CDP ownership mandatory for Electron termination.
- Retry ambiguous macOS window inspection at most twice; persistent ambiguity still blocks cleanup.
- Treat a missing Windows console window or invalid-console-handle error 6 as pending only when reading; input failures still throw. Probe the run-owned cmd candidates and deduplicate actual readable console windows instead of assuming the outer shell owns the console. Read/write requests recheck PID and creation time.
- During Windows cleanup, only `ESRCH` proves that a process exited during its identity query; remove that identity from the termination set. Permission and unknown liveness failures remain blocking. Record lifecycle stages and safe identity metadata without foreign command lines.
- If an ownership query races with a macOS runner exit, require a known liveness result before and after waiting up to eight seconds for the existing group to drain naturally, then repeat ownership and port checks. Apply the same bounded observation when SIGKILL escalation refuses ownership. A runner may remain briefly visible during exit; observing it grants no permission to signal an unknown survivor. Permission and unknown liveness errors remain blocking.
- Save HTML code-mode geometry and startup window state before failed-case cleanup removes the UI. Diagnostics include only owned windows and internal routes, without titles or external URLs.
- Read the Windows console through the cursor or visible viewport bottom, whichever is lower on screen, capped at the buffer end. The native fixture moves the cursor above a footer before signaling readiness.
- Type each CLI business prompt once, observe its complete echo, then send Return separately. Windows text-only input emits neither Enter nor a placeholder NUL event. After an external-browser preview, restore owned main-window focus and observe code mode before checking the complete source.
- Before macOS CLI input, require the owned Terminal window and selected tty to match and wait up to five seconds for that window to own foreground focus. Send the action once; refusal records only safe window/tty/PID/key metadata, never prompt arguments or terminal contents.
- Match Windows native confirmation buttons by semantic Button control type, legacy Button class or TaskDialog CCPushButton class, together with exact name and owned process ID. The observed TaskDialog provider exposes its OK control as CCPushButton/Pane; retain the exact dialog identity and a single invocation.
- Preserve Windows restore-close and native-acknowledgement outcomes separately. Record bounded, redacted native matching and invocation metadata for the owned process; diagnostic snapshots do not replace actual matching. Bound renderer cleanup after failure and retain both original and cleanup errors.
- On a macOS save failure, record the owned panel's AX PID/role, foreground application identity and activation/raise results without titles, contents or input values. Keep the original foreground ownership guard. Exercise standalone saving with all BrowserWindows hidden, as in screenshot saving.
- Screenshot tests use a dedicated `CommandOrControl+Alt+Shift+K` binding rather than [Feishu’s default screenshot binding](https://www.feishu.cn/hc/zh-CN/articles/258254899042-%E6%8F%90%E5%8F%96%E5%9B%BE%E7%89%87%E4%B8%AD%E7%9A%84%E6%96%87%E5%AD%97). Before each physical trigger, inspect the owned Electron process and require its `globalShortcut.isRegistered()` result. A missing registration sends no key. Overlay cancellation, original preference restoration and owned-assistant deletion each receive an independent cleanup attempt, with failures preserved.
- Advance the AppKit main run loop while awaiting save-panel state and before the strict foreground PID check. [Apple's application-state contract](https://developer.apple.com/documentation/appkit/nsrunningapplication?language=objc) requires run-loop turns to refresh dynamic observations; activation acceptance alone does not prove keyboard ownership. Give each MP-128 execution its own assistant and new conversation, then remove only that assistant and its topics.
- Hide PowerShell probe consoles during tray actions, external-text inspection and foreground checks. Empty-menu and foreground failures retain only owned PID, foreground PID, window type and geometry. Missing Notepad text controls record bounded owned-PID UIA metadata without reading text; failed macOS selection-toolbar clicks retain bounded DOM/frame and owned native-window state before cleanup. These observations do not replace the existing interaction or result assertions.
- MP-17 uses Playwright's `noWaitAfter` option for Send, then verifies actual error details, Retry and recovery outcomes. MP-92 preserves model-picker state and a masked screenshot before failed-case cleanup removes the provider.

## Alternatives considered

- Larger timeouts alone do not fix wrong-window input, oversized command lines or ownership races.
- Accepting a keypress or a notification history entry would not prove visible notification activation.
- Resetting developer permissions or terminating applications by name would cross the run's ownership boundary.
- Removing profile isolation would expose developer credentials and configuration to the test.

## Consequences

Adapters remain platform specific and fail when native state cannot be confirmed. Notification scenarios still require a real system notification click to return to the completed topic. Local execution does not run the hosted permission observer.

## Verification

- Regression — 41 process, system-automation and permission-observer tests passed; 30 notification and system-automation tests passed, including a panel-content traversal case that failed before the breadth-first repair.
- Regression — hosted Windows native checks passed all ten adapter cases, including real Unicode/suggested-name saves and fixture cleanup; the native syntax check also passed.
- Regression — local MP-110 and MP-111 passed with the current macOS controller, including actual notification activation, persisted settings and successful owned-runtime cleanup. Complete hosted acceptance remains a separate requirement.
- Regression — the hosted macOS native fixture passed real file selection and notification-panel open/idempotence/close checks after GUI-service preparation; the service restoration step also passed.

- Regression — the cold-renderer case failed before the wait repair and passed afterward; all three window-recovery tests passed.
- Regression — hosted macOS MP-110 and MP-111 passed together after the tray-startup case waited for visible application chrome; native checks, service restoration and cleanup passed.
- Regression — 33 lifecycle, debug-bridge and shortcut tests passed, including existing-file preservation, changed-file preservation and actual controller fallback cleanup. Windows MP-110 passed real delivery, click routing and suppression; its independent Start Menu audit found zero owned shortcuts after cleanup.

- Regression — 29 external-resource, driver, browser-association and syntax tests passed, with one existing Windows-only skip. The actual macOS script runs against simulated native objects: different HTTPS/HTML defaults preserve existing tabs in both browsers and close the new HTML tab. File-handler tracking and unsupported-handler rejection both failed before the repair.

- Regression — 105 controller tests passed; 50 affected launch, task-selection, workflow and native-syntax checks passed with one Windows-only skip. Node, renderer and E2E type checks passed. Later hosted adapter gates passed all applicable cases; complete final-head desktop acceptance remains pending. The baseline full run failed 12 macOS and 25 Windows cases; both separate 53-case smoke suites passed. Neither completed phases nor that partial evidence establishes full acceptance.

- Regression — invalid truthy browser specifiers and native permission errors failed before the existence check and passed afterward. All 77 affected lifecycle, launch, process, browser-association, external-resource, driver and native-syntax checks passed, with one Windows-only skip. The exit-race contract also preserves a PID reused immediately after a confirmed exit and rejects unknown/permission-denied liveness. The production-style detached-console fixture passed the later hosted Windows adapter gate; the hosted full suite remains unaccepted.

- Regression — the macOS orphan-group race failed before the bounded natural-drain repair; 47 lifecycle, launch and process tests passed afterward. Local MP-116 completed in 13 seconds with successful owned-resource cleanup. At `42583381f0`, the hosted Windows native gate passed 13 tests with one macOS-only skip, including the production-style detached console. Complete hosted acceptance remains pending.
- Regression — 24 system-automation checks passed, including native-error identity, redacted stderr and control names, command omission, and preservation of both native and diagnostic-write errors. The five-case `native-recovery` selection passed 35 manifest/phase checks without changing full-suite coverage.
- Regression — the follow-up still-visible-runner race passed 54 lifecycle/launch/process checks, covering natural exit, persistent survivors, PID reuse and liveness errors before or after observation, with no signal to an unverified process. This contract reproduces the still-visible exit interval from the earlier four-pass/one-fail run.
- Regression — the follow-up local five-case native run at `e4dc4fbd51` passed every selected case and cleaned its owned runtime. Standalone smoke at `90d2d7a6ed` passed 53/53 without retries, skips, new runtime directories or Electron processes. The two heads have identical product sources. Another 64 browser/automation checks passed with one Windows-only skip. The contract introducing a foreign replacement inside the quit snapshot terminated the browser before the repair, then preserved the process, foreign tab and ledger after it. The new Windows text-only and TaskDialog fixtures still require hosted execution.
- Regression — hosted Windows at `9c182f4a74` passed all console fixtures, including text-only input followed by a separate Return. The real TaskDialog fixture failed and recorded its OK control as CCPushButton/Pane, proving that semantic Button alone is insufficient. The compatibility repair passed 24 system-automation checks; native re-execution remains required.
- Regression — local `e4dc4fbd51` full regression passed 133/134 cases and cleaned its runtime; MP-128 failed foreground ownership during native save. The new hidden-window native fixture passed, and isolated MP-128 with diagnostic-only changes passed in 34 seconds with cleanup. These isolated successes do not establish the intermittent failure's root cause; complete re-execution remains required.
- Regression — 61 lifecycle/launch/process checks passed. Seven escalation cases verify that an owned SIGTERM followed by a refused SIGKILL can finish naturally without any SIGKILL, while persistent survivors, reused PIDs and unknown/denied liveness remain blocking. The hosted failure occurred after 8.418 seconds, then the same group drained naturally about 1.1 seconds later.
- Regression — the save-driver RunLoop follow-up passed all three real macOS save variants (explicit name, suggested name and hidden BrowserWindow), plus 24 system-automation checks and E2E types. Before per-case draft isolation, MP-128 repeated three times produced one pass and two failures: a foreground-observation timeout and an attachment count polluted by the previous successful execution.

- Regression — 28 debug-bridge tests passed, including stale Electron identities and foreign, remote or wrong-port inspector rejection for the read-only shortcut check. Physical confirmation of the dedicated screenshot binding is tracked separately from these ownership contracts.

- Regression — 53 debug-bridge and system-automation checks passed with Node/E2E types. The Windows tray, relaunch and editor-provider paths still require native CI confirmation; the macOS toolbar diagnostics preserve the unresolved click failure.
